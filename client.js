/**
 * dsh-sidebar-width — 客户端半体（浏览器侧），v0.5.0
 *
 * 形状对齐官方模板 `cordis-plugin-development/templates/decoration/client.js`：
 * 工厂返回 `{ inject, apply }`，注册 id 必须等于包名。
 *
 * ---- v0.5.0：按 VS Code SplitView / Sash 的做法重做 ----
 * ---- v0.6.0：在块级 sash 之下再加一层“行级 sash”，并把 footer 用 margin-top:auto 钉底 ----
 *   · 可单独调的行：面板列表每一行、底部各块之间、底部容器里的每一行；
 *   · 行级拖动同样只改真实高度，装不下时字号按比例缩（z = 高度 / 原生高度）；
 *   · footer 永远贴底（即使把「工作区与会话」整块折叠掉也不上移）。
 * 参考：
 *   - microsoft/vscode `src/vs/base/browser/ui/sash/sash.ts`
 *     · sash 是独立节点，尺寸默认 4px，跨在两条 pane 的分界上；
 *     · hover 有 300ms 延迟再高亮（避免鼠标扫过时闪烁），拖动时整页 cursor 强制成 ns-resize；
 *     · 双击 sash = reset（`onDidReset`）。
 *   - microsoft/vscode `src/vs/base/browser/ui/splitview/splitview.ts`
 *     · 每块有 minimumSize / maximumSize，布局按“固定尺寸 + 可伸缩 pane”分摊；
 *     · 拖动分界只改一块的尺寸，其余交给可伸缩的那一块吸收。
 *   - johnwalley/allotment：VS Code splitview 的 React 移植，交互与上面一致。
 *
 * 本插件的 pane（侧栏本体由 `@deepseek-ai/dsh-client-ui-sidebar` 渲染）：
 *     div.<hash>_root            flex column, padding 6px 12px, height 100%
 *       div.<hash>_logoRow       品牌行          pane: brand
 *       button.<hash>_newSession 新会话          pane: new
 *       nav.<hash>_panelList     全局面板         pane: nav
 *       div.<hash>_regionArea    工作区/会话列表   pane: main（可伸缩，吸收余量）
 *       div.<hash>_footArea      用量/远程/账号    pane: foot（贴底）
 *
 * 四条 sash 插在相邻 pane 之间（自身 0 高、不占布局，只有 ::before 的 5px 带接事件）：
 *     brand|new → 拖 brand     new|nav → 拖 new
 *     nav|main  → 拖 nav       main|foot → 拖 foot（反向：往上拖 = footer 变高）
 * 拖动改的是“真实高度”，范围大；内容比分配高度高时，子元素用 CSS zoom 等比缩
 * （字号、图标、内边距一起缩，并补偿 width 保持横向占满）——这就是“压紧时字号自动变小”。
 * main 用 `flex:1 1 0`，foot 是最后一个 flex 子项，所以底部永远贴底、头像不会被挤出视口。
 *
 * 只往 root 里加“自己的”节点（1 条 gutter + 4 条 sash + 图标坞），不接管 React 的
 * 子节点顺序；每次 mutation 幂等重放一次 apply()。
 *
 * 折叠：四段（品牌、面板、工作区、底部）各有一个常驻可见的折叠键，折叠后收成
 * 头像正上方的小图标，悬浮显示区块名 + 里面还剩哪些条目，点图标原地展开。
 * 折叠态（原生 56px 窄轨，`root` 带 `*_collapsed`）一律让位。
 */

window.__ModuleLoader__.load({
  id: 'dsh-sidebar-width',
  factory(require) {
    const React = (typeof window !== 'undefined' && window.React) || require('react')

    /* ---------------- 常量 ---------------- */

    // 版本号必须与 package.json 一致（夹具里有断言）。宿主加载的是哪一版，
    // 靠 data-dsh-sw-version 属性和 BOOT_KEY 里的启动记录就能确认，不用猜。
    const PLUGIN_VERSION = '0.6.22'
    const BOOT_KEY = 'dsh-sidebar-sections:boot'
    const DUMP_KEY = 'dsh-sidebar-sections:dump'
    const STORE_KEY = 'dsh-sidebar-sections:v5'
    const LEGACY_KEY = 'dsh-sidebar-sections:v2'
    const LEGACY_V4 = 'dsh-sidebar-sections:v4'
    // v3 的行高是 0.6.1 早期版本在真实宿主里写坏的（行被压到十几像素、字号缩到底），旧值一律不继承。
    const LEGACY_V3 = 'dsh-sidebar-sections:v3'
    const CSS_ID = 'dsh-sidebar-sections-css'
    const ATTR_BLOCK = 'data-dsh-sw-block'
    const ATTR_PANE = 'data-dsh-sw-pane'
    const ATTR_DOCK = 'data-dsh-sw-dock'
    const ATTR_GUTTER = 'data-dsh-sw-gutter'
    const ATTR_SASH = 'data-dsh-sw-sash'
    const ATTR_CHIP = 'data-dsh-sw-chip'
    const ATTR_TIP = 'data-dsh-sw-tip'
    const ATTR_ZOOM = 'data-dsh-sw-zoom'
    const ATTR_ROW = 'data-dsh-sw-row'
    const ATTR_RSASH = 'data-dsh-sw-rsash'
    const ATTR_ROW_HINT = 'data-dsh-sw-rowhint'
    const ATTR_SEAM = 'data-dsh-sw-seam'
    const ATTR_DRAGGING = 'data-dsh-sw-dragging'
    const ATTR_ROWSPACE = 'data-dsh-sw-rowspace'
    const DUMP2_KEY = 'dsh-sidebar-sections:footdump'

    /** 每块最低高度：再低就点不到里面的按键了。 */
    const MIN_PANE = { brand: 22, new: 22, nav: 36, foot: 48 }
    // 下限不能超过这一块自己的原生高度：布局天生比下限还小时（小屏、外来块），
    // 强行抬到下限会让“一拖就跳”，拖动起点也就错了。
    const paneMin = (id, natural) => {
      const hard = MIN_PANE[id] || 18
      const nat = Math.round(natural || 0)
      return nat > 0 ? Math.min(hard, Math.max(14, nat)) : hard
    }
    /** 主区（工作区/会话）至少留这么高，否则只剩一条被截断的会话行，看起来像“压住了”。 */
    const MIN_MAIN = 96
    /** 内容超过分配高度时，最多缩到原尺寸的 42%（字号 14 → 5.9，仍可见）。 */
    const MIN_FIT = 0.42
    /** 单行最低高度：再低就点不到这一行里的东西了。 */
    const MIN_ROW = 18
    /** 账号/头像行的独立键与最低高度：它是单独一个可调单元，不跟上一块联动。 */
    const ACCOUNT_KEY = 'acct:0'
    const MIN_ACCOUNT = 26

    const FIXED_PANES = ['brand', 'new', 'nav', 'foot']
    const PANE_LABEL = { brand: '品牌行', new: '新会话', nav: '全局面板', main: '工作区与会话', foot: '账号与用量' }

    /** 行级覆盖键（`nav:2` / `foot0:1` / `foot:0`）→ 给人看的名字。 */
    function rowLabel(key) {
      const parts = String(key).split(':')
      const index = Number(parts[1]) + 1
      if (parts[0] === 'acct') return '账号与头像'
      if (parts[0] === 'nav') return '面板第' + index + '行'
      if (parts[0] === 'foot') return '底部分组第' + index + '块'
      return '底部第' + index + '行'
    }

    /** 拖动分界时真正被改尺寸的那一块（main 总是吸收余量，不改它）。 */
    const SASHES = [
      { id: 'brand', above: 'brand', below: 'new', target: 'brand', inverted: false },
      { id: 'new', above: 'new', below: 'nav', target: 'new', inverted: false },
      { id: 'nav', above: 'nav', below: 'main', target: 'nav', inverted: false },
      { id: 'foot', above: 'main', below: 'foot', target: 'foot', inverted: true },
    ]
    const SASH_TARGET = { brand: 'brand', new: 'new', nav: 'nav', foot: 'foot' }
    const SASH_INVERTED = { foot: true }

    const BLOCK_ORDER = ['header', 'nav', 'main', 'foot']
    const BLOCK_LABEL = {
      header: '品牌与新会话',
      nav: '全局面板',
      main: '工作区与会话',
      foot: '账号与用量',
    }

    /** 折叠坞里的图标：16×16、stroke=currentColor，静态字符串，不拼用户内容。 */
    const CHIP_ICON = {
      header:
        '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3.5h10v7H7.5L5 13v-2.5H3z"/><path d="M8 5.5v3M6.5 7h3"/></svg>',
      nav:
        '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="2.5" width="4.6" height="4.6" rx="1.2"/><rect x="8.9" y="2.5" width="4.6" height="4.6" rx="1.2"/><rect x="2.5" y="8.9" width="4.6" height="4.6" rx="1.2"/><rect x="8.9" y="8.9" width="4.6" height="4.6" rx="1.2"/></svg>',
      main:
        '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 4.2h11M2.5 8h11M2.5 11.8h7"/></svg>',
      foot:
        '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="5.6" r="2.6"/><path d="M3 13.2c.7-2.2 2.6-3.4 5-3.4s4.3 1.2 5 3.4"/></svg>',
    }

    const COLLAPSE_ICON =
      '<svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 3.5 5 8l4.5 4.5"/></svg>'

    /* ---------------- 样式（只注入一次） ---------------- */

    const CSS = `
/* 覆盖层：折叠键与图标坞的定位容器，自身不接事件 */
[${ATTR_GUTTER}]{position:absolute;inset:0;pointer-events:none;z-index:7}

/* sash：0 高、不占布局；::before 是 5px 的抓取带（跨在分界线上），
   ::after 是悬浮时出现的居中小握把（22×4 圆角），不再画贯穿全宽的细线。 */
[${ATTR_SASH}]{position:relative;flex:0 0 0;height:0;width:100%;pointer-events:none;z-index:6}
[${ATTR_SASH}]::before{content:'';position:absolute;left:0;right:0;top:-3px;height:7px;
  pointer-events:auto;cursor:row-resize;background:transparent}
[${ATTR_SASH}]::after{content:'';position:absolute;left:50%;top:-2px;width:20px;height:4px;margin-left:-10px;
  border-radius:2px;background:var(--dsw-alias-label-tertiary,rgba(128,128,128,.55));
  opacity:0;transition:opacity .12s ease,width .12s ease,background .12s ease;pointer-events:none}
[${ATTR_SASH}]:hover::after,[${ATTR_SASH}][data-dsh-sw-active]::after{opacity:1;width:30px;
  background:var(--dsw-alias-brand-primary,#4d6bfe)}
[data-dsh-sw-dragging]{user-select:none}
[data-dsh-sw-dragging] *{user-select:none!important;cursor:row-resize!important}

/* 折叠键：常驻可见（细边框 + 箭头），只占侧栏左侧 12px 内边距，不压任何按键 */
[data-dsh-sw-collapse]{position:absolute;left:0;width:11px;height:22px;padding:0;border:0;border-radius:4px;
  display:flex;align-items:center;justify-content:center;cursor:pointer;pointer-events:auto;z-index:3;
  background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.12));
  color:var(--dsw-alias-label-secondary,rgba(128,128,128,.95));opacity:.6;
  transition:opacity .12s ease,background .12s ease,color .12s ease}
[data-dsh-sw-collapse]:hover,[data-dsh-sw-collapse]:focus-visible{opacity:1;color:var(--dsw-alias-label-primary,currentColor);
  background:var(--dsw-alias-brand-primary,#4d6bfe)}
[data-dsh-sw-collapse]:hover svg,[data-dsh-sw-collapse]:focus-visible svg{stroke:#fff}

/* 图标坞：折叠后的区块图标堆在头像正上方 */
[${ATTR_DOCK}]{position:absolute;left:10px;bottom:14px;display:flex;flex-direction:column;gap:6px;z-index:8;pointer-events:auto}
[${ATTR_DOCK}][hidden]{display:none}
[${ATTR_CHIP}]{width:26px;height:26px;padding:0;border:1px solid var(--dsw-alias-border-l3,rgba(128,128,128,.35));
  border-radius:8px;background:var(--dsw-alias-button-elevated-fill,rgba(128,128,128,.12));
  color:var(--dsw-alias-label-secondary,rgba(128,128,128,.9));
  display:flex;align-items:center;justify-content:center;cursor:pointer;
  transition:color .12s ease,border-color .12s ease,transform .12s ease}
[${ATTR_CHIP}]:hover{color:var(--dsw-alias-label-primary,currentColor);border-color:var(--dsw-alias-brand-primary,#4d6bfe);transform:translateX(1px)}

/* 悬浮说明：区块名 + 剩余条目 */
[${ATTR_TIP}]{position:fixed;z-index:9999;max-width:260px;padding:8px 10px;border-radius:8px;font-size:12px;line-height:1.55;
  background:var(--dsw-alias-bg-elevated,#1f1f22);color:var(--dsw-alias-label-primary,#eee);
  border:1px solid var(--dsw-alias-border-l3,rgba(128,128,128,.35));box-shadow:0 10px 26px rgba(0,0,0,.3);
  pointer-events:none}
[${ATTR_TIP}] em{display:block;font-style:normal;font-weight:600;margin-bottom:3px}
[${ATTR_TIP}] span{display:block;color:var(--dsw-alias-label-secondary,rgba(200,200,200,.8));white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

/* 区块内按钮自动换行：窄侧栏不再横向截断 */
[${ATTR_BLOCK}]{min-width:0;min-height:0}
[${ATTR_BLOCK}="header"]>*{min-width:0;flex-wrap:wrap}
[${ATTR_BLOCK}="nav"]{min-width:0;overflow-x:hidden}
[${ATTR_BLOCK}="nav"]>*{min-width:0;max-width:100%}
[${ATTR_BLOCK}="main"]>*{min-width:0}
[${ATTR_BLOCK}="foot"]>*{min-width:0}
[${ATTR_BLOCK}="foot"]>div,[${ATTR_BLOCK}="foot"]>div>div{flex-wrap:wrap}
[${ATTR_BLOCK}] button,[${ATTR_BLOCK}] a{max-width:100%;min-width:0;overflow:hidden;text-overflow:ellipsis}

/* 行级 sash：每一条可单独调整的“行”下面都有一条，做法与 pane sash 一致，
   默认只显示一个小握把，鼠标移上去才浮现，不挡点击（热区 7px 落在行间缝里）。 */
[${ATTR_ROW_HINT}]{position:absolute;left:50%;width:26px;height:3px;margin-left:-13px;border-radius:2px;
  background:var(--dsw-alias-brand-primary,#4d6bfe);pointer-events:none;z-index:9;display:none}
[${ATTR_SEAM}],[${ATTR_DRAGGING}]{cursor:row-resize}
[${ATTR_SEAM}] *,[${ATTR_DRAGGING}]*{cursor:row-resize!important}
[${ATTR_DRAGGING}]{user-select:none}
`

    function injectCss() {
      try {
        if (document.getElementById(CSS_ID)) return
        const style = document.createElement('style')
        style.id = CSS_ID
        style.textContent = CSS
        ;(document.head || document.documentElement).appendChild(style)
      } catch (error) { /* 无 head 的极端环境：功能可用，样式缺失 */ }
    }

    /* ---------------- 状态（localStorage 为唯一真源） ---------------- */

    const listeners = new Set()
    let version = 0

    function emptyState() {
      return { mode: 'keep', heights: {}, rows: {}, hidden: [] }
    }

    function readStore() {
      const fallback = emptyState()
      try {
        let raw = window.localStorage.getItem(STORE_KEY)
        if (!raw) {
          // 老版本（v2，逐行 zoom）直接丢弃：模型换了，旧数值没有可比性。
          try { window.localStorage.removeItem(LEGACY_KEY) } catch (error) { /* 隐私模式 */ }
          // v4 → v5：v4 里存的是“绝对像素高度”，而且被旧版的预算/缩放写坏过
          // （例如 nav=89 却要装 3 行 36px 的面板行，底栏 207 却装不下头像行）。
          // 绝对高度只对当时的排版有效，换到现在的排版必然错位，
          // 所以只继承“重启后模式”和“折叠状态”，高度回到原生。
          const stale4 = window.localStorage.getItem(LEGACY_V4)
          if (stale4) {
            try {
              const old = JSON.parse(stale4)
              const migrated = {
                mode: old && old.mode === 'reset' ? 'reset' : 'keep',
                heights: {},
                rows: {},
                hidden: Array.isArray(old && old.hidden) ? old.hidden : [],
              }
              window.localStorage.setItem(STORE_KEY, JSON.stringify(migrated))
              window.localStorage.removeItem(LEGACY_V4)
              raw = window.localStorage.getItem(STORE_KEY)
            } catch (error) { raw = null }
          }
          if (!raw) return fallback
        }
        const parsed = JSON.parse(raw)
        if (!parsed || typeof parsed !== 'object') return fallback
        const hidden = Array.isArray(parsed.hidden)
          ? parsed.hidden.filter((id) => BLOCK_ORDER.includes(id))
          : []
        const heights = {}
        if (parsed.heights && typeof parsed.heights === 'object') {
          for (const id of Object.keys(parsed.heights)) {
            if (!FIXED_PANES.includes(id) && !/^extra:\d+$/.test(id)) continue
            const n = Number(parsed.heights[id])
            if (!Number.isFinite(n)) continue
            const h = Math.round(n)
            if (h >= (MIN_PANE[id] || 18)) heights[id] = h
          }
        }
        // 行级覆盖：键形如 `nav:2` / `foot0:1`，值是该行的固定高度。
        const rows = {}
        if (parsed.rows && typeof parsed.rows === 'object') {
          for (const key of Object.keys(parsed.rows)) {
            if (!/^(?:nav(?:-\d+)*|foot\d*(?:-\d+)*|acct):\d+$/.test(key)) continue
            const n = Number(parsed.rows[key])
            if (!Number.isFinite(n)) continue
            const h = Math.round(n)
            if (h >= MIN_ROW) rows[key] = h
          }
        }
        const mode = parsed.mode === 'reset' ? 'reset' : 'keep'
        if (mode === 'reset') {
          // 设成“重启后保持默认”：每次启动都把块高与行高清掉，回到原生布局。
          return { mode, heights: {}, rows: {}, hidden: [...new Set(hidden)] }
        }
        return { mode, heights, rows, hidden: [...new Set(hidden)] }
      } catch (error) {
        return fallback
      }
    }

    let state = readStore()

    function persist() {
      try {
        window.localStorage.setItem(STORE_KEY, JSON.stringify(state))
      } catch (error) { /* 隐私模式：内存里仍然生效 */ }
    }

    function notify() {
      version += 1
      for (const listener of listeners) {
        try { listener() } catch (error) { /* 单个订阅者异常不影响其它人 */ }
      }
    }

    function commit(patch) {
      state = { ...state, ...patch }
      persist()
      notify()
      schedule()
    }

    function subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }

    function getVersion() { return version }

    /* ---------------- DOM 识别 ---------------- */

    function hasToken(el, name) {
      if (!el || !el.classList) return false
      for (const token of el.classList) {
        if (token === name) return true
        if (token.endsWith('_' + name) || token.endsWith('-' + name)) return true
      }
      return false
    }

    function ownNode(el) {
      if (!el || !el.hasAttribute) return false
      if (el.hasAttribute(ATTR_DOCK) || el.hasAttribute(ATTR_GUTTER) || el.hasAttribute(ATTR_SASH)) return true
      if (el.hasAttribute(ATTR_ROWSPACE) || el.hasAttribute(ATTR_RSASH)) return true
      return el.hasAttribute(ATTR_CHIP) || el.hasAttribute(ATTR_TIP)
    }

    /** 事件是否落在插件自己的节点上（gutter / dock / 提示 / 行缝提示 / sash）。 */
    function insideOwnNodes(el) {
      let node = el
      while (node && node.nodeType === 1) {
        if (node === ui.gutter || node === ui.dock || node === ui.rowHint || node === tipEl) return true
        if (node.getAttribute && node.getAttribute(ATTR_SASH) !== null) return true
        node = node.parentNode
      }
      return false
    }

    function findRoot() {
      const nav = document.querySelector('nav[class*="panelList"]')
      if (nav && nav.parentElement) return nav.parentElement
      const foot = document.querySelector('[class*="footArea"]')
      if (foot && foot.parentElement) return foot.parentElement
      return null
    }

    /** 原生折叠成 56px 窄轨时让位：不做任何接管。 */
    function isRail(root) {
      if (!root || !root.classList) return false
      for (const token of root.classList) {
        if (token === 'collapsed' || token.endsWith('_collapsed')) return true
      }
      return false
    }

    /** 把 root 的可见子元素认成 5 个 pane；React 重挂后重新算，不缓存节点。 */
    function readPanes(root) {
      const kids = []
      for (const el of root.children) {
        if (ownNode(el)) continue
        kids.push(el)
      }
      const by = (name) => kids.find((el) => hasToken(el, name)) || null
      const nav = by('panelList')
      let main = by('regionArea')
      const foot = by('footArea')

      const navIndex = nav ? kids.indexOf(nav) : -1
      const mainIndex = main ? kids.indexOf(main) : -1
      const footIndex = foot ? kids.indexOf(foot) : -1

      // regionArea 认不出来就用“nav 与 foot 之间”兜底。
      if (!main && navIndex >= 0 && footIndex > navIndex + 1) main = kids[navIndex + 1]
      else if (!main && footIndex > 0) main = kids[footIndex - 1]

      const cut = navIndex >= 0 ? navIndex : main ? kids.indexOf(main) : kids.length
      const before = cut > 0 ? kids.slice(0, cut) : []

      const brand = before.find((el) => hasToken(el, 'logoRow')) || before[0] || null
      const fresh =
        before.find((el) => el !== brand && (hasToken(el, 'newSession') || el.tagName === 'BUTTON')) ||
        before[1] ||
        null

      if (!nav && !main && !foot) return null
      // 其它插件往 root 里加的东西（状态条、宠物、自定义区块）也算可调 pane：
      // 它们各自带自己的分割条，不需要改本插件。
      const extras = kids.filter((el) => el !== brand && el !== fresh && el !== nav && el !== main && el !== foot)
      const ordered = []
      for (const el of kids) {
        if (el === brand) ordered.push('brand')
        else if (el === fresh) ordered.push('new')
        else if (el === nav) ordered.push('nav')
        else if (el === main) ordered.push('main')
        else if (el === foot) ordered.push('foot')
        else ordered.push('extra:' + extras.indexOf(el))
      }
      return { brand, new: fresh, nav, main, foot, kids, extras, ordered }
    }

    function paneElement(panes, id) {
      if (!panes || !id) return null
      if (id.indexOf('extra:') === 0) return panes.extras ? panes.extras[Number(id.slice(6))] || null : null
      return panes[id] || null
    }

    /** root 里现存 pane 的 key，按 DOM 顺序。 */
    function paneKeys(panes) {
      if (!panes || !panes.ordered) return []
      return panes.ordered.filter((key) => paneElement(panes, key))
    }

    /** 每个分割条改的是哪一块、方向如何：main|foot 这一条反向。 */
    function sashSpecFor(above, below) {
      if (above === 'main') return { above, below, target: below, inverted: true }
      return { above, below, target: above, inverted: false }
    }

    /** 稳定 id：老的四条沿用旧名，插件新加的块用 `x:<above>`。 */
    function sashIdFor(above) {
      if (above === 'brand' || above === 'new' || above === 'nav') return above
      if (above === 'main') return 'foot'
      return 'x:' + above
    }

    function blockElements(panes, id) {
      if (!panes) return []
      if (id === 'header') return [panes.brand, panes.new].filter(Boolean)
      const el = panes[id]
      return el ? [el] : []
    }

    function isHidden(id) {
      return state.hidden.indexOf(id) >= 0
    }

    /** 折叠某段时一并隐藏的 pane。 */
    function panesForBlock(id) {
      if (id === 'header') return ['brand', 'new']
      if (id === 'nav') return ['nav']
      if (id === 'main') return ['main']
      if (id === 'foot') return ['foot']
      return []
    }

    /* ---------------- 只写变化过的行内样式 ---------------- */

    /** 宿主用 MutationObserver 盯 style，每帧重复写同样的值会造成空转的 rAF 循环。 */
    function writeStyle(el, prop, value, priority) {
      const next = priority || ''
      if (el.style.getPropertyValue(prop) === value && el.style.getPropertyPriority(prop) === next) return
      el.style.setProperty(prop, value, next)
    }

    function dropStyle(el, prop) {
      if (el.style.getPropertyValue(prop)) el.style.removeProperty(prop)
    }

    function writeText(el, prop, value) {
      if (el[prop] !== value) el[prop] = value
    }

    /* ---------------- pane 高度 ---------------- */

    function savedHeight(id) {
      const value = state.heights[id]
      return typeof value === 'number' && Number.isFinite(value) ? value : null
    }

    function contentBoxHeight(root) {
      const rect = root.getBoundingClientRect()
      const view = root.ownerDocument && root.ownerDocument.defaultView
      let padTop = 0
      let padBottom = 0
      try {
        const cs = view.getComputedStyle(root)
        padTop = parseFloat(cs.paddingTop) || 0
        padBottom = parseFloat(cs.paddingBottom) || 0
      } catch (error) { /* 取不到就不扣内边距 */ }
      const height = rect.height - padTop - padBottom
      return height > 0 ? height : 0
    }


    /* A single layout pass owns both pane and row sizes. Never persist a temporary
       viewport constraint: a larger window must recover the user's requested size. */
    const layoutStyles = new Map()
    let layoutNodes = new Map()
    let layoutPanes = new Map()
    let priorityPane = null
    let priorityRow = null
    let layoutBudget = 0

    function layoutStyle(el, prop, value) {
      let originals = layoutStyles.get(el)
      if (!originals) { originals = new Map(); layoutStyles.set(el, originals) }
      if (!originals.has(prop)) originals.set(prop, [el.style.getPropertyValue(prop), el.style.getPropertyPriority(prop)])
      writeStyle(el, prop, value, 'important')
    }

    function restoreLayout() {
      for (const [el, props] of layoutStyles) {
        for (const [prop, [value, priority]] of props) {
          if (value) writeStyle(el, prop, value, priority)
          else dropStyle(el, prop)
        }
        el.removeAttribute(ATTR_ZOOM)
        el.removeAttribute(ATTR_ROW)
      }
      layoutStyles.clear()
    }

    function distribute(nodes, space, protectedNode) {
      const sizes = nodes.map(node => Math.max(node.min, node.want))
      let deficit = sizes.reduce((sum, size) => sum + size, 0) - space
      // Preserve the dragged branch until every other branch reaches its minimum.
      for (const protectedPass of [false, true]) {
        const indexes = nodes.map((node, i) => i).filter(i => !!protectedNode?.(nodes[i]) === protectedPass)
        const room = indexes.reduce((sum, i) => sum + sizes[i] - nodes[i].min, 0)
        const take = Math.min(Math.max(0, deficit), room)
        for (const i of indexes) if (room > 0) sizes[i] -= take * (sizes[i] - nodes[i].min) / room
        deficit -= take
      }
      return sizes
    }

    // display:contents participates through its children, never through a 0px box.
    function boxChildren(el) {
      return Array.from(el.children).flatMap(child => {
        if (ownNode(child)) return []
        const display = window.getComputedStyle(child).display
        return display === 'none' ? [] : display === 'contents' ? boxChildren(child) : [child]
      })
    }

    function layoutSidebar(panes, root) {
      // The shell may render the action slot as a real box. In the remote
      // plugin's shared/wrapped footer it must expose its children to the
      // same grid as settings, without moving any React-owned elements.
      if (panes.foot) {
        const cs = window.getComputedStyle(panes.foot)
        if (cs.flexDirection.startsWith('row') && cs.flexWrap === 'wrap') {
          for (const slot of panes.foot.querySelectorAll('[data-slot="sidebar.footer.action"]')) {
            if (window.getComputedStyle(slot).display !== 'none') layoutStyle(slot, 'display', 'contents')
          }
        }
      }
      const rowKeys = new Map()
      for (const [key, el] of rowElementsByKey(panes)) if (!rowKeys.has(el)) rowKeys.set(el, key)
      layoutNodes = new Map()
      layoutPanes = new Map()
      const number = value => parseFloat(value) || 0
      const activeRow = drag?.kind === 'row' ? drag.row : priorityRow
      const makeNode = (el) => {
        const rect = el.getBoundingClientRect()
        const cs = window.getComputedStyle(el)
        const natural = Math.max(1, rect.height)
        const key = rowKeys.get(el)
        const children = boxChildren(el)
        const sharedFooter = el === panes.foot && cs.flexDirection.startsWith('row') && cs.flexWrap === 'wrap'
        const containsRows = children.some(child => rowKeys.has(child) || Array.from(rowKeys.keys()).some(row => child.contains(row)))
        const vertical = cs.display !== 'flex' || !cs.flexDirection.startsWith('row')
        let kids = containsRows && (vertical || children.length === 1 || sharedFooter) ? children.map(makeNode) : []
        if (sharedFooter && kids.length) {
          const bottom = kids.filter(child => child.el.contains(accountEl) || child.el.matches('[data-dsh-part="entry"], [class*="entryRow"]'))
          if (bottom.some(child => child.el.contains(accountEl))) {
            bottom.sort((a, b) => number(window.getComputedStyle(a.el).order) - number(window.getComputedStyle(b.el).order))
            // These are native icon controls sharing the account line, not cards
            // to zoom or separate into new vertical rows.
            for (const child of bottom) {
              child.min = child.natural
              child.want = Math.max(child.min, child.want)
            }
            const group = { el:null, horizontal:true, kids:bottom, mt:0, mb:0, overhead:0,
              min:Math.max(...bottom.map(child => child.min)), want:Math.max(...bottom.map(child => child.want)),
              active:bottom.some(child => child.active), hasAccount:true }
            kids = [...kids.filter(child => !bottom.includes(child)), group]
          }
        }
        const mt = number(cs.marginTop), mb = number(cs.marginBottom)
        const node = { el, key, natural, kids, mt, mb, sharedFooter, hasAccount:el.contains(accountEl), active: el === activeRow || !!activeRow && el.contains(activeRow) }
        for (const child of kids) {
          child.parent = node
          if (child.horizontal) for (const item of child.kids) item.parent = child
        }
        if (kids.length) {
          // Padding/borders/gaps, not the container's blank or auto-margin space.
          node.overhead = number(cs.paddingTop) + number(cs.paddingBottom) + number(cs.borderTopWidth) + number(cs.borderBottomWidth)
            + number(cs.rowGap) * Math.max(0, kids.length - 1) + kids.reduce((sum, kid) => sum + kid.mt + kid.mb, 0)
          node.min = node.overhead + kids.reduce((sum, kid) => sum + kid.min, 0)
          node.want = node.overhead + kids.reduce((sum, kid) => sum + kid.want, 0)
        } else {
          // An indivisible horizontal row may wrap the avatar plus action buttons.
          // Do not zoom any ancestor leaf that contains the reserved account row.
          node.min = el === accountEl || el.contains(accountEl) ? natural : Math.min(natural, Math.max(MIN_ROW, natural * MIN_FIT))
          node.want = natural
        }
        if (key && rowSaved(key) !== null) node.want = Math.max(node.min, rowSaved(key))
        if (key) rowNatCache.set(el, natural)
        layoutNodes.set(el, node)
        return node
      }
      const nodes = []
      for (const id of paneKeys(panes)) {
        const el = paneElement(panes, id)
        if (paneHidden(id) || !el || window.getComputedStyle(el).display === 'none') continue
        if (id === 'main') continue
        const node = makeNode(el)
        node.id = id
        if (savedHeight(id) !== null) node.want = Math.max(node.min, savedHeight(id))
        nodes.push(node)
        layoutPanes.set(id, node)
      }
      const main = panes.main && !paneHidden('main') ? panes.main : null
      const mainStyle = main ? window.getComputedStyle(main) : null
      const margins = nodes.reduce((sum, node) => sum + node.mt + node.mb, 0)
        + (mainStyle ? number(mainStyle.marginTop) + number(mainStyle.marginBottom) : 0)
      const rootStyle = window.getComputedStyle(root)
      const rootGap = number(rootStyle.rowGap) * Math.max(0, nodes.length + (main ? 1 : 0) - 1)
      const budget = Math.max(0, contentBoxHeight(root) - margins - rootGap - (main ? MIN_MAIN : 0))
      layoutBudget = budget
      const activePane = drag ? (drag.kind === 'row' ? nodes.find(node => node.el.contains(drag.row))?.id : drag.target) : priorityPane
      const sizes = distribute(nodes, budget, node => node.id === activePane)
      const sizeNode = (node, height) => {
        height = Math.max(node.min, height)
        node.actual = height
        const { el, kids } = node
        if (node.horizontal) {
          kids.forEach(child => sizeNode(child, Math.max(child.min, Math.min(height, child.want))))
          // This virtual row has no box of its own. Count only its rendered
          // controls so the footer can reuse the empty grid track above them.
          node.actual = Math.max(...kids.map(child => child.actual + child.mt + child.mb))
          return
        }
        const scale = kids.length ? 1 : Math.min(1, height / node.natural)
        layoutStyle(el, 'box-sizing', 'border-box')
        layoutStyle(el, 'min-height', '0px')
        layoutStyle(el, 'max-height', 'none')
        layoutStyle(el, 'flex-grow', '0')
        layoutStyle(el, 'flex-shrink', '0')
        layoutStyle(el, 'height', height / scale + 'px')
        layoutStyle(el, 'flex-basis', height / scale + 'px')
        layoutStyle(el, 'overflow', 'hidden')
        if (scale < .9999) {
          // Zoom the complete row, not individual flex children: explicit fonts,
          // padding, icons and gaps shrink together, without reordering React DOM.
          layoutStyle(el, 'zoom', String(scale))
          const cs = window.getComputedStyle(el)
          const horizontalMargins = number(cs.marginLeft) + number(cs.marginRight)
          // Percentage widths already resolve against the zoom-adjusted
          // containing block. Dividing again would push the right-hand text
          // outside the sidebar and hide it behind an ancestor's overflow.
          layoutStyle(el, 'width', `calc(100% - ${horizontalMargins}px)`)
          layoutStyle(el, 'max-width', 'none')
          layoutStyle(el, 'margin-top', node.mt / scale + 'px')
          layoutStyle(el, 'margin-bottom', node.mb / scale + 'px')
          el.setAttribute(ATTR_ZOOM, String(scale))
        }
        if (node.key) el.setAttribute(ATTR_ROW, node.key)
        if (kids.length) {
          layoutStyle(el, 'display', 'flex')
          layoutStyle(el, 'flex-direction', 'column')
          const childSizes = distribute(kids, height - node.overhead, child => child.active)
          const spare = Math.max(0, height - node.overhead - childSizes.reduce((sum, size) => sum + size, 0))
          const last = kids[kids.length - 1]
          if (spare > 0 && last.hasAccount && last.kids.length) childSizes[childSizes.length - 1] += spare
          kids.forEach((child, i) => sizeNode(child, childSizes[i]))
          if (spare > 0 && last.hasAccount && !last.kids.length) layoutStyle(last.el, 'margin-top', 'auto')
          if (node.sharedFooter && last.horizontal) {
            // A grid models actual visual rows across transparent slot hosts,
            // retaining React ownership and the native final account/icon row.
            layoutStyle(el, 'display', 'grid')
            layoutStyle(el, 'grid-template-columns', ['minmax(0, 1fr)', ...last.kids.slice(1).map(() => 'max-content')].join(' '))
            layoutStyle(el, 'grid-template-rows', [...childSizes.slice(0, -1).map((size, i) => (size + kids[i].mt + kids[i].mb) + 'px'), 'minmax(0, 1fr)'].join(' '))
            kids.slice(0, -1).forEach((child, i) => {
              layoutStyle(child.el, 'grid-column', '1 / -1')
              layoutStyle(child.el, 'grid-row', String(i + 1))
              layoutStyle(child.el, 'width', '100%')
              layoutStyle(child.el, 'align-self', 'start')
            })
            last.kids.forEach((child, i) => {
              layoutStyle(child.el, 'grid-column', String(i + 1))
              layoutStyle(child.el, 'grid-row', String(kids.length))
              layoutStyle(child.el, 'align-self', 'end')
              layoutStyle(child.el, 'min-width', '0px')
            })
          }
        }
      }
      nodes.forEach((node, i) => {
        sizeNode(node, sizes[i])
        node.el.setAttribute(ATTR_PANE, node.id)
      })
      if (main) {
        layoutStyle(main, 'flex-grow', '1')
        layoutStyle(main, 'flex-shrink', '0')
        layoutStyle(main, 'flex-basis', '0px')
        layoutStyle(main, 'min-height', MIN_MAIN + 'px')
        layoutStyle(main, 'overflow', 'hidden')
        main.setAttribute(ATTR_PANE, 'main')
      }
      // Flex main consumes free space. When it is collapsed, keep footer at bottom.
      if (panes.foot) layoutStyle(panes.foot, 'margin-top', 'auto')
      return { heights: Object.fromEntries(nodes.map(node => [node.id, node.actual])) }
    }

    // Account content retains its native size; the shared solver reserves it.
    let accountEl = null

    /* ---------------- 自有节点 ---------------- */

    const ui = { dock: null, gutter: null, root: null, panes: null, sashes: {}, sashSpec: {}, rowScopes: [], rowHint: null, rowSeam: null }

    function ensureDock(root) {
      if (ui.dock && ui.dock.isConnected) return ui.dock
      ui.dock = root.querySelector(':scope > [' + ATTR_DOCK + ']')
      if (!ui.dock) {
        ui.dock = document.createElement('div')
        ui.dock.setAttribute(ATTR_DOCK, '')
        ui.dock.hidden = true
        root.appendChild(ui.dock)
      }
      return ui.dock
    }

    function ensureGutter(root) {
      if (ui.gutter && ui.gutter.isConnected) return ui.gutter
      ui.gutter = root.querySelector(':scope > [' + ATTR_GUTTER + ']')
      if (!ui.gutter) {
        ui.gutter = document.createElement('div')
        ui.gutter.setAttribute(ATTR_GUTTER, '')
        ui.gutter.setAttribute('aria-hidden', 'true')
        root.insertBefore(ui.gutter, root.firstChild)
      }
      return ui.gutter
    }

    function makeCollapseButton(id) {
      const button = document.createElement('button')
      button.type = 'button'
      button.setAttribute('data-dsh-sw-collapse', id)
      button.setAttribute('aria-label', '折叠' + (BLOCK_LABEL[id] || id))
      button.title = '折叠 / 展开：' + (BLOCK_LABEL[id] || id)
      button.innerHTML = COLLAPSE_ICON
      button.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        toggleBlock(id)
      })
      return button
    }

    function ensureCollapseButtons(gutter) {
      for (const id of BLOCK_ORDER) {
        if (!gutter.querySelector('[data-dsh-sw-collapse="' + id + '"]')) {
          gutter.appendChild(makeCollapseButton(id))
        }
      }
    }

    /* ---------------- sash ---------------- */

    function sashLabel(sashId) {
      const spec = ui.sashSpec[sashId]
      const key = spec ? spec.target : SASH_TARGET[sashId] || sashId
      return PANE_LABEL[key] || key
    }

    function makeSash(id) {
      const sash = document.createElement('div')
      sash.setAttribute(ATTR_SASH, id)
      sash.setAttribute('role', 'separator')
      sash.setAttribute('aria-orientation', 'horizontal')
      sash.setAttribute('aria-label', '调整' + sashLabel(id) + '高度')
      sash.title = '拖动：调整「' + sashLabel(id) + '」高度（双击复位）'
      sash.addEventListener('pointerdown', (event) => onSashDown(event, id))
      sash.addEventListener('dblclick', (event) => {
        event.preventDefault()
        event.stopPropagation()
        resetPane(id)
      })
      // 触摸/触控笔也能拖（pointer 事件已覆盖，这里只挡默认滚动）。
      sash.addEventListener('touchstart', (event) => event.preventDefault(), { passive: false })
      return sash
    }

    /** 让 4 条 sash 正好夹在相邻 pane 之间；缺了补、多了删。 */
    function renderSashes(root, panes) {
      const gutter = ensureGutter(root)
      ensureCollapseButtons(gutter)
      const wanted = []
      const keys = paneKeys(panes).filter((key) => !paneHidden(key))
      ui.sashSpec = {}
      for (let i = 1; i < keys.length; i += 1) {
        const aboveKey = keys[i - 1]
        const belowKey = keys[i]
        const above = paneElement(panes, aboveKey)
        const below = paneElement(panes, belowKey)
        if (!above || !below) continue
        const id = sashIdFor(aboveKey)
        ui.sashSpec[id] = sashSpecFor(aboveKey, belowKey)
        wanted.push({ id, anchor: above, below })
      }

      const seen = new Set()
      for (const item of wanted) {
        const key = item.id
        seen.add(key)
        let sash = ui.sashes[key]
        if (!sash || !sash.isConnected) {
          sash = makeSash(key)
          ui.sashes[key] = sash
        }
        // 插在“上一块”与“下一块”之间：sash 自身 0 高，不改变布局。
        const nextSibling = item.anchor.nextSibling
        if (nextSibling !== sash) item.anchor.parentNode.insertBefore(sash, item.anchor.nextSibling)
        writeStyle(sash, 'display', '')
      }
      for (const key of Object.keys(ui.sashes)) {
        if (seen.has(key)) continue
        const sash = ui.sashes[key]
        if (sash && sash.parentNode) sash.parentNode.removeChild(sash)
        delete ui.sashes[key]
      }
    }

    /** 单个 pane 是否被折叠藏起来了（foot 折叠只藏内容，pane 本身还在）。 */
    function paneHidden(key) {
      if (!key) return false
      if (key === 'brand' || key === 'new') return isHidden('header')
      if (key === 'nav') return isHidden('nav')
      if (key === 'main') return isHidden('main')
      if (key === 'foot') return false
      return false
    }

    function isPaneHidden(id) {
      if (id === 'main') return isHidden('main')
      if (id === 'nav') return isHidden('nav')
      if (id === 'foot') return isHidden('foot')
      return isHidden('header')
    }

    /* ---------------- 拖拽 ---------------- */

    let drag = null

    function onSashDown(event, sashId) {
      if (!listening || drag) return
      if (event.pointerType === 'mouse' && typeof event.button === 'number' && event.button !== 0) return
      const spec = ui.sashSpec[sashId]
      const target = spec ? spec.target : SASH_TARGET[sashId]
      const panes = ui.panes
      if (!target || !panes || !paneElement(panes, target)) return
      event.preventDefault()
      event.stopPropagation()

      const root = ui.root
      // Pointer deltas start from the rendered size, never an old saved request.
      const heights = {}
      const fixed = paneKeys(panes).filter((key) => key !== 'main')
      for (const id of fixed) {
        const el = paneElement(panes, id)
        heights[id] = el ? el.getBoundingClientRect().height : 0
      }

      // 原生高度：拖回这个值就等于“取消覆盖”，不能拿当前（可能已被压缩的）高度当基准。
      const native = layoutPanes.get(target)?.natural || heights[target] || 18

      // 可增长的上限：内容高度 − 主区下限 − 其它固定块的当前高度。
      const minimumOthers = fixed.filter(id => id !== target).reduce((sum, id) => sum + (layoutPanes.get(id)?.min || heights[id]), 0)
      const max = Math.max(heights[target], layoutBudget - minimumOthers)
      // main|foot 这条分界反向：往上拖 = foot 变高。
      const inverted = spec ? spec.inverted : sashId === 'foot'

      // 紧贴底部（foot）的那条缝：往下拖 = 上面那块变高（把底部推下去），
      // 往上拖 = 底部那块变高。这样折叠掉中间的 main 之后，底部依然可调。
      const dual = spec && spec.below === 'foot' && spec.above !== 'main' && target !== 'foot'
        ? {
            down: { target, inverted: false, h0: heights[target] || 18, natural: native },
            up: {
              target: 'foot',
              inverted: true,
              h0: heights.foot || 0,
              natural: layoutPanes.get('foot')?.natural || heights.foot || 22,
            },
          }
        : null

      drag = {
        sashId,
        target,
        inverted,
        dual,
        y0: event.clientY,
        h0: heights[target] || native,
        natural: native,
        min: layoutPanes.get(target)?.min || paneMin(target, native),
        max,
        h: heights[target] || native,
      }
      priorityPane = target
      priorityRow = null
      if (root) root.setAttribute('data-dsh-sw-dragging', '1')
      const sash = ui.sashes[sashId]
      if (sash) sash.setAttribute('data-dsh-sw-active', '')
      window.addEventListener('pointermove', onDragMove, true)
      window.addEventListener('pointerup', onDragEnd, true)
      window.addEventListener('pointercancel', onDragEnd, true)
    }

    /** 某块能长到多高：内容高度 − 主区下限 − 其它固定块。 */
    function contentHMax(target) {
      let others = 0
      for (const [key, node] of layoutPanes) if (key !== target) others += node.min
      return Math.max(layoutPanes.get(target)?.min || MIN_PANE[target] || 22, layoutBudget - others)
    }

    function onDragMove(event) {
      if (!drag || !listening) return
      event.preventDefault()
      const dy = event.clientY - drag.y0
      if (drag.kind === 'row' && !drag.started) {
        if (Math.abs(dy) < 3) return
        drag.started = true
        event.preventDefault()
        event.stopPropagation()
      }
      if (drag.dual && drag.target === drag.dual.down.target) {
        // 还没定方向：超过 3px 后按方向选“上面那块”还是“下面那块”。
        if (Math.abs(dy) < 3) return
        const pick = dy < 0 ? drag.dual.up : drag.dual.down
        drag.target = pick.target
        drag.inverted = pick.inverted
        drag.h0 = pick.h0
        drag.natural = pick.natural
        drag.max = Math.max(pick.h0, contentHMax(pick.target))
        drag.min = layoutPanes.get(pick.target)?.min || paneMin(pick.target, drag.natural)
        priorityPane = pick.target
        drag.h = pick.h0
      }
      const raw = drag.h0 + (drag.inverted ? -dy : dy)
      const h = Math.round(Math.min(drag.max, Math.max(drag.min, raw)))
      if (h === drag.h) return
      drag.h = h
      drag.moved = true
      if (drag.kind === 'row') {
        const rows = { ...rowOverrides(), [drag.key]: h }
        const heights = { ...state.heights }
        let growth = h - drag.h0
        // Follow the entire branch, not only the outer pane: a saved intermediate
        // group would otherwise trap the child and compress its siblings instead.
        for (const ancestor of drag.ancestors) {
          growth = Math.max(0, growth - ancestor.slack)
          if (!ancestor.pane && ancestor.saved === null) continue
          if (growth > 0 || ancestor.changed) {
            ancestor.changed = true
            if (ancestor.pane) heights[ancestor.key] = ancestor.height + growth
            else rows[ancestor.key] = ancestor.height + growth
          }
        }
        state = { ...state, rows, heights }
      } else {
        state = { ...state, heights: { ...state.heights, [drag.target]: h } }
      }
      schedule()
    }

    function onDragEnd() {
      window.removeEventListener('pointermove', onDragMove, true)
      window.removeEventListener('pointerup', onDragEnd, true)
      window.removeEventListener('pointercancel', onDragEnd, true)
      if (ui.root) ui.root.removeAttribute('data-dsh-sw-dragging')
      if (!drag) return
      const finished = drag
      drag = null
      const sash = ui.sashes[finished.sashId]
      if (sash) sash.removeAttribute('data-dsh-sw-active')
      // 只按了一下没拖动：不写盘、不改状态，保持原样。
      if (!finished.moved) return
      if (finished.kind === 'row') {
        suppressClickUntil = Date.now() + 250
        hideRowHint()
        const rows = { ...rowOverrides() }
        if (Math.abs(finished.h - (finished.natural || 0)) <= 1) delete rows[finished.key]
        else rows[finished.key] = finished.h
        state = { ...state, rows }
        persist()
        notify()
        schedule()
        return
      }
      const next = { ...state.heights }
      // 正好拖回原生高度才算“取消覆盖”；比原生更大是用户明确要的更大高度。
      if (Math.abs(finished.h - (finished.natural || 0)) <= 1) delete next[finished.target]
      else next[finished.target] = finished.h
      state = { ...state, heights: next }
      persist()
      notify()
      schedule()
    }

    function resetPane(sashId) {
      const spec = ui.sashSpec[sashId]
      const target = spec ? spec.target : SASH_TARGET[sashId]
      if (!target) return
      const next = { ...state.heights }
      delete next[target]
      commit({ heights: next })
    }

    /* ---------------- 行级 sash（每一个条目都能单独调高） ---------------- */

    function rowOverrides() {
      return state.rows && typeof state.rows === 'object' ? state.rows : {}
    }

    function rowSaved(key) {
      const value = rowOverrides()[key]
      return typeof value === 'number' && Number.isFinite(value) ? Math.max(rowMin(key), Math.round(value)) : null
    }

    function rowMin(key) {
      return key === ACCOUNT_KEY ? MIN_ACCOUNT : MIN_ROW
    }

    /** 这一行的原生高度：第一次见到（还没被我们改过）时量一次并记住。 */
    const rowNatCache = new WeakMap()

    function rowNatural(row) {
      return layoutNodes.get(row)?.natural || rowNatCache.get(row) || row.getBoundingClientRect().height || MIN_ROW
    }

    /**
     * 可单独调整的“行”分成若干 scope（同 scope 内是兄弟节点，才有可拖的缝）：
     *   nav            → 面板列表里的每一行（插件 / 自动化任务 / 任务看板 …）
     *   foot           → 底部区块之间（用量卡组 / 远程控制组 …）
     *   foot<index>    → 底部每个容器内部的行（用量卡 / 账号行 / 图标行 …）
     */
    function rowScopes(panes) {
      const scopes = []
      const seen = new Set()
      const isRowContainer = (el) => {
        try {
          const cs = window.getComputedStyle(el)
          // Framed/padded cards are atomic even when their own layout is
          // flex-column. Descendant text and progress bars must zoom together.
          if (['paddingTop', 'paddingBottom', 'borderTopWidth', 'borderBottomWidth'].some(prop => parseFloat(cs[prop]) > 0)) return false
          if (cs.display === 'flex' || cs.display === 'inline-flex') return !cs.flexDirection.startsWith('row')
          // Plain host wrappers are vertical even though their computed
          // flexDirection defaults to "row".
          return true
        } catch (error) { return false }
      }
      const collect = (container, id, depth) => {
        if (!container || depth > 3 || seen.has(container)) return
        seen.add(container)
        // 穿透纯包裹层：宿主很多容器只有 1 个子元素，真正的一排在更里面。
        let node = container
        for (let guard = 0; guard < 4; guard += 1) {
          const cs = window.getComputedStyle(node)
          if (['paddingTop', 'paddingBottom', 'borderTopWidth', 'borderBottomWidth'].some(prop => parseFloat(cs[prop]) > 0)) return
          const kids = boxChildren(node)
          if (kids.length !== 1) break
          const inner = kids[0]
          if (!inner || (inner.children && inner.children.length === 0)) break
          node = inner
        }
        if (!isRowContainer(node)) return
        const rows = boxChildren(node).filter(child => child !== accountEl)
        if (rows.length) scopes.push({ id, container: node, rows })
        if (depth >= 3) return
        const kids = boxChildren(node).filter(child => child !== accountEl)
        for (let i = 0; i < kids.length; i += 1) {
          const child = kids[i]
          if (!child.children || !child.children.length) continue
          collect(child, id + '-' + i, depth + 1)
        }
      }
      if (panes.nav) collect(panes.nav, 'nav', 0)
      if (panes.foot) {
        const rows = boxChildren(panes.foot).filter(child => child !== accountEl)
        if (rows.length) scopes.push({ id: 'foot', container: panes.foot, rows })
        let index = 0
        for (const child of boxChildren(panes.foot)) {
          if (ownNode(child)) continue
          collect(child, 'foot' + index, 0)
          index += 1
        }
      }
      // 头像行是单独一个可调单元：不跟上一块联动，也不能被压到看不见。
      if (accountEl && accountEl.parentNode) {
        const rect = accountEl.getBoundingClientRect()
        if (rect && rect.height >= 1) scopes.push({ id: 'acct', container: accountEl.parentNode, rows: [accountEl], single: true })
      }
      return scopes
    }

    function scopeVisible(scope) {
      if (scope.id === 'nav') return !isPaneHidden('nav')
      if (scope.id === 'acct') return !isPaneHidden('foot')
      if (scope.id === 'foot' || scope.id.indexOf('foot') === 0) return !isPaneHidden('foot')
      return true
    }


    /** key → 元素（与 rowSeams 用同一套 scope，保证拖的是同一行）。 */
    function rowElementsByKey(panes) {
      const map = new Map()
      for (const scope of rowScopes(panes)) {
        if (!scopeVisible(scope)) continue
        for (let i = 0; i < scope.rows.length; i += 1) map.set(scope.id + ':' + i, scope.rows[i])
      }
      return map
    }


    /* 行级拖拽不走任何覆盖元素：命中在 root 上用坐标算，既不会挡点击，
       也不会出现“多个横线”的残留。 */

    const SEAM_REACH = 6

    /** 当前可拖的行缝列表（client 坐标）；每条缝管它上面那一行。 */
    function rowSeams() {
      const out = []
      if (!ui.panes) return out
      let scopes
      try {
        scopes = rowScopes(ui.panes)
      } catch (error) {
        return out
      }
      for (const scope of scopes) {
        if (!scopeVisible(scope)) continue
        const containerRect = scope.container.getBoundingClientRect()
        // 容器本身没尺寸（有的宿主用内容撑开、或包裹层是 display:contents）时，
        // 用行自己的左右边界，别把缝丢掉。
        const span = (rect) => ({
          x0: containerRect.height ? containerRect.left : rect.left,
          x1: containerRect.height ? containerRect.right : rect.right,
        })
        if (scope.single) {
          // 单行 scope（账号行）：缝落在这一行的“下沿”。
          // 放上沿会和“底部块 | 账号行”那条分界缝重合，两条缝抢同一个点，
          // 命中就有一半概率落到另一条上（用户报的“80% 拖不动”）。
          const rect = scope.rows[0].getBoundingClientRect()
          if (rect && rect.height >= 2) {
            out.push({
              key: scope.id + ':' + 0,
              row: scope.rows[0],
              y: rect.bottom - 1,
              ...span(rect),
              edge: 'bottom',
            })
          }
          continue
        }
        for (let i = 0; i < scope.rows.length; i += 1) {
          // Last nav row shares a boundary with the pane sash; footer content
          // before the account still needs its own lower-edge handle.
          if (i === scope.rows.length - 1 && !scope.id.startsWith('foot')) continue
          const rect = scope.rows[i].getBoundingClientRect()
          if (!rect || rect.height < 1) continue
          out.push({
            key: scope.id + ':' + i,
            row: scope.rows[i],
            y: rect.bottom,
            ...span(rect),
          })
        }
      }
      const kept = []
      for (const seam of out.sort((a, b) => a.row.contains(b.row) ? 1 : b.row.contains(a.row) ? -1 : 0)) {
        if (kept.some((other) => Math.abs(other.y - seam.y) <= 2)) continue
        kept.push(seam)
      }
      return kept
    }

    function rowSeamAt(clientY, clientX) {
      let best = null
      let bestDelta = SEAM_REACH + 1
      for (const seam of rowSeams()) {
        if (typeof clientX === 'number' && (clientX < seam.x0 - 6 || clientX > seam.x1 + 6)) continue
        const delta = Math.abs(clientY - seam.y)
        if (delta <= SEAM_REACH && delta < bestDelta) { bestDelta = delta; best = seam }
      }
      return best
    }

    let hintTimer = 0

    function ensureRowHint(gutter) {
      let hint = ui.rowHint
      if (hint && hint.parentNode === gutter) return hint
      hint = document.createElement('div')
      hint.setAttribute(ATTR_ROW_HINT, '')
      hint.setAttribute('aria-hidden', 'true')
      try { gutter.appendChild(hint) } catch (error) { return null }
      ui.rowHint = hint
      return hint
    }

    function showRowHint(seam, root) {
      const gutter = ui.gutter
      if (!gutter || !root) return
      const hint = ensureRowHint(gutter)
      if (!hint) return
      const rootRect = root.getBoundingClientRect()
      writeStyle(hint, 'top', Math.round(seam.y - rootRect.top) + 'px')
      writeStyle(hint, 'display', 'block')
      if (root.getAttribute(ATTR_SEAM) !== '1') root.setAttribute(ATTR_SEAM, '1')
      ui.rowSeam = seam
      // 兜底：指针离开/滚轮/失焦时事件可能不来，2.5 秒没动静就自己收起来。
      if (hintTimer) window.clearTimeout(hintTimer)
      hintTimer = window.setTimeout(() => { hintTimer = 0; hideRowHint() }, 2500)
    }


    function hideRowHint() {
      if (hintTimer) { window.clearTimeout(hintTimer); hintTimer = 0 }
      const hint = ui.rowHint
      if (hint) writeStyle(hint, 'display', 'none')
      const root = ui.root
      if (root && root.getAttribute(ATTR_SEAM) !== null) root.removeAttribute(ATTR_SEAM)
      ui.rowSeam = null
    }

    /** 鼠标经过（不拖动）时只负责显示/隐藏提示线，不接管事件。 */
    function onHoverMove(event) {
      if (!listening || drag) return
      const root = ui.root
      if (!root) return
      if (!root.contains(event.target)) { hideRowHint(); return }
      if (insideOwnNodes(event.target)) { hideRowHint(); return }
      const seam = rowSeamAt(event.clientY, event.clientX)
      if (seam) showRowHint(seam, root)
      else hideRowHint()
    }

    function beginRowDrag(event, seam) {
      const row = seam.row
      const natural = Math.max(MIN_ROW, rowNatural(row) || Math.round(row.getBoundingClientRect().height || MIN_ROW))
      const h0 = row.getBoundingClientRect().height
      const parent = Array.from(layoutPanes.values()).find(node => node.el.contains(row))
      if (!parent) return
      const node = layoutNodes.get(row)
      const minimumOthers = Array.from(layoutPanes.values()).filter(other => other !== parent).reduce((sum, other) => sum + other.min, 0)
      const overhead = parent.min - (node?.min || h0)
      const available = layoutBudget - minimumOthers - overhead
      const ancestors = []
      for (let branch = node?.parent; branch; branch = branch.parent) {
        if (branch?.kids.length) {
          const pane = branch === parent
          ancestors.push({
            key: pane ? parent.id : branch.key,
            pane,
            saved: pane ? savedHeight(parent.id) : branch.key ? rowSaved(branch.key) : null,
            height: branch.actual,
            slack: Math.max(0, branch.actual - branch.overhead - branch.kids.reduce((sum, child) => sum + child.actual, 0)),
          })
        }
        if (branch === parent) break
      }
      priorityPane = parent.id
      priorityRow = row
      drag = {
        kind: 'row',
        key: seam.key,
        row,
        y0: event.clientY,
        h0,
        natural,
        min: node?.min || rowMin(seam.key),
        max: Math.max(h0, available),
        ancestors,
        h: h0,
        started: false,
        moved: false,
      }
      hideRowHint()
      const root = ui.root
      if (root) root.setAttribute(ATTR_DRAGGING, '1')
      window.addEventListener('pointermove', onDragMove, true)
      window.addEventListener('pointerup', onDragEnd, true)
      window.addEventListener('pointercancel', onDragEnd, true)
    }

    /** 按下：只在缝 ±4px 内“记账”，不 preventDefault，所以贴着缝点按键仍是正常点击。 */
    function onRowDown(event) {
      if (!listening || drag) return
      const root = ui.root
      if (!root || !root.contains(event.target)) return
      if (insideOwnNodes(event.target)) return
      if (event.target && event.target.closest && event.target.closest('[' + ATTR_SASH + ']')) return
      if (event.pointerType === 'mouse' && typeof event.button === 'number' && event.button !== 0) return
      const seam = rowSeamAt(event.clientY, event.clientX)
      if (!seam) return
      beginRowDrag(event, seam)
    }

    function onRowDblClick(event) {
      if (!listening) return
      const root = ui.root
      if (!root || !root.contains(event.target)) return
      const seam = rowSeamAt(event.clientY, event.clientX)
      if (!seam) return
      event.preventDefault()
      event.stopPropagation()
      resetRow(seam.key)
    }

    /** 拖完的那一下 click 不要落到行上（否则会顺手打开面板/切工作区）。 */
    let suppressClickUntil = 0

    function onClickCapture(event) {
      if (!suppressClickUntil) return
      if (Date.now() > suppressClickUntil) { suppressClickUntil = 0; return }
      event.preventDefault()
      event.stopPropagation()
      suppressClickUntil = 0
    }

    function sweepRowNodes() {
      const root = ui.root
      if (!root) return
      for (const attr of [ATTR_ROWSPACE, ATTR_RSASH]) {
        const nodes = root.querySelectorAll('[' + attr + ']')
        for (const node of Array.from(nodes)) if (node.parentNode) node.parentNode.removeChild(node)
      }
    }

    /** 捕获期监听里抛错会静默终止后续逻辑：统一兜底并把错误写进诊断属性。 */
    function guard(fn) {
      return function guarded(event) {
        try {
          fn(event)
        } catch (error) {
          fault(error && error.message ? error.message : String(error))
        }
      }
    }

    const rowDownGuarded = guard(onRowDown)
    const hoverMoveGuarded = guard(onHoverMove)
    const rowDblClickGuarded = guard(onRowDblClick)
    const clickGuarded = guard(onClickCapture)
    const hideRowHintGuarded = guard(hideRowHint)

    function resetRow(key) {
      const rows = { ...rowOverrides() }
      delete rows[key]
      commit({ rows })
    }

    /* ---------------- 应用 ---------------- */

    function markBlocks(panes) {
      for (const el of blockElements(panes, 'header')) el.setAttribute(ATTR_BLOCK, 'header')
      if (panes.nav) panes.nav.setAttribute(ATTR_BLOCK, 'nav')
      if (panes.main) panes.main.setAttribute(ATTR_BLOCK, 'main')
      if (panes.foot) panes.foot.setAttribute(ATTR_BLOCK, 'foot')
    }

    /**
     * 底部区折叠：头像那一行留在原地（它就在 footArea 里），
     * 只把这条路径上的旁支藏起来 —— 折叠底部不会连头像一起消失。
     */
    function collapseFoot(panes, hidden) {
      const foot = panes.foot
      if (!foot || !hidden) return
      const keep = accountEl && foot.contains(accountEl) ? accountEl : null
      if (!keep) return
      let node = keep
      while (node && node !== foot) {
        const parent = node.parentNode
        if (!parent) break
        for (const child of parent.children) {
          if (child === node || ownNode(child)) continue
          layoutStyle(child, 'display', 'none')
        }
        node = parent
      }
      layoutStyle(keep, 'margin-top', 'auto')
    }

    function applyCollapse(panes) {
      if (panes.foot) collapseFoot(panes, isHidden('foot'))
      for (const id of BLOCK_ORDER) {
        if (id === 'foot') continue
        const hidden = isHidden(id)
        for (const paneId of panesForBlock(id)) {
          const el = paneElement(panes, paneId)
          if (!el) continue
          if (hidden) {
            layoutStyle(el, 'display', 'none')
          }
        }
      }
    }

    function applyCollapseButtons(panes, root) {
      const gutter = ensureGutter(root)
      ensureCollapseButtons(gutter)
      const rootRect = root.getBoundingClientRect()
      for (const id of BLOCK_ORDER) {
        const button = gutter.querySelector('[data-dsh-sw-collapse="' + id + '"]')
        if (!button) continue
        if (isHidden(id)) {
          // 折叠后按钮依旧存在：贴在图标坞上方，点一下即可展开，不依赖图标坞。
          const dock = ui.dock
          const dockRect = dock && !dock.hidden ? dock.getBoundingClientRect() : null
          const top = dockRect ? Math.round(dockRect.top - rootRect.top - 24) : 0
          writeStyle(button, 'display', '')
          writeStyle(button, 'left', '0px')
          writeStyle(button, 'top', Math.max(0, top) + 'px')
          writeText(button, 'title', '展开：' + (BLOCK_LABEL[id] || id))
          continue
        }
        const target = blockElements(panes, id)[0]
        if (!target) { writeStyle(button, 'display', 'none'); continue }
        const rect = target.getBoundingClientRect()
        if (!rect || rect.height < 1) { writeStyle(button, 'display', 'none'); continue }
        writeStyle(button, 'display', '')
        writeStyle(button, 'left', '0px')
        writeStyle(button, 'top', Math.round(rect.top - rootRect.top + 2) + 'px')
      }
    }

    function toggleBlock(id) {
      const hidden = isHidden(id)
      const next = hidden
        ? state.hidden.filter((item) => item !== id)
        : [...state.hidden, id]
      commit({ hidden: next })
    }

    /* ---------------- 折叠坞（头像正上方） ---------------- */

    let dockSignature = ''

    /** 头像元素（与 avatarTop 同一套判定，但返回节点本身）。 */
    function avatarNode(root) {
      if (!root) return null
      const rootRect = root.getBoundingClientRect()
      let nodes
      try {
        nodes = root.querySelectorAll('[class*="avatar" i], img[src]')
      } catch (error) {
        return null
      }
      let best = null
      let bestTop = -Infinity
      for (const el of Array.from(nodes)) {
        if (el.closest('[' + ATTR_DOCK + ']')) continue
        const rect = el.getBoundingClientRect()
        if (rect.width < 14 || rect.width > 140) continue
        if (rect.height < 14 || rect.height > 140) continue
        if (rect.top < rootRect.top + rootRect.height * 0.45) continue
        if (rect.bottom > rootRect.bottom + 4) continue
        if (rect.top > bestTop) { bestTop = rect.top; best = el }
      }
      return best
    }

    /**
     * 头像所在的那一行（`settingsArea > 账号行 > avatar` 里的“账号行”）。
     * 这一行不参与任何缩放：它永远保持原生大小、被钉在侧栏最底部。
     */
    /**
     * 头像行兜底：真实宿主里头像可能是背景图 / 伪元素，认不出 <img> 时就按结构取
     * “底部最后一行”。这样独立调高与图标坞锚定都不依赖头像元素能否被识别。
     */
    function guessAccountRow(panes) {
      if (!panes || !panes.foot) return null
      let node = panes.foot
      let last = null
      for (let depth = 0; depth < 4; depth += 1) {
        const kids = []
        for (const child of node.children) {
          if (ownNode(child)) continue
          const rect = child.getBoundingClientRect()
          if (rect.height > 1) kids.push(child)
        }
        if (!kids.length) break
        const candidate = kids[kids.length - 1]
        last = candidate
        // A short vertical wrapper can still hold status + account. Only
        // stop at an actual row/leaf, not at the first wrapper below 96px.
        if (candidate.getBoundingClientRect().height <= 96 && accountRowLike(candidate)) break
        node = candidate
      }
      return last
    }

    function accountRowLike(node) {
      const kids = Array.from(node.children).filter(child => !ownNode(child) && child.getBoundingClientRect().height > 1)
      if (!kids.length || node.matches('button, a, [role="button"]')) return true
      const cs = window.getComputedStyle(node)
      if ((cs.display === 'flex' || cs.display === 'inline-flex') && cs.flexDirection.startsWith('row')) return true
      if (kids.length < 2) return false
      // Non-flex avatar/name rows can use inline or grid layout. Their
      // children share a vertical band; stacked status/account rows do not.
      const rects = kids.map(child => child.getBoundingClientRect())
      return Math.max(...rects.map(rect => rect.top)) < Math.min(...rects.map(rect => rect.bottom))
    }

    function accountRow(panes) {
      if (!panes || !panes.foot) return null
      const root = panes.foot
      const avatar = avatarNode(root)
      if (!avatar) return guessAccountRow(panes)
      const avatarRect = avatar.getBoundingClientRect()
      if (!avatarRect || avatarRect.height < 8 || avatarRect.width < 8) return guessAccountRow(panes)
      let node = avatar
      while (node && node !== root) {
        const rect = node.getBoundingClientRect()
        // Find the actual horizontal avatar/name row, not whichever wrapper
        // happens to be a direct child of footArea in this host version.
        if (node !== avatar && rect.height >= avatarRect.height && rect.height <= 96
          && accountRowLike(node)) return node
        node = node.parentElement
      }
      return guessAccountRow(panes)
    }

    function avatarTop(root) {
      const rootRect = root.getBoundingClientRect()
      let best = null
      let nodes
      try {
        nodes = root.querySelectorAll('[class*="avatar" i], img[src]')
      } catch (error) {
        nodes = []
      }
      for (const el of Array.from(nodes)) {
        if (el.closest('[' + ATTR_DOCK + ']')) continue
        const rect = el.getBoundingClientRect()
        if (rect.width < 14 || rect.width > 140) continue
        if (rect.height < 14 || rect.height > 140) continue
        if (rect.top < rootRect.top + rootRect.height * 0.45) continue
        if (rect.bottom > rootRect.bottom + 4) continue
        if (!best || rect.top > best.top) best = rect
      }
      return best ? best.top : null
    }

    function positionDock(root, dock) {
      const rootRect = root.getBoundingClientRect()
      // 优先按“账号/头像那一行”的顶边锚定：图标坞永远在它上方，不会盖住它，
      // 也不依赖头像元素能否被识别（真实宿主里头像可能是背景图而非 <img>）。
      let anchor = null
      if (accountEl && root.contains(accountEl)) {
        const rect = accountEl.getBoundingClientRect()
        if (rect && rect.height >= 1) anchor = rect.top
      }
      if (anchor === null) anchor = avatarTop(root)
      const bottom = anchor === null ? 14 : Math.round(rootRect.bottom - anchor + 8)
      writeStyle(dock, 'bottom', Math.max(10, bottom) + 'px')
    }

    function chipLabel(id) {
      return BLOCK_LABEL[id] || id
    }

    function renderDock(panes, root, dock) {
      const hidden = BLOCK_ORDER.filter((id) => isHidden(id) && blockElements(panes, id).length > 0)
      const signature = hidden.join(',')
      dock.hidden = hidden.length === 0
      if (signature === dockSignature && dock.childElementCount === hidden.length) {
        positionDock(root, dock)
        return
      }
      dockSignature = signature
      dock.textContent = ''
      for (const id of hidden) {
        const chip = document.createElement('button')
        chip.type = 'button'
        chip.setAttribute(ATTR_CHIP, id)
        chip.setAttribute('aria-label', chipLabel(id) + '（已折叠，点击展开）')
        chip.innerHTML = CHIP_ICON[id] || CHIP_ICON.nav
        chip.addEventListener('click', (event) => {
          event.preventDefault()
          event.stopPropagation()
          toggleBlock(id)
        })
        chip.addEventListener('pointerenter', () => showTip(chip, id))
        chip.addEventListener('pointerleave', hideTip)
        chip.addEventListener('focus', () => showTip(chip, id))
        chip.addEventListener('blur', hideTip)
        dock.appendChild(chip)
      }
      positionDock(root, dock)
    }

    /* ---------------- 悬浮提示：区块名 + 还剩哪些条目 ---------------- */

    let tipEl = null

    function ensureTip() {
      if (tipEl && tipEl.isConnected) return tipEl
      tipEl = document.createElement('div')
      tipEl.setAttribute(ATTR_TIP, '')
      tipEl.style.display = 'none'
      ;(document.body || document.documentElement).appendChild(tipEl)
      return tipEl
    }

    function collectNames(panes, id) {
      const out = []
      const seen = new Set()
      const selector =
        'button,a,li,[role="button"],[role="link"],[role="tab"],[role="menuitem"],[aria-label],[title]'
      for (const rootEl of blockElements(panes, id)) {
        let nodes
        try { nodes = rootEl.querySelectorAll(selector) } catch (error) { nodes = [] }
        for (const el of Array.from(nodes)) {
          if (el.closest('[' + ATTR_DOCK + ']') || el.closest('[' + ATTR_GUTTER + ']')) continue
          const raw = el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || ''
          const text = raw.replace(/\s+/g, ' ').trim()
          if (!text || text.length > 48) continue
          if (seen.has(text)) continue
          seen.add(text)
          out.push(text)
          if (out.length >= 10) return out
        }
      }
      if (out.length === 0) {
        for (const rootEl of blockElements(panes, id)) {
          const text = (rootEl.textContent || '').replace(/\s+/g, ' ').trim()
          if (text) out.push(text.slice(0, 60))
        }
      }
      return out
    }

    function showTip(chip, id) {
      const tip = ensureTip()
      const names = collectNames(ui.panes, id)
      tip.textContent = ''
      const title = document.createElement('em')
      title.textContent = chipLabel(id) + ' · 已折叠'
      tip.appendChild(title)
      if (names.length === 0) {
        const line = document.createElement('span')
        line.textContent = '（没有可列出的条目）'
        tip.appendChild(line)
      } else {
        for (const name of names) {
          const line = document.createElement('span')
          line.textContent = name
          tip.appendChild(line)
        }
      }
      tip.style.display = 'block'
      const rect = chip.getBoundingClientRect()
      const box = tip.getBoundingClientRect()
      const view = { w: window.innerWidth || 1280, h: window.innerHeight || 800 }
      let left = rect.right + 8
      if (left + box.width > view.w - 8) left = Math.max(8, rect.left - box.width - 8)
      let top = rect.top + rect.height / 2 - box.height / 2
      top = Math.max(8, Math.min(top, view.h - box.height - 8))
      tip.style.left = Math.round(left) + 'px'
      tip.style.top = Math.round(top) + 'px'
    }

    function hideTip() {
      if (tipEl) tipEl.style.display = 'none'
    }

    /* ---------------- 诊断属性 ---------------- */

    function fault(message) {
      try {
        document.documentElement.setAttribute('data-dsh-sw-fault', String(message))
      } catch (error) { /* 无 DOM */ }
    }

    let booted = false
    let dumpScheduled = false

    /** 每次加载写一条启动记录：宿主跑的是哪个版本、什么时候启动，事后可直接查 localStorage。 */
    function markBoot() {
      if (booted) return
      booted = true
      try {
        window.localStorage.setItem(BOOT_KEY, JSON.stringify({ v: PLUGIN_VERSION, t: Date.now() }))
      } catch (error) { /* 隐私模式等不可写时忽略 */ }
      try {
        document.documentElement.setAttribute('data-dsh-sw-version', PLUGIN_VERSION)
      } catch (error) { /* 无 DOM */ }
    }

    /**
     * 启动后写一份现场快照到 localStorage（只写一次，约几 KB）。
     * 真实宿主里出问题时不需要用户开 DevTools：直接读这个键就能知道
     * 跑的是哪一版、各块的实际矩形、面板列表里到底有哪几行。
     */
    /**
     * 把底栏的真实几何打一行到控制台：宿主会把渲染进程 console 写进日志文件，
     * 这样即使 localStorage 被 leveldb 压缩掉，也能从磁盘读到现场。
     */
    function logFooter() {
      if (!ui.panes || !ui.root) return
      try {
        const box = (el) => {
          const r = el.getBoundingClientRect()
          return [Math.round(r.top), Math.round(r.height)]
        }
        const foot = paneElement(ui.panes, 'foot')
        const line = {
          v: PLUGIN_VERSION,
          root: box(ui.root),
          contentH: contentBoxHeight(ui.root),
          heights: state.heights,
          rows: state.rows,
          scopes: rowScopes(ui.panes).map((scope) => scope.id + ':' + scope.rows.length),
          seams: rowSeams().map((seam) => seam.key),
          foot: foot
            ? Array.from(foot.children)
                .filter((child) => !ownNode(child))
                .map((child) => {
                  const cs = window.getComputedStyle(child)
                  return {
                    cls: String(child.className || '').slice(0, 30),
                    txt: String(child.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 18),
                    box: box(child),
                    h: cs.height,
                    mt: cs.marginTop,
                    kids: child.children.length,
                  }
                })
            : [],
          acct: accountEl
            ? { box: box(accountEl), mt: window.getComputedStyle(accountEl).marginTop, h: window.getComputedStyle(accountEl).height }
            : null,
        }
        const text = JSON.stringify(line)
        // 主通道：localStorage（重启后可从 leveldb 读，量小不易被压缩吞掉）。
        try { window.localStorage.setItem(DUMP2_KEY, text) } catch (error) { /* 忽略 */ }
        if (!window.__DSH_SW_QUIET__) {
          console.log('[dsh-sidebar-sections] ' + text)
          try {
            if (typeof logger === 'object' && logger && typeof logger.info === 'function') logger.info(text)
          } catch (error) { /* 忽略 */ }
        }
      } catch (error) { /* 诊断失败不影响功能 */ }
    }

    function writeDump() {
      if (!ui.root || !ui.panes) return
      try {
        const rect = (el) => {
          if (!el) return null
          const r = el.getBoundingClientRect()
          return r ? { top: Math.round(r.top), left: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height) } : null
        }
        const describe = (el) => {
          const cs = window.getComputedStyle(el)
          return {
            tag: el.tagName.toLowerCase(),
            cls: String(el.className || '').slice(0, 60),
            text: String(el.textContent || '').trim().slice(0, 40),
            rect: rect(el),
            display: cs.display,
            height: cs.height,
            flexBasis: cs.flexBasis,
            zoom: el.style.getPropertyValue('zoom') || ''
          }
        }
        const panes = paneKeys(ui.panes).map((id) => {
          const el = paneElement(ui.panes, id)
          return { id, hidden: paneHidden(id), ...describe(el) }
        })
        const nav = paneElement(ui.panes, 'nav')
        const foot = paneElement(ui.panes, 'foot')
        const dump = {
          v: PLUGIN_VERSION,
          t: Date.now(),
          url: String(window.location.href),
          root: rect(ui.root),
          contentH: contentBoxHeight(ui.root),
          state,
          status: document.documentElement.getAttribute('data-dsh-sw-state'),
          fault: document.documentElement.getAttribute('data-dsh-sw-fault'),
          rail: isRail(),
          panes,
          navChildren: nav ? Array.from(nav.children).slice(0, 12).map(describe) : [],
          navHTML: nav ? String(nav.innerHTML || '').slice(0, 2600) : '',
          account: accountEl ? describe(accountEl) : null,
          accountPinHost: (() => {
            const footEl = ui.panes ? paneElement(ui.panes, 'foot') : null
            if (!footEl) return null
            const first = Array.from(footEl.children).filter((child) => !ownNode(child))[0] || null
            if (!first) return null
            const cs = window.getComputedStyle(first)
            return { cls: String(first.className || '').slice(0, 60), marginTop: cs.marginTop, flexGrow: cs.flexGrow, flexShrink: cs.flexShrink }
          })(),
          rootChildren: Array.from(ui.root.children).filter((el) => !ownNode(el)).slice(0, 14).map(describe),
          footChildren: foot ? Array.from(foot.children).slice(0, 8).map(describe) : []
        }
        dump.scopes = rowScopes(ui.panes).map((scope) => ({
          id: scope.id,
          rows: scope.rows.map((r) => {
            const cs = window.getComputedStyle(r)
            return { text: String(r.textContent || '').trim().slice(0, 24), rect: rect(r), h: cs.height, mt: cs.marginTop }
          })
        }))
        dump.sashCount = (ui.sashes ? Object.keys(ui.sashes).length : 0)
        window.localStorage.setItem(DUMP_KEY, JSON.stringify(dump))
        const footEl2 = paneElement(ui.panes, 'foot')
        const footDump = {
          v: PLUGIN_VERSION,
          t: Date.now(),
          foot: footEl2 ? rect(footEl2) : null,
          footSaved: savedHeight('foot'),
          rows: state.rows,
          heights: state.heights,
          scopes: dump.scopes.filter((scope) => scope.id.indexOf('foot') === 0 || scope.id === 'acct'),
          account: dump.account,
          pin: (() => {
            const first = footEl2 ? Array.from(footEl2.children).filter((child) => !ownNode(child)) : []
            return first.map((el) => {
              const cs = window.getComputedStyle(el)
              return { cls: String(el.className || '').slice(0, 40), h: cs.height, mt: cs.marginTop, kids: el.children.length }
            })
          })()
        }
        window.localStorage.setItem(DUMP2_KEY, JSON.stringify(footDump))
        document.documentElement.setAttribute('data-dsh-sw-dump', PLUGIN_VERSION)
      } catch (error) { /* 诊断失败不影响功能 */ }
    }

    function status(text) {
      try {
        document.documentElement.setAttribute('data-dsh-sw-state', text)
      } catch (error) { /* 无 DOM */ }
    }

    /* ---------------- 主循环 ---------------- */

    let scheduled = false
    let listening = false
    // 渲染签名：同样的输入绝不重写一遍 DOM。宿主的 MutationObserver/ResizeObserver
    // 会在我们写完之后再回调一次，没有这个闸门就会变成“写 → 观察 → 再写”的死循环。
    let lastSig = ''
    let lastStatus = ''
    let dumpTimer = 0
    let dumpedOnce = false
    // 我们自己写 DOM 时置真：MutationObserver/ResizeObserver 的读回调据此跳过，
    // 否则“写样式 → 观察器 → 再写”会自激成整条侧栏闪烁。
    let writing = false

    function schedule() {
      if (scheduled) return
      scheduled = true
      const run = () => {
        scheduled = false
        apply()
      }
      if (typeof window.requestAnimationFrame === 'function') {
        const handle = window.requestAnimationFrame(run)
        // rAF 在后台/无头窗口里可能被饿死，落一个兜底定时器保证状态一定会落地。
        window.setTimeout(() => {
          if (!scheduled) return
          scheduled = false
          try { window.cancelAnimationFrame(handle) } catch (error) { /* 忽略 */ }
          apply()
        }, 120)
      } else window.setTimeout(run, 16)
    }

    function apply() {
      markBoot()
      if (!listening) return
      writing = true
      try {
        const root = findRoot()
        if (!root) { ui.root = null; status('no-root'); return }
        ui.root = root
        const dock = ensureDock(root)

        if (isRail(root)) {
          restoreLayout()
          for (const sash of Object.values(ui.sashes)) if (sash.parentNode) sash.parentNode.removeChild(sash)
          ui.sashes = {}
          writeStyle(dock, 'display', 'none')
          status('rail')
          // 退出窄轨时布局要整块重画，别被渲染签名挡住。
          lastSig = ''
          lastStatus = 'rail'
          return
        }
        ensureGutter(root)

        const panes = readPanes(root)
        if (!panes) { status('no-blocks'); return }
        ui.panes = panes

        let shape = 0
        for (const id of paneKeys(panes)) {
          const el = paneElement(panes, id)
          // 用整棵子树节点数：容器里增删一行也要触发重画，否则新行拿不到缝。
          shape = shape * 131 + (el ? el.querySelectorAll('*').length + 1 : 0)
        }
        const sig = [
          paneKeys(panes).join(','),
          shape,
          Math.round(root.clientHeight || 0),
          Math.round(root.clientWidth || 0),
          JSON.stringify(state.heights),
          JSON.stringify(state.rows),
          JSON.stringify(state.hidden),
          accountEl ? 1 : 0,
        ].join('|')
        if (sig === lastSig) { if (lastStatus) status(lastStatus); return }
        lastSig = sig

        restoreLayout()
        // The overlay must be positioned against the sidebar, not the first
        // positioned ancestor (which can be the whole conversation window).
        if (window.getComputedStyle(root).position === 'static') layoutStyle(root, 'position', 'relative')
        markBlocks(panes)
        accountEl = accountRow(panes)
        applyCollapse(panes)
        layoutSidebar(panes, root)
        const fixedKeys = paneKeys(panes).filter((key) => key !== 'main')
        const fitted = root.querySelectorAll('[' + ATTR_ZOOM + ']').length
        renderSashes(root, panes)
        sweepRowNodes()

        // 只要有任何一块/一行被调过尺寸，就把侧栏裁到自己的盒子里：
        // 内容再长也只能在内部滚动，绝不会画到上面那一层上。
        const active = Object.keys(state.heights).length > 0 || Object.keys(rowOverrides()).length > 0
        if (active) {
          layoutStyle(root, 'overflow', 'clip')
          layoutStyle(root, 'overflow-x', 'hidden')
          // 内容真的装不下时（行被拖高、外面又没空间让主子区让出来），
          // 给侧栏加纵向滚动条——用户明确要求“遮挡时能滚轮上下滑动看到”，
          // 而不是让底部头像永远待在被裁掉的位置。
          const overflows = Math.round(root.scrollHeight || 0) - Math.round(root.getBoundingClientRect().height || 0) > 1
          layoutStyle(root, 'overflow-y', overflows ? 'auto' : 'hidden')
        }

        renderDock(panes, root, dock)
        applyCollapseButtons(panes, root)

        const h = []
        for (const id of fixedKeys) if (savedHeight(id) !== null) h.push(id + '=' + savedHeight(id))
        lastStatus = 'panes:' + h.join(' ') + ' rows:' + Object.keys(rowOverrides()).length + ' fit:' + fitted + ' trim:0 hidden:' + state.hidden.length
        status(lastStatus)

        // 诊断快照：首轮立刻落一次，2.5 秒后再落一次（布局稳定后的最终形态）。
        logFooter()
        if (!dumpedOnce) { dumpedOnce = true; writeDump() }
        if (!dumpTimer) dumpTimer = window.setTimeout(() => { dumpTimer = 0; writeDump() }, 2500)
      } catch (error) {
        fault(error && error.message ? error.message : String(error))
      } finally {
        // 我们这一轮写出来的 MutationRecord 先抽干，再解锁；
        // 用微任务解锁会在同步环境（测试、某些宿主事件）里把观察器一直卡住。
        try { if (rootObserver) rootObserver.takeRecords() } catch (error) { /* 忽略 */ }
        writing = false
      }
    }

    let rootObserver = null
    let resizeObserver = null
    let ensureTimer = 0
    let observedRoot = null

    function onResize() { if (!writing) schedule() }

    /** 滚动会让缝的坐标失效，顺手把提示线收起来。 */
    function onScroll() { hideRowHint(); if (!writing) schedule() }

    function start() {
      if (listening) return
      listening = true
      injectCss()
      schedule()

      try {
        rootObserver = new MutationObserver((records) => {
          if (writing) return
          // External style/text/structure changes can alter natural sizes even
          // when the node count is unchanged. Our own records are drained in apply.
          if (records.length) lastSig = ''
          schedule()
        })
      } catch (error) { rootObserver = null }

      try {
        resizeObserver = new ResizeObserver(() => { if (!writing) schedule() })
      } catch (error) { resizeObserver = null }

      hookRootObserver()

      window.addEventListener('resize', onResize, { passive: true })
      window.addEventListener('scroll', onScroll, true)
      window.addEventListener('pointerdown', rowDownGuarded, true)
      window.addEventListener('pointermove', hoverMoveGuarded, true)
      window.addEventListener('pointerleave', hideRowHintGuarded, true)
      window.addEventListener('blur', hideRowHintGuarded, true)
      window.addEventListener('dblclick', rowDblClickGuarded, true)
      window.addEventListener('click', clickGuarded, true)

      // root 晚于 apply 出现、或被 React 重挂时补挂观察器；稳定 6 秒后自动收手。
      let ticks = 0
      ensureTimer = window.setInterval(() => {
        ticks += 1
        const root = findRoot()
        if (root && root !== observedRoot) {
          hookRootObserver()
          schedule()
        }
        if (ticks === 1 || ticks % 4 === 0) schedule()
        if ((observedRoot && ticks > 12) || ticks > 240) {
          window.clearInterval(ensureTimer)
          ensureTimer = 0
        }
      }, 500)
    }

    /** root 会被 React 重挂（切换工作区/折叠），观察器要跟着搬。 */
    function hookRootObserver() {
      const root = findRoot()
      if (!root) return
      if (root === observedRoot && rootObserver) return
      if (rootObserver) {
        try {
          rootObserver.disconnect()
          rootObserver.observe(root, {
            childList: true,
            characterData: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class', 'style'],
          })
        } catch (error) { /* no-op */ }
      }
      if (resizeObserver) {
        try {
          resizeObserver.disconnect()
          resizeObserver.observe(root)
        } catch (error) { /* no-op */ }
      }
      observedRoot = root
    }

    function stop() {
      listening = false
      restoreLayout()
      hideTip()
      if (ensureTimer) { window.clearInterval(ensureTimer); ensureTimer = 0 }
      if (rootObserver) { try { rootObserver.disconnect() } catch (error) { /* no-op */ } }
      if (resizeObserver) { try { resizeObserver.disconnect() } catch (error) { /* no-op */ } }
      rootObserver = null
      resizeObserver = null
      observedRoot = null
      window.removeEventListener('resize', onResize)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('pointermove', onDragMove, true)
      window.removeEventListener('pointerup', onDragEnd, true)
      window.removeEventListener('pointercancel', onDragEnd, true)
      drag = null
      for (const key of Object.keys(ui.sashes)) {
        const sash = ui.sashes[key]
        if (sash && sash.parentNode) sash.parentNode.removeChild(sash)
      }
      ui.sashes = {}
      if (ui.rowHint && ui.rowHint.parentNode) ui.rowHint.parentNode.removeChild(ui.rowHint)
      ui.rowHint = null
      ui.rowSeam = null
      suppressClickUntil = 0
      window.removeEventListener('pointerdown', rowDownGuarded, true)
      window.removeEventListener('pointermove', hoverMoveGuarded, true)
      window.removeEventListener('pointerleave', hideRowHintGuarded, true)
      window.removeEventListener('blur', hideRowHintGuarded, true)
      window.removeEventListener('dblclick', rowDblClickGuarded, true)
      window.removeEventListener('click', clickGuarded, true)
      if (tipEl && tipEl.parentNode) tipEl.parentNode.removeChild(tipEl)
      tipEl = null
      ui.dock = null
      ui.gutter = null
      ui.root = null
      ui.panes = null
      dockSignature = ''
    }

    /* ---------------- 设置页 ---------------- */

    const rowStyle = { display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }
    const labelStyle = { width: '104px', flex: '0 0 auto', fontSize: '13px', color: 'var(--dsw-alias-label-secondary)' }
    const buttonStyle = {
      fontSize: '13px',
      color: 'var(--dsw-alias-label-primary)',
      background: 'var(--dsw-alias-interactive-bg-hover)',
      border: '0.5px solid var(--dsw-alias-border-l3)',
      borderRadius: 'var(--dsw-radius-md)',
      padding: '6px 12px',
      cursor: 'pointer',
    }
    const activeButtonStyle = {
      ...buttonStyle,
      borderColor: 'var(--dsw-alias-brand-primary)',
      color: 'var(--dsw-alias-brand-primary)',
      fontWeight: 600,
    }
    const hintStyle = { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' }
    const codeStyle = {
      fontFamily: 'var(--dsw-font-family-mono, monospace)',
      fontSize: '12px',
      padding: '1px 5px',
      borderRadius: '4px',
      background: 'var(--dsw-alias-interactive-bg-hover)',
    }

    function SidebarSectionsPage() {
      React.useSyncExternalStore(subscribe, getVersion, getVersion)
      const set = Object.keys(state.heights)
      const list = set.map((id) => (PANE_LABEL[id] || id) + ' ' + state.heights[id] + 'px').join('，')
      const rowKeys = Object.keys(rowOverrides())
      const rowList = rowKeys.map((key) => rowLabel(key) + ' ' + rowOverrides()[key] + 'px').join('，')

      const row = (key, label, control) =>
        React.createElement('div', { key, style: rowStyle }, React.createElement('div', { style: labelStyle }, label), control)

      return React.createElement(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: '16px', padding: '4px 0 8px' } },
        React.createElement(
          'div',
          { style: { fontSize: '13px', lineHeight: '1.75', color: 'var(--dsw-alias-label-secondary)' } },
          '侧栏分成 5 块（品牌行 / 新会话 / 全局面板 / 工作区与会话 / 底部账号区），块与块之间有一条',
          React.createElement('b', null, ' 4px 的拖动带'),
          '：鼠标移上去会出现一个居中的小握把，按住上下拖就是改这一块的高度；',
          React.createElement('b', null, '双击'),
          '复位。压得比内容还矮时，里面的字号和图标会自动等比缩小（最紧 42%）。',
          React.createElement('b', null, '工作区/会话'),
          '始终吃掉剩余空间，底部账号区永远贴在最下面。每段左侧的小箭头把整段折叠成头像上方的图标。',
          React.createElement('b', null, '更细的一层'),
          '：面板列表里的每一行、底部的每一块与每一行之间也有同样的拖动带，可以单独调高；',
          React.createElement('b', null, '文件夹里的子对话不做调整'),
          '（那是会自动增删的列表）。',
        ),
        row(
          'heights',
          '已调高度',
          React.createElement('span', { style: hintStyle }, set.length === 0 ? '无（全部为原生高度）' : list),
        ),
        row(
          'rows',
          '已调行高',
          React.createElement(
            'span',
            { style: hintStyle },
            rowKeys.length === 0 ? '无（每个条目都是原生高度）' : rowList,
          ),
        ),
        row(
          'hidden',
          '已折叠',
          React.createElement(
            'span',
            { style: hintStyle },
            state.hidden.length === 0
              ? '无'
              : state.hidden.map((id) => BLOCK_LABEL[id] || id).join('、'),
          ),
        ),
        row(
          'mode',
          '重启后',
          React.createElement(
            'div',
            { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
            React.createElement(
              'button',
              {
                style: state.mode === 'reset' ? buttonStyle : activeButtonStyle,
                onClick: () => commit({ mode: 'keep' }),
              },
              '继承上次布局（默认）',
            ),
            React.createElement(
              'button',
              {
                style: state.mode === 'keep' ? buttonStyle : activeButtonStyle,
                onClick: () => commit({ mode: 'reset' }),
              },
              '每次启动回到默认',
            ),
          ),
        ),
        row(
          'actions',
          '复位',
          React.createElement(
            'div',
            { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
            React.createElement(
              'button',
              { style: buttonStyle, onClick: () => commit({ heights: {} }) },
              '恢复块的原始高度',
            ),
            React.createElement(
              'button',
              { style: buttonStyle, onClick: () => commit({ rows: {} }) },
              '恢复每一行的原始高度',
            ),
            React.createElement(
              'button',
              { style: buttonStyle, onClick: () => commit({ hidden: [] }) },
              '展开全部区块',
            ),
            React.createElement(
              'button',
              { style: buttonStyle, onClick: () => commit({ heights: {}, rows: {}, hidden: [] }) },
              '全部复位',
            ),
          ),
        ),
        React.createElement(
          'div',
          { style: { fontSize: '12px', lineHeight: '1.7', color: 'var(--dsw-alias-label-secondary)' } },
          '高度与折叠状态存在 ',
          React.createElement('code', { style: codeStyle }, 'localStorage'),
          ' 的 ',
          React.createElement('code', { style: codeStyle }, STORE_KEY),
          ' 里；侧栏被原生折叠成 ',
          React.createElement('code', { style: codeStyle }, '56px'),
          ' 窄轨时本插件让位。',
        ),
      )
    }

    let disposed = false
    let registered = false
    let disposeSection = null

    function getSlots(ctx) {
      try {
        const direct = ctx.slots
        if (direct && typeof direct.inject === 'function') return direct
      } catch (error) { /* 服务尚未安装 */ }
      try {
        const viaGet = ctx.get('slots')
        if (viaGet && typeof viaGet.inject === 'function') return viaGet
      } catch (error) { /* 服务尚未安装 */ }
      return undefined
    }

    function registerSection(ctx, attempt) {
      if (disposed || registered) return
      const slots = getSlots(ctx)
      if (!slots) {
        if (attempt < 120) window.setTimeout(() => registerSection(ctx, attempt + 1), 250)
        return
      }
      try {
        disposeSection = slots.inject('settings.section', () =>
          slots.register(
            { name: 'settings.section', id: 'sidebar-sections', order: 37, label: '侧边栏分区' },
            SidebarSectionsPage,
          ),
        )
        registered = true
        try { document.documentElement.setAttribute('data-dsh-sidebar-sections-page', 'registered') } catch (error) { /* no DOM */ }
      } catch (error) {
        try {
          document.documentElement.setAttribute(
            'data-dsh-sidebar-sections-error',
            String(error && error.message),
          )
        } catch (e) { /* no DOM */ }
      }
    }

    return {
      inject: [],
      apply(ctx) {
        if (disposed) return
        start()
        if (typeof ctx.effect === 'function') {
          ctx.effect(() => () => {
            disposed = true
            stop()
            try { if (typeof disposeSection === 'function') disposeSection() } catch (error) { /* already gone */ }
            disposeSection = null
            registered = false
          }, 'sidebar-sections: cleanup')
        }
        registerSection(ctx, 0)
      },
    }
  },
})
