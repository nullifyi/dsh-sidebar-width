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
    const PLUGIN_VERSION = '0.6.17'
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
    const ATTR_ROW_LABEL = 'data-dsh-sw-rowlabel'
    const ATTR_SEAM = 'data-dsh-sw-seam'
    const ATTR_DRAGGING = 'data-dsh-sw-dragging'
    const ATTR_ROWSPACE = 'data-dsh-sw-rowspace'
    const ATTR_FONT = 'data-dsh-sw-font'
    const ATTR_ICONROW = 'data-dsh-sw-iconrow'
    const DUMP2_KEY = 'dsh-sidebar-sections:footdump'
    const ICON_ROW_H = 26

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
[${ATTR_ROW_HINT}]>span{position:absolute;left:20px;top:-6px;font-size:10px;line-height:14px;padding:1px 6px;
  border-radius:4px;color:#fff;background:var(--dsw-alias-brand-primary,#4d6bfe);white-space:nowrap}
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
            if (!/^[a-z]+[0-9]*:[0-9]+$/.test(key)) continue
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

    /**
     * 只有“被拖过的高度”才参与预算归一（VS Code SplitView.distributeEmptySpace 的做法：
     * 空间不够时按优先级把差值摊到可伸缩的项上，并夹在 minimumSize 以内）。
     * 没被拖过的块一律保持原生高度 —— 以前把没动过的块也压小，结果面板行被压到看不见。
     */
    function sanitizeHeights(panes, contentH) {
      if (!contentH) return false
      const keys = paneKeys(panes).filter((key) => key !== 'main')
      const dyn = {}
      let fixedSum = 0
      for (const id of keys) {
        const el = paneElement(panes, id)
        const saved = savedHeight(id)
        if (saved === null) {
          const rect = el ? el.getBoundingClientRect() : null
          fixedSum += Math.max(1, Math.round((rect && rect.height) || 0))
        } else {
          dyn[id] = saved
        }
      }
      if (!Object.keys(dyn).length) return false
      const budget = Math.max(0, contentH - MIN_MAIN - fixedSum)
      let sum = 0
      for (const id of Object.keys(dyn)) sum += dyn[id]
      let guard = 0
      while (sum > budget && guard < 64) {
        guard += 1
        let pick = null
        for (const id of Object.keys(dyn)) {
          if (dyn[id] > (MIN_PANE[id] || 18) && (!pick || dyn[id] > dyn[pick])) pick = id
        }
        if (!pick) break
        const over = sum - budget
        const room = dyn[pick] - paneMin(pick, dyn[pick])
        const take = Math.min(room, Math.max(1, Math.ceil(over / 2)))
        dyn[pick] -= take
        sum -= take
      }
      let changed = false
      for (const id of Object.keys(dyn)) {
        if (state.heights[id] !== dyn[id]) {
          state.heights[id] = dyn[id]
          changed = true
        }
      }
      return changed
    }

    /**
     * 用真实排版结果兜底（对应 VS Code SplitView.distributeEmptySpace：
     * 按实际差量把空出来的空间摊回去，直到不溢出为止）。
     * 只压“用户自己拖过的高度”，没动过的块一律保持原生高度。
     */
    function enforceBudget(panes, root) {
      let changed = false
      for (let round = 0; round < 6; round += 1) {
        const contentH = contentBoxHeight(root)
        if (!contentH) break
        let used = 0
        let prevBottom = null
        const dyn = []
        for (const id of paneKeys(panes)) {
          const el = paneElement(panes, id)
          if (!el) continue
          const rect = el.getBoundingClientRect()
          if (!rect) continue
          // 块与块之间还有外边距，只加高度会漏算；main 也要算进总高度（它本身就是 flex 伸缩项）。
          if (prevBottom !== null) used += Math.max(0, rect.top - prevBottom)
          used += Math.round(rect.height || 0)
          prevBottom = rect.bottom
          if (id === 'main') continue
          const cur = savedHeight(id)
          if (cur !== null && cur - paneMin(id, cur) > 0) dyn.push(id)
        }
        const over = used - contentH
        if (over <= 0 || !dyn.length) break
        // 回收顺序：面板区 → 新会话 → 品牌行 → 底栏。
        // 底栏放最后，因为头像和用量卡一旦被裁就“看不见了”；
        // 面板区可以滚动，压小它只是少露几行。
        const priority = ['nav', 'new', 'brand', 'foot']
        const rank = (id) => {
          const at = priority.indexOf(id)
          return at < 0 ? priority.length : at
        }
        let picked = null
        for (const id of dyn) {
          if (!picked) { picked = id; continue }
          const byRank = rank(id) - rank(picked)
          if (byRank < 0 || (byRank === 0 && savedHeight(id) > savedHeight(picked))) picked = id
        }
        if (!picked) break
        const cur = savedHeight(picked)
        const floor = paneMin(picked, cur)
        state.heights[picked] = cur - Math.min(cur - floor, Math.max(1, Math.ceil(over)))
        changed = true
        applyPaneSizing(panes, root)
      }
      return changed
    }

    function applyPaneSizing(panes, root) {
      const contentH = contentBoxHeight(root)
      const heights = {}
      const fixed = paneKeys(panes).filter((key) => key !== 'main')
      for (const id of fixed) {
        const el = paneElement(panes, id)
        if (!el) continue
        const saved = savedHeight(id)
        const rect = el.getBoundingClientRect()
        const min = MIN_PANE[id] || 18
        const measured = Math.max(min, Math.round(rect.height || 0))
        const floor = paneFloor[id] || 0
        heights[id] = saved === null ? measured : Math.max(min, saved, floor)
      }

      // 注意：这里的压缩**只用于本次渲染**，绝不写回存储。
      // 曾经把压缩结果 persist 回去，结果 persist → 订阅 → apply → 再压缩，
      // 布局在“撑开—压缩”之间来回跳（用户看到的就是整条侧栏闪烁、块忽大忽小）。

      // 底栏不允许比自己的内容还矮：行数不变时被拖小只是裁掉，
      // 但只要放得下，就应该撑到内容高度，否则头像行会被裁到盒子外面（“往下拖就看不见”）。
      const othersFixed = fixed.reduce((sum, key) => (key === 'foot' ? sum : sum + (heights[key] || 0)), 0)
      const footEl = paneElement(panes, 'foot')
      if (footEl && savedHeight('foot') !== null) {
        const need = Math.max(0, Math.round(footEl.scrollHeight || 0))
        if (need > heights.foot) {
          const capAll = Math.max(heights.foot, contentH - MIN_MAIN - othersFixed)
          heights.foot = Math.min(need, capAll)
        }
      }

      for (const id of fixed) {
        const el = paneElement(panes, id)
        if (!el) continue
        const h = heights[id]
        if (savedHeight(id) === null) {
          // 没被调整过：完全交还原生布局，但仍要能被自身内容撑开。
          dropStyle(el, 'flex')
          dropStyle(el, 'flex-grow')
          dropStyle(el, 'flex-shrink')
          dropStyle(el, 'flex-basis')
          dropStyle(el, 'height')
          dropStyle(el, 'overflow')
          dropStyle(el, 'overflow-y')
          el.removeAttribute(ATTR_PANE)
        } else {
          const need = Math.max(0, Math.round(el.scrollHeight || 0))
          writeStyle(el, 'flex-grow', '0', 'important')
          writeStyle(el, 'flex-shrink', '0', 'important')
          writeStyle(el, 'flex-basis', h + 'px', 'important')
          writeStyle(el, 'height', h + 'px', 'important')
          writeStyle(el, 'overflow', 'hidden', 'important')
          // 内容比盒子高时（例如面板区被拖得装不下 3 行），让它自己滚动，
          // 而不是让第三行画到下面的工作区上。
          writeStyle(el, 'overflow-y', need > h && (id === 'nav' || id === 'foot') ? 'auto' : 'hidden', 'important')
          el.setAttribute(ATTR_PANE, id)
        }
      }

      if (panes.main) {
        writeStyle(panes.main, 'flex-grow', '1', 'important')
        writeStyle(panes.main, 'flex-shrink', '1', 'important')
        writeStyle(panes.main, 'flex-basis', '0px', 'important')
        writeStyle(panes.main, 'min-height', MIN_MAIN + 'px', 'important')
        writeStyle(panes.main, 'overflow', 'hidden', 'important')
        panes.main.setAttribute(ATTR_PANE, 'main')
      }
      if (panes.foot) {
        // 贴底：main 吸收余量；main 被折叠掉时由 auto 外边距把 footer 顶到最底部，
        // 头像因此永远在视口内（不再随上方面板折叠而上移）。
        writeStyle(panes.foot, 'margin-top', 'auto', 'important')
      }

      return { contentH, heights }
    }

    /* ---------------- 自适应缩放（压紧时字号一起缩） ---------------- */

    /** 被钉住、不参与缩放的节点（目前是账号/头像那一行）。 */
    let accountEl = null

    function fitChildren(pane) {
      const out = []
      if (!pane) return out
      for (const child of pane.children) {
        if (ownNode(child)) continue
        if (child === accountEl) continue
        out.push(child)
      }
      return out
    }

    function setChildZoom(el, scale) {
      const z = Math.round(scale * 1000) / 1000
      if (z >= 0.995) {
        dropStyle(el, 'zoom')
        dropStyle(el, 'width')
        if (el.getAttribute(ATTR_ZOOM) !== null) el.removeAttribute(ATTR_ZOOM)
        return
      }
      writeStyle(el, 'zoom', String(z), 'important')
      // zoom 会把宽度一起缩掉，这里反向补偿，横向仍占满。
      writeStyle(el, 'width', (100 / z).toFixed(4) + '%', 'important')
      if (el.getAttribute(ATTR_ZOOM) !== String(z)) el.setAttribute(ATTR_ZOOM, String(z))
    }

    function clearChildZoom(el) {
      dropStyle(el, 'zoom')
      dropStyle(el, 'width')
      if (el.getAttribute(ATTR_ZOOM) !== null) el.removeAttribute(ATTR_ZOOM)
    }

    const naturalCache = new WeakMap()

    /** 我们已经给这些子元素写上的 zoom（0 表示没有）。只读，不改 DOM。 */
    function currentZoomOf(kids) {
      for (const kid of kids) {
        const raw = kid.getAttribute(ATTR_ZOOM)
        if (raw !== null) {
          const value = Number(raw)
          if (value > 0) return value
        }
      }
      return 1
    }

    /**
     * 内容自然高度（未缩放时的 pane 高度）。**只读**：不再为了量尺寸去清 zoom、
     * 去改 style——那种“量一次写一次”会在宿主的 MutationObserver 上形成
     * 写 → 观察 → 再写 的自激循环，表现就是整条侧栏不停闪烁。
     * 当前渲染高度已知，除以当前 zoom 就是自然高度。
     */
    function naturalHeight(pane, kidsIn) {
      const kids = kidsIn || fitChildren(pane)
      if (!pane || kids.length === 0) return 0
      const cached = naturalCache.get(pane)
      if (cached && cached.count === kids.length) return cached.h
      const zoom = currentZoomOf(kids) || 1
      let rendered = 0
      try { rendered = pane.scrollHeight || 0 } catch (error) { rendered = 0 }
      if (!rendered) rendered = pane.getBoundingClientRect().height || 0
      const value = Math.max(0, Math.round(rendered / zoom))
      naturalCache.set(pane, { count: kids.length, h: value })
      return value
    }

    /**
     * 清掉我们自己写的高度约束与子元素 zoom 之后，这个 pane 自己会有多高。
     * 只用于取拖拽起点，不在每帧调用。
     */
    function unconstrainedHeight(pane) {
      if (!pane) return 0
      const constraints = ['height', 'overflow', 'flex-basis']
      const savedConstraints = []
      for (const name of constraints) {
        savedConstraints.push([name, pane.style.getPropertyValue(name), pane.style.getPropertyPriority(name)])
        pane.style.removeProperty(name)
      }
      const kids = fitChildren(pane)
      const savedZooms = kids.map((kid) => kid.getAttribute(ATTR_ZOOM))
      for (const kid of kids) clearChildZoom(kid)
      let h = 0
      try { h = pane.scrollHeight || 0 } catch (error) { h = 0 }
      if (!h) {
        const top = pane.getBoundingClientRect().top
        for (const kid of kids) {
          const rect = kid.getBoundingClientRect()
          h = Math.max(h, rect.height + rect.top - top)
        }
        if (!h) h = pane.getBoundingClientRect().height || 0
      }
      for (let i = 0; i < kids.length; i += 1) {
        const raw = savedZooms[i]
        if (raw !== null) setChildZoom(kids[i], Number(raw) || 1)
      }
      for (const [name, value, priority] of savedConstraints) {
        if (value) pane.style.setProperty(name, value, priority)
      }
      return Math.max(0, Math.round(h))
    }

    /**
     * 把 pane 的子元素缩到能塞进 h 里：
     *   h ≥ 自然高度 → zoom 1（多出来的空间留白）
     *   h < 自然高度 → zoom = h / 自然高度，最低 MIN_FIT
     */
    /**
     * 没有子元素、只有文字的块（新会话按钮、单行按钮）没法靠 zoom 子元素缩，
     * 就直接把字号按同一比例缩小——这就是“紧凑时字号自动变小”。
     */
    const fontCache = new WeakMap()

    function fontBaseOf(el, naturalIn) {
      const cached = fontCache.get(el)
      if (cached) return cached
      let size = 14
      try {
        const view = el.ownerDocument && el.ownerDocument.defaultView
        const cs = view && view.getComputedStyle(el)
        if (cs && cs.fontSize && cs.fontSize !== 'inherit') size = parseFloat(cs.fontSize) || 14
      } catch (error) { size = 14 }
      const natural = naturalIn || unconstrainedHeight(el) || Math.round(el.getBoundingClientRect().height || 0) || 1
      const base = { size, natural }
      fontCache.set(el, base)
      return base
    }

    /**
     * 行级压缩：只缩字号，绝不 zoom 整行、也不 zoom 行内各子元素。
     * 以前逐个子元素 zoom + 宽度反补偿，一压紧图标和文字各缩各的，内容整体往旁边跑，
     * 最后只剩一个图标。
     */
    function fitRow(row, h, naturalIn) {
      for (const kid of Array.from(row.children)) {
        if (kid.getAttribute(ATTR_ZOOM) !== null || kid.style.getPropertyValue('zoom')) clearChildZoom(kid)
        dropStyle(kid, 'width')
      }
      writeStyle(row, 'white-space', 'nowrap', 'important')
      writeStyle(row, 'text-overflow', 'ellipsis', 'important')
      return fitFont(row, h, naturalIn)
    }

    function fitFont(el, h, naturalIn) {
      const base = fontBaseOf(el, naturalIn)
      if (!h || !base.natural) return 1
      const ratio = h / base.natural
      if (ratio >= 0.995) {
        dropStyle(el, 'font-size')
        dropStyle(el, 'line-height')
        if (el.getAttribute(ATTR_FONT) !== null) el.removeAttribute(ATTR_FONT)
        return 1
      }
      const z = Math.max(MIN_FIT, Math.round(ratio * 1000) / 1000)
      writeStyle(el, 'font-size', (base.size * z).toFixed(2) + 'px', 'important')
      writeStyle(el, 'line-height', '1.25', 'important')
      el.setAttribute(ATTR_FONT, String(z))
      return z
    }

    /**
     * 按“内容是否真的放不下”决定要不要缩放；放得下就一律 zoom:1。
     * 以前用「高度 ÷ 自然高度」，而自然高度是在已经有缩放/已写死高度之后测的，
     * 重载后会把上一次的缩放进基准里，结果越叠越小。
     */
    function fitPane(pane, hIn) {
      const kids = fitChildren(pane)
      if (!kids.length) return 1
      for (const kid of kids) setChildZoom(kid, 1)
      const rect = pane.getBoundingClientRect()
      // 优先用这一轮即将写入的高度：rect 可能还没随新样式重排（拖动时尤其明显）。
      const h = Math.round(hIn || (rect && rect.height) || 0)
      if (!h) return 1
      const natural = pane.scrollHeight || 0
      if (!natural || natural <= h + 1) return 1
      const z = Math.max(MIN_FIT, Math.round((h / natural) * 1000) / 1000)
      const zoomable = (kid) => kid.getAttribute(ATTR_ROW) === null
      for (const kid of kids) setChildZoom(kid, zoomable(kid) ? z : 1)
      return z
    }

    function applyFit(pane, h, naturalIn) {
      if (!pane) return 1
      const kids = fitChildren(pane)
      if (kids.length === 0) return fitFont(pane, h, naturalIn)
      if (!h) return 1
      const natural = naturalIn || naturalHeight(pane, kids)
      if (!natural) return 1
      // 行高自己已经被用户调过的行不再吃 pane 级 zoom：它的 height 已经是最终值，
      // 再乘一次 zoom 会变成“双重缩小”，滑块一动就忽大忽小。
      const zoomable = (kid) => kid.getAttribute(ATTR_ROW) === null
      const ratio = h / natural
      if (ratio >= 0.995) {
        for (const kid of kids) setChildZoom(kid, 1)
        return 1
      }
      const z = Math.max(MIN_FIT, Math.round(ratio * 1000) / 1000)
      for (const kid of kids) setChildZoom(kid, zoomable(kid) ? z : 1)
      return z
    }

    function clearFit(pane) {
      if (!pane) return
      for (const kid of fitChildren(pane)) setChildZoom(kid, 1)
      dropStyle(pane, 'font-size')
      dropStyle(pane, 'line-height')
      if (pane.getAttribute(ATTR_FONT) !== null) pane.removeAttribute(ATTR_FONT)
    }

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
      const contentH = root ? contentBoxHeight(root) : 0
      // 基准用“未被压缩时的内容高度”，否则被 fit 压缩过的块会把起点算小。
      const heights = {}
      const fixed = paneKeys(panes).filter((key) => key !== 'main')
      for (const id of fixed) {
        const el = paneElement(panes, id)
        const saved = savedHeight(id)
        heights[id] = saved !== null ? saved : el ? unconstrainedHeight(el) : 0
      }

      // 原生高度：拖回这个值就等于“取消覆盖”，不能拿当前（可能已被压缩的）高度当基准。
      const targetEl = paneElement(panes, target)
      const native = targetEl ? unconstrainedHeight(targetEl) : heights[target] || 18

      // 可增长的上限：内容高度 − 主区下限 − 其它固定块的当前高度。
      const others = fixed.filter((id) => id !== target).reduce((sum, id) => sum + (heights[id] || 0), 0)
      const max = Math.max(paneMin(target, native), contentH - MIN_MAIN - others)
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
              natural: paneElement(panes, 'foot') ? unconstrainedHeight(paneElement(panes, 'foot')) : heights.foot || 22,
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
        min: paneMin(target, native),
        max,
        h: heights[target] || native,
      }
      if (root) root.setAttribute('data-dsh-sw-dragging', '1')
      const sash = ui.sashes[sashId]
      if (sash) sash.setAttribute('data-dsh-sw-active', '')
      window.addEventListener('pointermove', onDragMove, true)
      window.addEventListener('pointerup', onDragEnd, true)
      window.addEventListener('pointercancel', onDragEnd, true)
    }

    /** 某块能长到多高：内容高度 − 主区下限 − 其它固定块。 */
    function contentHMax(target) {
      const panes = ui.panes
      const contentH = ui.root ? contentBoxHeight(ui.root) : 0
      let others = 0
      for (const key of paneKeys(panes)) {
        if (key === 'main' || key === target) continue
        if (paneHidden(key)) continue
        const el = paneElement(panes, key)
        const saved = savedHeight(key)
        others += saved !== null ? saved : el ? unconstrainedHeight(el) : 0
      }
      return Math.max(MIN_PANE[target] || 22, contentH - MIN_MAIN - others)
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
        drag.min = paneMin(pick.target, drag.natural)
        drag.h = pick.h0
      }
      const raw = drag.h0 + (drag.inverted ? -dy : dy)
      const h = Math.round(Math.min(drag.max, Math.max(drag.min, raw)))
      if (h === drag.h) return
      drag.h = h
      drag.moved = true
      if (drag.kind === 'row') {
        state = { ...state, rows: { ...rowOverrides(), [drag.key]: h } }
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

    /** 这一行的原生高度：第一次见到（还没被我们改过）时量一次并记住。 */
    const rowNatCache = new WeakMap()

    function rowNatural(row) {
      const cached = rowNatCache.get(row)
      if (cached) return cached
      const styled = row.getAttribute(ATTR_ROW) !== null
      const value = Math.max(
        MIN_ROW,
        styled
          ? unconstrainedHeight(row) || Math.round(row.getBoundingClientRect().height || 0)
          : Math.round(row.getBoundingClientRect().height || 0),
      )
      const natural = value || MIN_ROW
      rowNatCache.set(row, natural)
      return natural
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
      const flowOf = (el) => {
        try {
          const cs = window.getComputedStyle(el)
          return cs && typeof cs.flexDirection === 'string' ? cs.flexDirection : ''
        } catch (error) { return '' }
      }
      const collect = (container, id, depth) => {
        if (!container || depth > 3 || seen.has(container)) return
        seen.add(container)
        // 穿透纯包裹层：宿主很多容器只有 1 个子元素，真正的一排在更里面。
        let node = container
        for (let guard = 0; guard < 4; guard += 1) {
          const kids = Array.from(node.children).filter((child) => !ownNode(child))
          if (kids.length !== 1) break
          const inner = kids[0]
          if (!inner || (inner.children && inner.children.length === 0)) break
          node = inner
        }
        const rows = Array.from(node.children).filter((child) => !ownNode(child) && child !== accountEl)
        if (rows.length) {
          const flow = flowOf(node)
          if (!(flow === 'row' || flow === 'row-reverse')) scopes.push({ id, container: node, rows })
        }
        if (depth >= 3) return
        const kids = Array.from(node.children).filter((child) => !ownNode(child) && child !== accountEl)
        for (let i = 0; i < kids.length; i += 1) {
          const child = kids[i]
          if (!child.children || !child.children.length) continue
          collect(child, id + '-' + i, depth + 1)
        }
      }
      if (panes.nav) collect(panes.nav, 'nav', 0)
      if (panes.foot) {
        let index = 0
        for (const child of panes.foot.children) {
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

    /** 某一行的最低高度；账号行比普通行高一档。 */
    function rowMin(key) {
      return key === ACCOUNT_KEY ? MIN_ACCOUNT : MIN_ROW
    }

    /** 只放图标、没有文字的按钮行：默认压紧（用户说“小部件不占这么大空间”）。 */
    function isIconOnly(row) {
      if (!row) return false
      if (String(row.textContent || '').trim()) return false
      return !!row.querySelector('svg, img, [class*="icon" i]')
    }

    function compactIconRow(row) {
      if (!isIconOnly(row)) {
        if (row.getAttribute(ATTR_ICONROW) !== null) {
          dropStyle(row, 'height')
          dropStyle(row, 'min-height')
          dropStyle(row, 'padding-top')
          dropStyle(row, 'padding-bottom')
          row.removeAttribute(ATTR_ICONROW)
        }
        return false
      }
      const rect = row.getBoundingClientRect()
      const h = Math.round((rect && rect.height) || 0)
      if (h && h <= ICON_ROW_H + 6) return false
      writeStyle(row, 'height', ICON_ROW_H + 'px', 'important')
      writeStyle(row, 'min-height', '0', 'important')
      writeStyle(row, 'padding-top', '2px', 'important')
      writeStyle(row, 'padding-bottom', '2px', 'important')
      row.setAttribute(ATTR_ICONROW, '1')
      return true
    }

    function applyRowSizing(panes) {
      for (const scope of rowScopes(panes)) {
        if (!scopeVisible(scope)) continue
        for (let i = 0; i < scope.rows.length; i += 1) {
          const row = scope.rows[i]
          const key = scope.id + ':' + i
          const saved = rowSaved(key)
          if (saved === null) {
            dropStyle(row, 'flex-grow')
            dropStyle(row, 'flex-shrink')
            dropStyle(row, 'flex-basis')
            dropStyle(row, 'height')
            dropStyle(row, 'overflow')
            if (row.getAttribute(ATTR_ROW) !== null) row.removeAttribute(ATTR_ROW)
            clearFit(row)
            // 只有图标的行不用占一整行的高度，默认压到 ICON_ROW_H；还能拖高。
            compactIconRow(row)
            continue
          }
          writeStyle(row, 'flex-grow', '0', 'important')
          writeStyle(row, 'flex-shrink', '0', 'important')
          writeStyle(row, 'flex-basis', saved + 'px', 'important')
          writeStyle(row, 'height', saved + 'px', 'important')
          writeStyle(row, 'overflow', 'hidden', 'important')
          row.setAttribute(ATTR_ROW, key)
          // 账号行只改高度，绝不缩里面的字号和头像。
          if (key !== ACCOUNT_KEY) fitRow(row, Math.max(0, saved), rowNatural(row))
          else clearFit(row)
        }
      }
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

    /**
     * 账号/头像那一行：原生大小、不缩放、贴在自己容器最底部。
     * 上面几行被压缩时它不动，视觉上就和上面“断开”了。
     */
    function applyAccountPin() {
      const row = accountEl
      if (!row) return false
      const own = rowSaved(ACCOUNT_KEY) !== null
      if (!own && row.getAttribute(ATTR_ROW) !== null) {
        dropStyle(row, 'height')
        dropStyle(row, 'flex-basis')
        dropStyle(row, 'overflow')
        row.removeAttribute(ATTR_ROW)
      }
      dropStyle(row, 'zoom')
      dropStyle(row, 'width')
      dropStyle(row, 'font-size')
      dropStyle(row, 'line-height')
      if (row.getAttribute(ATTR_ZOOM) !== null) row.removeAttribute(ATTR_ZOOM)
      if (row.getAttribute(ATTR_FONT) !== null) row.removeAttribute(ATTR_FONT)
      writeStyle(row, 'flex-grow', '0', 'important')
      writeStyle(row, 'flex-shrink', '0', 'important')
      // 不再把底部内容“压”到视口最下面：用户明确要的是头像跟着内容走，
      // 不是被钉在窗口底部（钉底会让它和上一块之间空出一大片，还会把用量卡顶出盒子）。
      const footEl = ui.panes ? paneElement(ui.panes, 'foot') : null
      const kids = footEl ? Array.from(footEl.children).filter((child) => !ownNode(child)) : []
      for (const child of kids) {
        dropStyle(child, 'margin-top')
        writeStyle(child, 'flex-grow', '0', 'important')
        writeStyle(child, 'flex-shrink', '0', 'important')
      }
      // 底栏有自定义高度时，把头像行用 auto 外边距顶到它自己那一块的底部：
      // 上面几行再怎么压，头像和它下面的部分都不跟着动（用户要的“互不干扰”）。
      // 找“能把它顶到底部”的那一层：从头像往上看，第一个不是末位子元素的祖先，
      // 给它 auto 外边距，头像（和它后面的内容）就固定在底栏自己这一块的底部。
      let pinned = row
      let node = row
      while (node && node.parentElement && node.parentElement !== footEl) {
        const parent = node.parentElement
        const siblings = Array.from(parent.children).filter((child) => !ownNode(child))
        if (siblings.length && siblings[siblings.length - 1] !== node) { pinned = node; break }
        node = parent
      }
      for (const child of kids) {
        if (child !== pinned) dropStyle(child, 'margin-top')
      }
      const targets = [row, pinned]
      for (const el of targets) {
        if (el !== pinned) dropStyle(el, 'margin-top')
      }
      if (savedHeight('foot') !== null) writeStyle(pinned, 'margin-top', 'auto', 'important')
      else dropStyle(pinned, 'margin-top')
      return kids.length > 0
    }

    /** 这一行还能长多高：把主区（工作区与会话）压到 MIN_MAIN 为止，余量都给它。 */
    /**
     * 行能被拖到多高：不能超过它所在容器当前还能放下的空间。
     * 以前只按“主区余量”算，头像行能被拖到容器外，被 overflow 裁掉就再也看不见了。
     */
    function rowBoxLimit(panes, row, natural) {
      let box = row ? row.parentElement : null
      let paneEl = null
      while (box) {
        if (box.hasAttribute(ATTR_PANE)) { paneEl = box; break }
        box = box.parentElement
      }
      if (!paneEl) return natural
      const rect = paneEl.getBoundingClientRect()
      const boxH = Math.round((rect && rect.height) || 0)
      if (!boxH) return natural
      const others = Array.from(paneEl.querySelectorAll('[' + ATTR_ROW + ']')).reduce((sum, other) => {
        if (other === row) return sum
        const otherRect = other.getBoundingClientRect()
        return sum + Math.round((otherRect && otherRect.height) || 0)
      }, 0)
      return Math.max(natural, boxH - others - 2)
    }

    function rowGrowthLimit(panes, root, natural) {
      const contentH = root ? contentBoxHeight(root) : 0
      const mainEl = paneElement(panes, 'main')
      if (mainEl && !isPaneHidden('main')) {
        const rect = mainEl.getBoundingClientRect()
        return Math.max(natural, natural + Math.max(0, Math.round(rect.height) - MIN_MAIN))
      }
      const fixed = FIXED_PANES.reduce((sum, id) => {
        const el = paneElement(panes, id)
        if (!el || isPaneHidden(id)) return sum
        return sum + Math.round(el.getBoundingClientRect().height || 0)
      }, 0)
      return Math.max(natural, natural + Math.max(0, contentH - fixed))
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
          // 单行 scope（账号行）：缝落在这一行的“上沿”，往上拖就是压这一行。
          const rect = scope.rows[0].getBoundingClientRect()
          if (rect && rect.height >= 1) {
            out.push({
              key: scope.id + ':' + 0,
              row: scope.rows[0],
              y: rect.top,
              ...span(rect),
              edge: 'top',
            })
          }
          continue
        }
        for (let i = 0; i < scope.rows.length - 1; i += 1) {
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
      return out
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

    function rowLabelOf(seam) {
      if (String(seam.key).indexOf('acct:') === 0) return '账号与头像'
      const row = seam.row
      let text = ''
      try {
        text = (row.getAttribute('aria-label') || row.textContent || '').replace(/\s+/g, ' ').trim()
      } catch (error) { text = '' }
      if (!text) text = '这一行'
      if (text.length > 14) text = text.slice(0, 14) + '…'
      return text
    }

    let hintTimer = 0

    function ensureRowHint(gutter) {
      let hint = ui.rowHint
      if (hint && hint.parentNode === gutter) return hint
      hint = document.createElement('div')
      hint.setAttribute(ATTR_ROW_HINT, '')
      hint.setAttribute('aria-hidden', 'true')
      const label = document.createElement('span')
      label.setAttribute(ATTR_ROW_LABEL, '')
      hint.appendChild(label)
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
      const label = hint.querySelector('[' + ATTR_ROW_LABEL + ']')
      if (label) {
        const rowRect = seam.row ? seam.row.getBoundingClientRect() : null
        const height = rowRect ? Math.round(rowRect.height) : 0
        writeText(label, 'textContent', '↑↓ 拖动调整 · ' + rowLabelOf(seam) + (height ? ' · ' + height + 'px' : ''))
      }
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
      const saved = rowSaved(seam.key)
      const h0 = saved === null ? natural : saved
      drag = {
        kind: 'row',
        key: seam.key,
        row,
        y0: event.clientY,
        h0,
        natural,
        min: rowMin(seam.key),
        max: Math.max(h0, rowGrowthLimit(ui.panes, ui.root, natural), rowBoxLimit(ui.panes, row, natural)),
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
      if (!foot) return
      writeStyle(foot, 'display', '')
      if (!hidden) {
        for (const el of Array.from(foot.querySelectorAll('*'))) {
          if (ownNode(el)) continue
          if (el.style.getPropertyValue('display') === 'none') dropStyle(el, 'display')
        }
        return
      }
      const keep = accountEl && foot.contains(accountEl) ? accountEl : null
      if (!keep) return
      let node = keep
      while (node && node !== foot) {
        const parent = node.parentNode
        if (!parent) break
        for (const child of parent.children) {
          if (child === node || ownNode(child)) continue
          writeStyle(child, 'display', 'none')
        }
        node = parent
      }
      writeStyle(keep, 'display', '')
      writeStyle(keep, 'margin-top', 'auto', 'important')
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
            writeStyle(el, 'display', 'none')
            clearFit(el)
          } else {
            dropStyle(el, 'display')
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
        if (candidate.getBoundingClientRect().height <= 96) { last = candidate; break }
        last = candidate
        node = candidate
      }
      return last
    }

    function accountRow(panes) {
      if (!panes || !panes.foot) return null
      const root = panes.foot
      const avatar = avatarNode(root)
      if (!avatar) return guessAccountRow(panes)
      const avatarRect = avatar.getBoundingClientRect()
      if (!avatarRect || avatarRect.height < 8 || avatarRect.width < 8) return guessAccountRow(panes)
      const containers = [root]
      for (const child of root.children) if (!ownNode(child)) containers.push(child)
      let node = avatar
      while (node && node !== root) {
        const parent = node.parentNode
        if (containers.indexOf(parent) >= 0) return node
        node = parent
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
            return { text: String(r.textContent || '').trim().slice(0, 24), rect: rect(r), h: cs.height, mt: cs.marginTop, icon: isIconOnly(r) }
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
    let paneFloor = {}
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

        paneFloor = {}
        markBlocks(panes)
        accountEl = accountRow(panes)
        applyCollapse(panes)
        // 行高先落地：块级缩放要能看见 ATTR_ROW，才不会把已单独调过的行再缩一次。
        applyRowSizing(panes)
        // 只对用户拖过的高度做预算归一；没动过的块保持原生高度（不会再被压到看不见）。
        // 拖拽过程中绝不归一：否则“拖动写 h0+dy”和“预算压回”每帧互相打架，
        // 表现为底栏/头像上下闪烁。
        const trimmed = drag ? false : sanitizeHeights(panes, contentBoxHeight(root))
        const sizing = applyPaneSizing(panes, root)
        // 用真实 rect 再兜一层：存储里的值、外来块、换行都可能让行内高度估不准。
        const trimmed2 = drag ? false : enforceBudget(panes, root)
        const fixedKeys = paneKeys(panes).filter((key) => key !== 'main')

        // 被调整过高度的固定块：内容放不下就等比缩字号。
        let fitted = 0
        for (const id of fixedKeys) {
          const el = paneElement(panes, id)
          if (!el) continue
          if (isPaneHidden(id)) { clearFit(el); continue }
          if (savedHeight(id) === null) { clearFit(el); continue }
          // 面板区里的“行”由行级逻辑负责：块级再缩放会把某些行缩、某些行不缩
          // （用户看到的“有的大字有的小字”），而且会让行高和容器对不上。
          if (id === 'nav') { clearFit(el); continue }
          const z = fitPane(el, sizing.heights[id])
          if (z < 1) fitted += 1
        }

        if ((trimmed || trimmed2) && !drag) persist()
        renderSashes(root, panes)
        applyAccountPin()
        sweepRowNodes()

        // 只要有任何一块/一行被调过尺寸，就把侧栏裁到自己的盒子里：
        // 内容再长也只能在内部滚动，绝不会画到上面那一层上。
        const active = Object.keys(state.heights).length > 0 || Object.keys(rowOverrides()).length > 0
        if (active) {
          writeStyle(root, 'overflow', 'clip', 'important')
          writeStyle(root, 'overflow-x', 'hidden', 'important')
          // 内容真的装不下时（行被拖高、外面又没空间让主子区让出来），
          // 给侧栏加纵向滚动条——用户明确要求“遮挡时能滚轮上下滑动看到”，
          // 而不是让底部头像永远待在被裁掉的位置。
          const overflows = Math.round(root.scrollHeight || 0) - Math.round(root.getBoundingClientRect().height || 0) > 1
          writeStyle(root, 'overflow-y', overflows ? 'auto' : 'hidden', 'important')
        } else {
          dropStyle(root, 'overflow')
          dropStyle(root, 'overflow-x')
          dropStyle(root, 'overflow-y')
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
          // 结构变了（React 重挂、插件插入节点）就必须重画；只是属性变化可以交给签名拦截。
          for (const record of records) {
            if (record.type === 'childList') { lastSig = ''; break }
          }
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
