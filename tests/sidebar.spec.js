import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'

const fixture = await readFile(new URL('./sidebar.html', import.meta.url), 'utf8')
const plugin = await readFile(new URL('../client.js', import.meta.url), 'utf8')

async function boot(page, saved, prepare) {
  await page.route('http://sidebar.test/**', route => route.fulfill({ contentType: 'text/html', body: fixture }))
  await page.goto('http://sidebar.test/')
  if (prepare) await prepare(page)
  if (saved) await page.evaluate(saved => localStorage.setItem('dsh-sidebar-sections:v5', JSON.stringify(saved)), saved)
  await page.addScriptTag({ content: plugin })
  await page.evaluate(saved => window.start(saved), saved)
  await expect(page.locator('[data-dsh-sw-sash]').first()).toBeAttached()
  await expect(page.locator('html')).not.toHaveAttribute('data-dsh-sw-fault', /.+/)
  await page.waitForTimeout(150)
}

async function box(page, selector) { return page.locator(selector).boundingBox() }
async function drag(page, x, y, dy) {
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x, y + dy, { steps: 10 })
  await page.mouse.up()
  await page.waitForTimeout(180)
}
async function dragSash(page, name, dy) {
  const r = await box(page, `[data-dsh-sw-sash="${name}"]`)
  await drag(page, r.x + r.width / 2, r.y + r.height / 2, dy)
}

async function nativeFooter(page, backgroundAvatar = false) {
  await page.evaluate(backgroundAvatar => {
    const settings = document.querySelector('.settings')
    // The actual shell has a flex footer.action slot and a plain block
    // settings slot, not the fixture's all-column flex wrappers.
    settings.className = 'host_settingsArea'
    const actions = document.createElement('div')
    actions.className = 'host_footerActions'
    actions.style.cssText = 'display:flex;flex:none'
    const stack = document.createElement('div')
    stack.style.width = '100%'
    stack.append(document.querySelector('#usage'), document.querySelector('#remote'))
    actions.append(stack)
    settings.before(actions)
    if (backgroundAvatar) {
      const avatar = document.querySelector('.avatar')
      avatar.className = 'profile-picture'
      avatar.style.cssText = 'display:block;width:32px;height:32px;background:#7a91a4;border-radius:50%'
    }
  }, backgroundAvatar)
}

// Real shell slots + remote-web-ui's wide footer contract (display:contents,
// ordered full-width cards and settings sharing a final row with two entries).
async function sharedFooter(page) {
  await page.evaluate(() => {
    document.body.setAttribute('data-dsh-frame', '')
    const foot = document.querySelector('#foot')
    const settings = document.querySelector('.settings')
    settings.className = 'host_settingsArea'
    const actions = document.createElement('div')
    actions.className = 'host_footerActions'
    const slot = document.createElement('div')
    slot.dataset.slot = 'sidebar.footer.action'
    slot.style.display = 'contents'
    const stack = document.createElement('div')
    stack.className = 'cm-footer-stack'
    stack.append(document.querySelector('#usage'), document.querySelector('#remote'))
    slot.append(stack)
    for (const id of ['square', 'phone']) {
      const entry = document.createElement('button')
      entry.id = id
      entry.className = 'entryRow'
      entry.dataset.dshPart = 'entry'
      entry.textContent = id === 'square' ? '□' : '☎'
      slot.append(entry)
    }
    actions.append(slot)
    foot.prepend(actions, document.querySelector('#status'))
  })
  await page.addStyleTag({ content: `
    [data-dsh-frame] [class*='footArea'] { flex-direction:row;flex-wrap:wrap;align-items:center }
    [data-dsh-frame] [class*='footArea'] > :not([class*='settingsArea']):not([class*='footerActions']) { flex:1 1 100%;min-width:0 }
    [data-dsh-frame] [class*='footArea'] > [class*='footerActions'] { display:contents }
    [data-dsh-frame] [class*='footerActions'] > [data-slot] > :not([data-dsh-part='entry']) { flex:1 1 100%;order:1;min-width:0 }
    [data-dsh-frame] [class*='footerActions'] > [data-slot] > [data-dsh-part='entry'] { flex:0 0 auto;order:4;min-width:0 }
    [data-dsh-frame] [class*='settingsArea'] { order:3;flex:1 1 auto;width:auto;min-width:0 }
    .cm-footer-stack { display:flex;flex:none;order:-1;flex-direction:column;gap:6px;width:100%;min-width:0;max-width:100%;align-items:stretch }
    .entryRow { width:36px;height:36px;border:0;border-radius:50%;padding:0 }
  ` })
}

async function sharedBounds(page) {
  await noOverlap(page)
  const foot = await box(page, '#foot')
  const main = await box(page, '#main')
  const account = await box(page, '#account')
  const square = await box(page, '#square')
  const phone = await box(page, '#phone')
  expect(account.y + account.height).toBeCloseTo(foot.y + foot.height, 0)
  expect(square.x + square.width).toBeLessThanOrEqual(phone.x + 1)
  expect(account.x + account.width).toBeLessThanOrEqual(square.x + 1)
  for (const r of [square, phone]) {
    expect(r.y + r.height / 2).toBeCloseTo(account.y + account.height / 2, 0)
    expect(r.x + r.width).toBeLessThanOrEqual(foot.x + foot.width + 1)
  }
  expect((await box(page, '#usage')).y).toBeGreaterThanOrEqual(main.y + main.height - 1)
  expect((await box(page, '.avatar')).width).toBeCloseTo(32, 0)
}

// The installed host's footer.action slot is a real box, not contents.
// Its children include a flex-column framed card plus entry buttons.
async function boxedFooter(page) {
  await sharedFooter(page)
  await page.locator('[data-slot="sidebar.footer.action"]').evaluate(el => el.style.display = 'block')
  await page.locator('[data-slot="sidebar.footer.action"]').evaluate(el => {
    el.append(document.querySelector('#remote'))
  })
  await page.locator('#usage').evaluate(el => {
    el.style.display = 'flex'
    el.style.flexDirection = 'column'
  })
}

test('marked boundary: overflowing workspace rows cannot paint over the separated usage card', async ({ page }) => {
  await boot(page, {mode:'keep', heights:{foot:440}, rows:{}, hidden:[]}, async page => {
    await boxedFooter(page)
    await page.locator('.workspace').evaluate(el => {
      const overlay = document.createElement('div')
      overlay.id = 'conversation-overlay'
      overlay.style.cssText = 'height:900px;flex:none;background:red'
      el.append(overlay)
    })
  })
  const main = await box(page, '#main'), card = await box(page, '#usage')
  expect(card.y - main.y - main.height).toBeGreaterThanOrEqual(8)
  expect(await page.evaluate(({x,y}) => !!document.elementFromPoint(x,y)?.closest('#main'),
    {x:card.x + 40, y:card.y + 20})).toBe(false)
})

test('marked status: old small heights and further shrinking keep text readable', async ({ page }) => {
  await boot(page, {mode:'keep', heights:{foot:440}, rows:{'foot:4':18}, hidden:[]}, async page => {
    await boxedFooter(page)
    await page.locator('#status').evaluate(el => {
      // Collapsed dsh-usage status uses nested 12px labels, not a text node
      // inheriting the container's font size.
      el.innerHTML = '<span style="font-size:12px;display:flex;gap:6px;align-items:baseline;white-space:nowrap"><span>DeepSeek Account</span><span>空闲 今日消费</span><b>¥3.83</b></span>'
    })
  })
  await expect(page.locator('#status')).toHaveAttribute('data-dsh-sw-row', 'foot:4')
  const effectiveFont = () => page.locator('#status').evaluate(el => parseFloat(getComputedStyle(el.firstElementChild).fontSize) * el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).height))
  expect(await effectiveFont()).toBeGreaterThanOrEqual(10.95)
  const status = await box(page, '#status')
  await drag(page, status.x + 100, status.y + status.height - 1, -100)
  expect(await effectiveFont()).toBeGreaterThanOrEqual(10.95)
  await sharedBounds(page)
  await page.locator('#root').screenshot({path:test.info().outputPath('marked-sidebar.png')})
})

test('marked entries: bottom controls have space and align with the account center', async ({ page }) => {
  await boot(page, {mode:'keep', heights:{foot:440}, rows:{}, hidden:[]}, boxedFooter)
  const account = await box(page, '#account'), square = await box(page, '#square'), phone = await box(page, '#phone')
  expect(phone.x - square.x - square.width).toBeGreaterThanOrEqual(8)
  for (const entry of [square, phone]) expect(entry.y + entry.height / 2).toBeCloseTo(account.y + account.height / 2, 0)
})

test('marked entries: native row gaps remain budgeted when footer slack is exhausted', async ({ page }) => {
  for (const width of [220, 268]) for (const gap of [8, 16]) {
    await boot(page, {mode:'keep', heights:{foot:440}, rows:{}, hidden:[]}, async page => {
      await boxedFooter(page)
      await page.locator('#root').evaluate((el, width) => el.style.width = width + 'px', width)
      await page.locator('#foot').evaluate((el, gap) => el.style.rowGap = gap + 'px', gap)
    })
    await dragSash(page, 'foot', 650)
    await sharedBounds(page)
  }
})

test('flex-column framed cards scale all text instead of resizing their internal lines', async ({ page }) => {
  await boot(page, undefined, async page => {
    await page.locator('#usage').evaluate(el => {
      el.style.display = 'flex'
      el.style.flexDirection = 'column'
    })
  })
  const card = await box(page, '#usage')
  const line = await box(page, '#usage .line:first-child')
  await drag(page, card.x + 90, card.y + card.height - 1, -45)
  expect((await box(page, '#usage')).height).toBeLessThan(card.height - 30)
  expect((await box(page, '#usage .line:first-child')).height).toBeLessThan(line.height * .8)
  await noOverlap(page)
})

test('recording: oversized footer drags never crush unrelated header or navigation', async ({ page }) => {
  await page.setViewportSize({width:900, height:794})
  await boot(page, undefined, boxedFooter)
  const before = await Promise.all(['brand', 'new', 'nav'].map(id => box(page, '#' + id)))
  await dragSash(page, 'foot', -650)
  for (const [i, id] of ['brand', 'new', 'nav'].entries()) {
    expect((await box(page, '#' + id)).height).toBeCloseTo(before[i].height, 0)
  }
  await sharedBounds(page)
})

test('recording: enlarging an atomic card enlarges its content, not just its empty box', async ({ page }) => {
  await boot(page, {mode:'keep', heights:{foot:568}, rows:{}, hidden:[]}, boxedFooter)
  const before = await box(page, '#usage')
  const line = await box(page, '#usage .line:first-child')
  await drag(page, before.x + 90, before.y + before.height - 1, 50)
  expect((await box(page, '#usage .line:first-child')).height).toBeGreaterThan(line.height * 1.2)
  const enlarged = await box(page, '#usage')
  const last = await box(page, '#usage .line:last-child')
  expect(enlarged.y + enlarged.height - last.y - last.height).toBeLessThan(30)
  await sharedBounds(page)
})

test('recording: workspace items remain reachable when native content cannot shrink', async ({ page }) => {
  await boot(page, {mode:'keep', heights:{foot:568}, rows:{}, hidden:[]}, async page => {
    await boxedFooter(page)
    await page.locator('.workspace').evaluate(el => {
      el.style.cssText = 'flex:none;overflow:visible'
      for (let i = 0; i < 30; i++) {
        const item = document.createElement('div')
        item.textContent = 'workspace item ' + i
        el.append(item)
      }
    })
  })
  await page.locator('#main').hover()
  await page.mouse.wheel(0, 2500)
  await page.waitForTimeout(150)
  const main = await box(page, '#main')
  const last = await box(page, '.workspace > :last-child')
  expect(last.y + last.height).toBeLessThanOrEqual(main.y + main.height + 1)
  expect(last.y).toBeGreaterThanOrEqual(main.y - 1)
  await sharedBounds(page)
})

test('recording: resizing an old oversized footer preserves rendered sibling sizes across release', async ({ page }) => {
  await boot(page, {mode:'keep', heights:{foot:2500,nav:220}, rows:{}, hidden:[]}, boxedFooter)
  const siblings = ['brand','new','nav']
  const initial = await Promise.all(siblings.map(id => box(page, '#' + id)))
  expect(initial[0].height).toBeCloseTo(40, 0)
  expect(initial[1].height).toBeCloseTo(38, 0)
  expect(initial[2].height).toBeCloseTo(220, 0)
  for (const amount of [30, 45, -20]) {
    const sash = await box(page, '[data-dsh-sw-sash="foot"]')
    await page.mouse.move(sash.x + sash.width / 2, sash.y + sash.height / 2)
    await page.mouse.down()
    await page.mouse.move(sash.x + sash.width / 2, sash.y + sash.height / 2 + amount, {steps:8})
    await page.waitForTimeout(120)
    const during = await box(page, '#foot')
    await page.mouse.up()
    await page.waitForTimeout(180)
    expect((await box(page, '#foot')).height).toBeCloseTo(during.height, 0)
    for (const [i, id] of siblings.entries()) expect((await box(page, '#' + id)).height).toBeCloseTo(initial[i].height, 0)
    await sharedBounds(page)
  }
})

test('recording: card magnification, reversal, reset and unload stay contained at narrow widths', async ({ page }, testInfo) => {
  for (const width of [220, 268, 360]) {
    await boot(page, {mode:'keep', heights:{foot:340}, rows:{}, hidden:[]}, async page => {
      await boxedFooter(page)
      await page.locator('#root').evaluate((el, width) => el.style.width = width + 'px', width)
    })
    const natural = await box(page, '#usage')
    await drag(page, natural.x + 80, natural.y + natural.height - 1, 50)
    const enlarged = await box(page, '#usage')
    expect(enlarged.height).toBeGreaterThan(natural.height)
    for (const text of await page.locator('#usage .line > *').all()) {
      const r = await text.boundingBox()
      expect(r.x).toBeGreaterThanOrEqual(enlarged.x - 1)
      expect(r.x + r.width).toBeLessThanOrEqual(enlarged.x + enlarged.width + 1)
      expect(r.y + r.height).toBeLessThanOrEqual(enlarged.y + enlarged.height + 1)
    }
    await sharedBounds(page)
    if (width === 268) await page.screenshot({path:testInfo.outputPath('recording-expanded.png')})
    await page.mouse.dblclick(enlarged.x + 80, enlarged.y + enlarged.height - 1)
    await page.waitForTimeout(180)
    expect((await box(page, '#usage')).height).toBeCloseTo(natural.height, 0)
    const start = await box(page, '#usage')
    const y = start.y + start.height - 1
    await page.mouse.move(start.x + 80, y)
    await page.mouse.down()
    await page.mouse.move(start.x + 80, y + 150, {steps:8})
    await page.waitForTimeout(120)
    await sharedBounds(page)
    await page.mouse.move(start.x + 80, y - 20, {steps:8})
    await page.waitForTimeout(120)
    const during = await box(page, '#usage')
    expect(during.height).toBeCloseTo(start.height - 20, 0)
    await page.mouse.up()
    await page.waitForTimeout(180)
    expect((await box(page, '#usage')).height).toBeCloseTo(during.height, 0)
    await sharedBounds(page)
    await page.evaluate(() => window.dispose())
    expect((await box(page, '#usage')).height).toBeCloseTo(natural.height, 0)
    expect(await page.locator('[data-dsh-sw-zoom]').count()).toBe(0)
  }
})

test('boxed action slots share the bottom icon row and shrink whole flex cards', async ({ page }) => {
  await boot(page, {mode:'keep', heights:{new:47,nav:113,foot:568}, rows:{'foot0-0:0':103,'foot0:3':75,'foot0:0':117,'foot0:1':49}, hidden:[]}, boxedFooter)
  await sharedBounds(page)
  const card = await box(page, '#usage')
  const line = await box(page, '#usage .line:first-child')
  await dragSash(page, 'foot', 500)
  expect((await box(page, '#usage')).height).toBeLessThan(card.height - 15)
  expect((await box(page, '#usage .line:first-child')).height).toBeLessThan(line.height * .9)
  await sharedBounds(page)
  for (const width of [220, 280, 360]) {
    await page.locator('#root').evaluate((el, width) => el.style.width = width + 'px', width)
    await page.setViewportSize({width:900, height:570})
    await page.waitForTimeout(150)
    await sharedBounds(page)
  }
  await page.screenshot({path:test.info().outputPath('boxed-footer.png')})
  await page.evaluate(() => window.dispose())
  expect(await page.locator('[data-slot]').evaluate(el => el.style.display)).toBe('block')
})

test('shared contents footer shrinks cards and keeps account plus entries on one bottom row', async ({ page }) => {
  await boot(page, undefined, sharedFooter)
  const usage = await box(page, '#usage')
  const foot = await box(page, '#foot')
  await dragSash(page, 'foot', 65)
  expect((await box(page, '#foot')).height).toBeLessThan(foot.height - 40)
  expect((await box(page, '#usage')).height).toBeLessThan(usage.height - 10)
  await sharedBounds(page)
})

test('shared contents footer consumes slack before moving the account and survives viewport changes', async ({ page }) => {
  await boot(page, { mode:'keep', heights:{foot:568}, rows:{}, hidden:[] }, sharedFooter)
  const usage = await box(page, '#usage')
  const account = await box(page, '#account')
  const foot = await box(page, '#foot')
  const main = await box(page, '#main')
  await drag(page, usage.x + 90, usage.y + usage.height - 1, 50)
  // Width-constrained magnification may reach a wrap threshold before the
  // pointer's full delta; the card must grow without becoming empty or clipped.
  expect((await box(page, '#usage')).height).toBeGreaterThan(usage.height + 20)
  expect((await box(page, '#usage')).height).toBeLessThanOrEqual(usage.height + 51)
  expect((await box(page, '#account')).y).toBeCloseTo(account.y, 0)
  expect((await box(page, '#foot')).height).toBeCloseTo(foot.height, 0)
  expect((await box(page, '#main')).height).toBeCloseTo(main.height, 0)
  await sharedBounds(page)
  await page.setViewportSize({ width:900, height:570 })
  await page.waitForTimeout(180)
  await sharedBounds(page)
})

test('layout diagnostics are saved for the shared footer', async ({ page }) => {
  await boot(page, undefined, sharedFooter)
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('dsh-sidebar-sections:dump'))?.scopes.length)).toBeGreaterThan(0)
})

test('shared footer preserves legacy saved requests and restores native slots on unload', async ({ page }) => {
  await boot(page, {mode:'keep', heights:{new:47, nav:113, foot:568}, rows:{'foot0-0:0':103,'foot0:3':75,'foot0:0':117,'foot0:1':49}, hidden:[]}, sharedFooter)
  for (const width of [220, 268, 360]) {
    await page.locator('#root').evaluate((el, width) => el.style.width = width + 'px', width)
    await page.waitForTimeout(150)
    await sharedBounds(page)
    await dragSash(page, 'foot', 80)
    await sharedBounds(page)
  }
  await page.evaluate(() => window.dispose())
  expect(await page.locator('.host_footerActions').evaluate(el => getComputedStyle(el).display)).toBe('contents')
  expect(await page.locator('#foot').evaluate(el => getComputedStyle(el).display)).toBe('flex')
  expect(await page.locator('#foot').evaluate(el => el.style.gridTemplateRows)).toBe('')
  await expect(page.locator('[data-dsh-sw-sash]')).toHaveCount(0)
})

test('full-width card margins stay above the status in a shared footer', async ({ page }) => {
  await boot(page, {mode:'keep', heights:{foot:340}, rows:{}, hidden:[]}, async page => {
    await sharedFooter(page)
    await page.locator('.cm-footer-stack').evaluate(el => el.style.marginBottom = '12px')
  })
  const stack = await box(page, '.cm-footer-stack')
  const status = await box(page, '#status')
  expect(status.y).toBeGreaterThanOrEqual(stack.y + stack.height + 11)
  await sharedBounds(page)
})

test('shared footer reflows when entry plugins are removed', async ({ page }) => {
  await boot(page, {mode:'keep', heights:{foot:340}, rows:{}, hidden:[]}, sharedFooter)
  await page.locator('#square, #phone').evaluateAll(entries => entries.forEach(entry => entry.remove()))
  await page.waitForTimeout(180)
  await noOverlap(page)
  const foot = await box(page, '#foot')
  const account = await box(page, '#account')
  expect(account.width).toBeCloseTo(foot.width, 0)
  expect(account.y + account.height).toBeCloseTo(foot.y + foot.height, 0)
  await page.screenshot({path:test.info().outputPath('shared-footer.png')})
})
async function noOverlap(page) {
  await expect(page.locator('html')).not.toHaveAttribute('data-dsh-sw-fault', /.+/)
  const names = ['brand', 'new', 'nav', 'main', 'foot']
  const rects = await Promise.all(names.map(id => box(page, '#' + id)))
  for (let i = 1; i < rects.length; i++) expect(rects[i].y).toBeGreaterThanOrEqual(rects[i - 1].y + rects[i - 1].height - 1)
  const root = await box(page, '#root')
  const account = await box(page, '#account')
  expect(account.y + account.height).toBeLessThanOrEqual(root.y + root.height + 1)
  const foot = await box(page, '#foot')
  for (const id of ['usage', 'remote', 'status', 'account']) {
    const r = await box(page, '#' + id)
    expect(r.y).toBeGreaterThanOrEqual(foot.y - 1)
    expect(r.y + r.height).toBeLessThanOrEqual(foot.y + foot.height + 1)
    expect(r.x).toBeGreaterThanOrEqual(foot.x - 1)
    expect(r.x + r.width).toBeLessThanOrEqual(foot.x + foot.width + 1)
  }
  const usage = await box(page, '#usage')
  const lastLine = await box(page, '#usage .line:last-child')
  expect(lastLine.y + lastLine.height).toBeLessThanOrEqual(usage.y + usage.height + 1)
  expect(lastLine.x + lastLine.width).toBeLessThanOrEqual(usage.x + usage.width + 1)
}

test('footer can shrink and expand without moving the header or clipping descendants', async ({ page }) => {
  await boot(page)
  const initial = await box(page, '#foot')
  const header = await box(page, '#nav')
  await dragSash(page, 'foot', 65)
  expect((await box(page, '#foot')).height).toBeLessThan(initial.height - 35)
  const text = await box(page, '#usage .line:first-child')
  const card = await box(page, '#usage')
  expect(text.y + text.height).toBeLessThanOrEqual(card.y + card.height + 1)
  expect((await box(page, '#nav')).height).toBeCloseTo(header.height, 0)
  await noOverlap(page)
  await dragSash(page, 'foot', -110)
  expect((await box(page, '#foot')).height).toBeGreaterThan(initial.height)
  await noOverlap(page)
})

test('a row inside a resized footer grows its parent instead of being trapped', async ({ page }) => {
  await boot(page, { mode: 'keep', heights: { foot: 240 }, rows: {}, hidden: [] })
  const before = await box(page, '#usage')
  const parent = await box(page, '#foot')
  await drag(page, before.x + 90, before.y + before.height - 1, 120)
  expect((await box(page, '#usage')).height).toBeGreaterThan(before.height + 40)
  expect((await box(page, '#usage')).height).toBeLessThanOrEqual(before.height * 2 + 1)
  expect((await box(page, '#foot')).height).toBeGreaterThan(parent.height + 30)
  await noOverlap(page)
})

test('compressed rows scale explicit child fonts and padding together', async ({ page }) => {
  await boot(page)
  const before = await box(page, '#usage')
  const line = await box(page, '#usage .line:first-child')
  await drag(page, before.x + 90, before.y + before.height - 1, -45)
  const after = await box(page, '#usage')
  expect(after.height).toBeLessThan(before.height - 30)
  expect((await box(page, '#usage .line:first-child')).height).toBeLessThan(line.height * .8)
  const last = await box(page, '#usage .line:last-child')
  expect(last.y + last.height).toBeLessThanOrEqual(after.y + after.height + 1)
  await noOverlap(page)
})

test('restored oversize values and viewport shrink do not push out the account', async ({ page }) => {
  await boot(page, { mode: 'keep', heights: { foot: 700, nav: 200 }, rows: { 'foot0:0': 500 }, hidden: [] })
  await page.setViewportSize({ width: 900, height: 570 })
  await page.waitForTimeout(250)
  await noOverlap(page)
  await page.setViewportSize({ width: 900, height: 900 })
  await page.waitForTimeout(250)
  await noOverlap(page)
})

test('row growth uses blank space in its parent before moving neighboring panes', async ({ page }) => {
  await boot(page, { mode: 'keep', heights: { foot: 340 }, rows: {}, hidden: [] })
  const parent = await box(page, '#foot')
  const account = await box(page, '#account')
  const usage = await box(page, '#usage')
  await drag(page, usage.x + 90, usage.y + usage.height - 1, 50)
  expect((await box(page, '#usage')).height).toBeGreaterThan(usage.height + 20)
  expect((await box(page, '#usage')).height).toBeLessThanOrEqual(usage.height + 51)
  expect((await box(page, '#foot')).height).toBeCloseTo(parent.height, 0)
  expect((await box(page, '#account')).y).toBeCloseTo(account.y, 0)
  await noOverlap(page)
})

test('drag starts at the rendered size and repeated resize has no release jump', async ({ page }) => {
  await boot(page, { mode: 'keep', heights: { foot: 2500 }, rows: {}, hidden: [] })
  for (let i = 0; i < 4; i++) {
    const r = await box(page, '[data-dsh-sw-sash="foot"]')
    const before = await box(page, '#foot')
    await page.mouse.move(r.x + r.width / 2, r.y)
    await page.mouse.down()
    await page.mouse.move(r.x + r.width / 2, r.y + 30, { steps: 3 })
    await page.waitForTimeout(100)
    const during = await box(page, '#foot')
    expect(during.height).toBeCloseTo(before.height - 30, 0)
    await page.mouse.up()
    await page.waitForTimeout(150)
    expect((await box(page, '#foot')).height).toBeCloseTo(during.height, 0)
    await noOverlap(page)
  }
})

test('request sizes recover after window expansion and survive reload', async ({ page }) => {
  const saved = { mode: 'keep', heights: { foot: 400 }, rows: { 'foot0:0': 180 }, hidden: [] }
  await boot(page, saved)
  const initial = await box(page, '#foot')
  await page.setViewportSize({ width: 900, height: 550 })
  await page.waitForTimeout(150)
  await noOverlap(page)
  await page.setViewportSize({ width: 900, height: 900 })
  await page.waitForTimeout(150)
  expect((await box(page, '#foot')).height).toBeCloseTo(initial.height, 0)
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('dsh-sidebar-sections:v5')).heights.foot)).toBe(400)
  await boot(page)
  expect((await box(page, '#foot')).height).toBeCloseTo(initial.height, 0)
  await noOverlap(page)
})

test('extreme drags stop at the main floor without reclaiming other panes', async ({ page }) => {
  await boot(page)
  const header = await box(page, '#nav')
  await dragSash(page, 'foot', -100)
  expect((await box(page, '#nav')).height).toBeCloseTo(header.height, 0)
  await dragSash(page, 'foot', -700)
  expect((await box(page, '#main')).height).toBeCloseTo(96, 0)
  expect((await box(page, '#nav')).height).toBeCloseTo(header.height, 0)
  await noOverlap(page)
})

test('native block wrappers and deeply nested avatar are handled without scaling the avatar', async ({ page }) => {
  await boot(page, undefined, page => page.evaluate(() => {
    const settings = document.querySelector('.settings')
    settings.style.display = 'block'
    const outer = document.createElement('div')
    outer.className = 'host_footerActions'
    outer.style.cssText = 'display:flex;flex:none'
    settings.before(outer)
    outer.append(settings)
  }))
  const avatar = await box(page, '.avatar')
  await dragSash(page, 'foot', 55)
  expect((await box(page, '.avatar')).height).toBeCloseTo(avatar.height, 0)
  const foot = await box(page, '#foot')
  expect(foot.height).toBeLessThan(190)
  await noOverlap(page)
})

test('direct footer cards and last content row before the account both have usable seams', async ({ page }) => {
  await boot(page, undefined, page => page.evaluate(() => {
    const settings = document.querySelector('.settings')
    settings.replaceWith(...settings.children)
  }))
  for (const id of ['usage', 'status']) {
    const before = await box(page, '#' + id)
    await drag(page, before.x + 90, before.y + before.height, 25)
    expect((await box(page, '#' + id)).height).toBeGreaterThan(before.height + 8)
    expect(await page.locator('#' + id).evaluate(el => Number(getComputedStyle(el).zoom))).toBeGreaterThan(1.2)
    await noOverlap(page)
  }
})

test('dynamic text with unchanged node count is measured again', async ({ page }) => {
  await boot(page, { mode: 'keep', heights: { foot: 150 }, rows: {}, hidden: [] })
  await page.evaluate(() => { document.querySelector('#usage .line span').firstChild.data = '新增动态用量内容 '.repeat(12) })
  await page.waitForTimeout(200)
  await noOverlap(page)
})

test('compressed rows retain full width rather than squashing to the left', async ({ page }) => {
  await boot(page)
  await dragSash(page, 'foot', 65)
  const card = await box(page, '#usage')
  const foot = await box(page, '#foot')
  expect(card.width).toBeGreaterThan(foot.width - 5)
  const row = await box(page, '#nav > :first-child')
  await drag(page, row.x + 90, row.y + row.height, -15)
  const resized = await box(page, '#nav > :first-child')
  expect(resized.width).toBeGreaterThan(row.width - 5)
})

test('ordinary buttons remain clickable and double click resets a row', async ({ page }) => {
  await boot(page)
  await page.evaluate(() => {
    window.clicked = 0
    document.querySelector('#nav > :first-child').addEventListener('click', () => window.clicked++)
  })
  await page.locator('#nav > :first-child').click()
  expect(await page.evaluate(() => window.clicked)).toBe(1)
  const r = await box(page, '#usage')
  await drag(page, r.x + 90, r.y + r.height, 30)
  const resized = await box(page, '#usage')
  await page.mouse.dblclick(resized.x + 90, resized.y + resized.height)
  await page.waitForTimeout(150)
  expect((await box(page, '#usage')).height).toBeCloseTo(r.height, 0)
})

test('compact layout stays contained across sidebar widths', async ({ page }, testInfo) => {
  await boot(page, { mode: 'keep', heights: { foot: 145, nav: 70 }, rows: {}, hidden: [] })
  for (const width of [220, 268, 360]) {
    await page.locator('#root').evaluate((root, width) => root.style.width = width + 'px', width)
    await page.waitForTimeout(150)
    await noOverlap(page)
    const row = await box(page, '#nav > :last-child')
    const nav = await box(page, '#nav')
    expect(row.y + row.height).toBeLessThanOrEqual(nav.y + nav.height + 1)
  }
  await page.mouse.move(600, 20)
  await page.screenshot({ path: testInfo.outputPath('compact-sidebar.png') })
})

test('React remount and inserted extra pane get fresh layout and working handles', async ({ page }) => {
  await boot(page, { mode: 'keep', heights: { foot: 160 }, rows: {}, hidden: [] })
  await page.evaluate(() => {
    const root = document.querySelector('#root')
    const clone = root.cloneNode(true)
    // Emulate fresh React DOM, not a copy of plugin-owned inline styles.
    for (const own of clone.querySelectorAll('[data-dsh-sw-gutter],[data-dsh-sw-dock],[data-dsh-sw-sash]')) own.remove()
    for (const node of clone.querySelectorAll('*')) { node.removeAttribute('style'); for (const attr of [...node.attributes]) if (attr.name.startsWith('data-dsh-sw-')) node.removeAttribute(attr.name) }
    const extra = document.createElement('div')
    extra.id = 'extra'
    extra.textContent = '另一个插件'
    extra.style.cssText = 'height:48px;flex:none;padding:8px'
    clone.querySelector('#foot').before(extra)
    root.replaceWith(clone)
  })
  await page.waitForTimeout(650)
  await noOverlap(page)
  await expect(page.locator('[data-dsh-sw-sash="x:extra:0"]')).toBeAttached()
  const before = await box(page, '#extra')
  await dragSash(page, 'x:extra:0', 30)
  expect((await box(page, '#extra')).height).toBeGreaterThan(before.height + 15)
  await noOverlap(page)
})

test('collapsed main still leaves the account visible and footer adjustable', async ({ page }) => {
  await boot(page, { mode: 'keep', heights: { foot: 200 }, rows: {}, hidden: ['main'] })
  const before = await box(page, '#foot')
  // main hidden: nav|foot boundary grows the footer when pulled upwards.
  await dragSash(page, 'nav', -60)
  expect((await box(page, '#foot')).height).toBeGreaterThan(before.height + 35)
  const account = await box(page, '#account')
  expect(account.y + account.height).toBeLessThanOrEqual(901)
})

test('unloading restores native dimensions and removes resize handlers', async ({ page }) => {
  let before
  await boot(page, undefined, async page => { before = await box(page, '#foot') })
  await dragSash(page, 'foot', 60)
  await page.evaluate(() => window.dispose())
  await page.waitForTimeout(200)
  expect((await box(page, '#foot')).height).toBeCloseTo(before.height, 0)
  expect(await page.locator('[data-dsh-sw-sash]').count()).toBe(0)
  const usage = await box(page, '#usage')
  await drag(page, usage.x + 80, usage.y + usage.height, 50)
  expect((await box(page, '#usage')).height).toBeCloseTo(usage.height, 0)
})

test('native collapsed rail releases sizing and restores saved sizes on expansion', async ({ page }) => {
  await boot(page, { mode: 'keep', heights: { nav: 70 }, rows: {}, hidden: [] })
  await page.locator('#root').evaluate(root => root.classList.add('fixture_collapsed'))
  await page.waitForTimeout(180)
  expect(await page.locator('[data-dsh-sw-zoom]').count()).toBe(0)
  expect(await page.locator('[data-dsh-sw-sash]').count()).toBe(0)
  await page.locator('#root').evaluate(root => root.classList.remove('fixture_collapsed'))
  await page.waitForTimeout(180)
  expect((await box(page, '#nav')).height).toBeCloseTo(70, 0)
  await noOverlap(page)
})

test('footer collapse preserves the account and does not reveal host-hidden widgets', async ({ page }) => {
  await boot(page)
  await page.locator('#usage').evaluate(row => {
    const hidden = document.createElement('div')
    hidden.id = 'native-hidden'
    hidden.style.display = 'none'
    hidden.textContent = 'host-hidden widget'
    row.after(hidden)
  })
  await page.waitForTimeout(180)
  await expect(page.locator('#native-hidden')).toBeHidden()
  await page.locator('[data-dsh-sw-collapse="foot"]').click()
  await expect(page.locator('#usage')).toBeHidden()
  await expect(page.locator('#account')).toBeVisible()
  await page.evaluate(() => window.dispose())
  await expect(page.locator('#usage')).toBeVisible()
  await expect(page.locator('#native-hidden')).toBeHidden()
})

test('growing a child expands saved intermediate groups before the outer pane', async ({ page }) => {
  await boot(page, { mode: 'keep', heights: { foot: 240 }, rows: { 'foot:0': 160 }, hidden: [] }, async page => {
    await page.locator('#foot').evaluate(foot => foot.append(document.querySelector('#account')))
  })
  const usage = await box(page, '#usage')
  const remote = await box(page, '#remote')
  const group = await box(page, '.settings')
  const foot = await box(page, '#foot')
  await drag(page, usage.x + 90, usage.y + usage.height, 50)
  expect((await box(page, '#usage')).height).toBeGreaterThan(usage.height + 20)
  expect((await box(page, '.settings')).height).toBeGreaterThan(group.height + 45)
  expect((await box(page, '#remote')).height).toBeGreaterThanOrEqual(remote.height - 1)
  const grown = await box(page, '#foot')
  expect(grown.height).toBeGreaterThan(foot.height + 10)
  expect(grown.height).toBeLessThan(foot.height + 30)
  await noOverlap(page)
})

test('account plus horizontal action buttons cannot be shrunk by ancestor zoom', async ({ page }) => {
  await boot(page, { mode: 'keep', heights: { foot: 340 }, rows: {}, hidden: [] }, async page => {
    await page.locator('#account').evaluate(account => {
      const actions = document.createElement('div')
      actions.className = 'actions'
      actions.style.cssText = 'display:flex;flex-direction:row;align-items:center'
      account.before(actions)
      const button = document.createElement('button')
      button.textContent = '设置'
      actions.append(account, button)
    })
  })
  const before = await box(page, '.avatar')
  await dragSash(page, 'foot', 70)
  const after = await box(page, '.avatar')
  expect(after.width).toBeCloseTo(before.width, 1)
  expect(after.height).toBeCloseTo(before.height, 1)
  const account = await box(page, '#account')
  const foot = await box(page, '#foot')
  const usage = await box(page, '#usage')
  await drag(page, usage.x + 90, usage.y + usage.height, 50)
  expect((await box(page, '#account')).y).toBeCloseTo(account.y, 0)
  expect((await box(page, '#foot')).height).toBeCloseTo(foot.height, 0)
  await dragSash(page, 'foot', 100)
  expect((await box(page, '.avatar')).height).toBeCloseTo(before.height, 1)
  expect((await box(page, '.avatar')).width).toBeCloseTo(before.width, 1)
  await noOverlap(page)
})

test('native block slots expose independently compressible usage rows', async ({ page }) => {
  await boot(page, undefined, page => nativeFooter(page))
  const usage = await box(page, '#usage')
  const remote = await box(page, '#remote')
  const account = await box(page, '#account')
  await drag(page, usage.x + 90, usage.y + usage.height - 1, -28)
  expect((await box(page, '#usage')).height).toBeCloseTo(usage.height - 28, 0)
  expect((await box(page, '#remote')).height).toBeCloseTo(remote.height, 0)
  expect((await box(page, '#account')).y).toBeCloseTo(account.y, 0)
  await noOverlap(page)
})

test('background avatar fallback reserves only the account row, not the preceding status', async ({ page }) => {
  await boot(page, { mode: 'keep', heights: { foot: 340 }, rows: {}, hidden: [] }, page => nativeFooter(page, true))
  const status = await box(page, '#status')
  const account = await box(page, '#account')
  await drag(page, status.x + 90, status.y + status.height, 25)
  expect((await box(page, '#status')).height).toBeGreaterThan(status.height + 8)
  expect((await box(page, '#status')).height).toBeLessThanOrEqual(status.height + 26)
  expect((await box(page, '#account')).height).toBeCloseTo(account.height, 0)
  expect((await box(page, '#account')).y).toBeCloseTo(account.y, 0)
  await noOverlap(page)
})

test('row hover and dragging show only an in-sidebar grip with no floating text', async ({ page }) => {
  await boot(page, undefined, page => page.evaluate(() => {
    document.querySelector('#root').style.cssText = 'margin:30px 0 0 48px;height:calc(100% - 30px)'
  }))
  const usage = await box(page, '#usage')
  const root = await box(page, '#root')
  await page.mouse.move(usage.x + 90, usage.y + usage.height - 1)
  const grip = page.locator('[data-dsh-sw-rowhint]')
  await expect(grip).toBeVisible()
  await expect(grip).toHaveText('')
  const r = await grip.boundingBox()
  expect(r.x + r.width).toBeLessThan(root.x + root.width)
  expect(r.x + r.width / 2).toBeCloseTo(root.x + root.width / 2, 0)
  expect(r.y).toBeCloseTo(usage.y + usage.height, 0)
  await page.mouse.down()
  await page.mouse.move(usage.x + 90, usage.y + usage.height - 20, { steps: 5 })
  await expect(grip).toHaveText('')
  await page.mouse.up()
  expect((await box(page, '#usage')).height).toBeLessThan(usage.height - 10)
})
