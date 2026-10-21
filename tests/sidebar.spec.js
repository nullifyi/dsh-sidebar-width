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
  expect((await box(page, '#usage')).height).toBeGreaterThan(before.height + 90)
  expect((await box(page, '#foot')).height).toBeGreaterThan(parent.height + 60)
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
  expect((await box(page, '#usage')).height).toBeCloseTo(usage.height + 50, 0)
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

test('extreme drags reclaim other panes only after main reaches its minimum', async ({ page }) => {
  await boot(page)
  const header = await box(page, '#nav')
  await dragSash(page, 'foot', -100)
  expect((await box(page, '#nav')).height).toBeCloseTo(header.height, 0)
  await dragSash(page, 'foot', -700)
  expect((await box(page, '#main')).height).toBeCloseTo(96, 0)
  expect((await box(page, '#nav')).height).toBeLessThan(header.height)
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
    expect((await box(page, '#' + id)).height).toBeGreaterThan(before.height + 15)
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
  await boot(page)
  const before = await box(page, '#foot')
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
  await drag(page, usage.x + 90, usage.y + usage.height, 100)
  expect((await box(page, '#usage')).height).toBeGreaterThan(usage.height + 90)
  expect((await box(page, '.settings')).height).toBeGreaterThan(group.height + 90)
  expect((await box(page, '#remote')).height).toBeGreaterThanOrEqual(remote.height - 1)
  const grown = await box(page, '#foot')
  expect(grown.height).toBeGreaterThan(foot.height + 45)
  expect(grown.height).toBeLessThan(foot.height + 90)
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
