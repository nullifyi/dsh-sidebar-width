# dsh-sidebar-width

DSH 桌面/Web 端左侧栏的分区尺寸控制插件。名字沿用 v0.1 的「侧栏宽度」，**功能已完全换成侧栏分区（VS Code SplitView 模型）**。

## 能做什么

侧栏被认成 5 块 **+ 其它插件加进来的块**（React 重挂后自动重新识别）：

| 区块 id | 认出方式 | 内容 |
| --- | --- | --- |
| `brand` | `logoRow` 子串 | 品牌行 + 品牌按钮 |
| `new` | `newSession` 子串（或前两块里的 button） | 新会话 |
| `nav` | `panelList` 子串（`nav` 语义） | 插件 / 自动化任务 / 任务看板 |
| `main` | `regionArea` 子串（或 nav 与 foot 之间） | 工作区与会话列表 |
| `foot` | `footArea` 子串 | 用量卡、远程控制、设置、账号头像 |
| `extra:N` | 以上都不匹配的 root 直接子元素（v0.6.4） | 其它插件挂进侧栏的自定义块，如状态条、宠物、自定义面板 |

> **对其它插件自动适配**（v0.6.4）：只要组件被挂到侧栏根节点下（`root` 的直接子元素）并且不是本插件自己的节点，就会被当成一块 `extra:N`，自动获得与内置区块完全相同的待遇：相邻之间的分割条、拖拽调高、内容缩放、行级拖动带、窄轨让位。不需要改那个插件，也不需要在本插件里登记。挂载/卸载时 `extra:N` 序号会随 DOM 顺序重排。

- **拖分界**：块与块之间悬停时出现一条 20×4 的居中握把，按住上下拖即改其中一块的高度。
  - `brand|new`、`new|nav`、`nav|main`：往下拖 = 上面这块变高。
  - `main|foot`：方向相反，往上拖 = 底部区变高。
- **双击分界**：把这块恢复成原生高度。
- **头像那一行独立**（v0.6.1）：账号/头像行保持原生大小，`flex-shrink:0` + `margin-top:auto` 钉在自己容器最底部；上面几行被压缩时它既不缩也不上移，视觉上与上面断开。它没有行缝、也不参与任何 zoom / 字号缩放。
- **每一行也能单独调，且没有任何覆盖元素**（v0.6.2）：行与行之间的缝用 `root` 上的坐标命中（±4px），不再插入 7px 高的手柄或常驻小握把，所以不会出现“多条横线”、也不会压住行底边的点击。鼠标靠近缝时只在缝中央浮现一个 26×3 的小握把和「↑ 压缩 · 行名」，拖动超过 3px 才接管；拖完 250ms 内的那次 click 会被抑制，不会顺带切面板。面板列表里的每一行（插件 / 自动化任务 / 任务看板 …）、底部区块之间、以及底部每个容器里的每一行（用量卡 / 设置行 / 账号行 …）下面各有一条同样的拖动带。鼠标移上去左侧浮现一个 14×3 的小握把，按住上下拖只改这一行的高度；双击这一行的缝即复位。文件夹里的子对话属于自动增删的列表，不做调整。
- **内容自动缩小**：被调矮的块如果装不下内容，块内子元素按 `zoom = 实际高度 / 自然高度` 等比缩小（含字号、图标、内边距），最紧 `42%`；拖高一点会自动放大回来。
- **不会挤掉底部**：`main` 永远 `flex-grow:1` 吃掉剩余空间并保底 `64px`，`foot` 另有 `margin-top:auto`——所以即使把「工作区与会话」整块折叠掉，底部账号区依旧贴在侧栏最下方，头像不会上移。账号行本身再叠一层 `flex-shrink:0`，永不被压扁。其余四块的基线高度之和超出可用高度时会被按比例回收。
- **折叠块**：每块左侧 12px 内边距里有一枚 11×22 的折叠键（常驻 0.6 透明度），点一下整块收起，变成头像正上方的图标；悬浮图标显示「区块名 · 已折叠」+ 剩余的条目名，再点一下原地展开。
- **窄轨让位**：侧栏被原生折叠成 56px 窄轨（`root` 带 `*_collapsed`）时，分界、折叠键、图标坞全部撤掉。

## 状态

- localStorage 键：`dsh-sidebar-sections:v4`（v0.6.3 起；首次加载会把旧的 v3 迁移过来，只继承块高度与折叠状态，**旧的行高不继承**——早期版本在真实宿主里把行压坏过）
- 结构：`{ "heights": { "brand": 60, "nav": 120 }, "rows": { "nav:0": 30, "foot1:2": 26 }, "hidden": ["nav"] }`
- `heights` 是块级覆盖（键为 `brand` / `new` / `nav` / `foot`），`rows` 是行级覆盖（键形如 `nav:2`、`foot:0`、`foot1:1`：scope 名 + 行序号）。
- 只存被改动过的块/行；拖回原生高度会自动删掉对应键。v2（逐行 zoom）键会被清掉。

## 诊断

| 属性 | 位置 | 值 |
| --- | --- | --- |
| `data-dsh-sw-state` | `document.documentElement` | `panes:nav=62 rows:1 fit:1 hidden:0` / `rail` / `no-root` / `no-blocks` |
| `data-dsh-sw-fault` | `document.documentElement` | apply 抛错时的错误摘要 |
| `data-dsh-sw-sash` / `-pane` / `-hidden` / `-zoom` / `-block` | 相关元素 | 便于在 DevTools 里查 |
| `data-dsh-sw-row` / `-rowhint` / `-seam` | 被覆盖的行、悬浮提示线、当前对齐的缝 | 行级调高的诊断锚点（v0.6.2 起没有覆盖层元素） |

## 设置页

`设置 → 侧边栏分区`（`settings.section`，id `sidebar-sections`，order 37）：显示已调高度的块、已调行高的行、已折叠的块，并提供「恢复块的原始高度 / 恢复每一行的原始高度 / 展开全部区块 / 全部复位」。

## 与其它插件的关系

- 只写 `height` / `flex-basis` / `flex-grow` / `flex-shrink` / `overflow` / `zoom` / `width` / `font-size` / `line-height` / `margin-top` / `position` 这几个内联属性，且只用 `importance: important` 写自己要用的那几个。
- 不接管原生拖拽（v0.1 的 `col-resize` 接管已删除），不与 `dsh-better-sidebar`、`ui-theme` 的字体设置冲突。
- 不改任何全局 CSS 变量。

## 测试

```pwsh
cd F:\dsh\daliy\_probe
node harness\test.mjs        # 91 项：分界与行缝的命中/拖动/夹取/持久化/折叠/图标坞/底部贴底/窄轨/幂等
node harness\settings-test.mjs  # 10 项：设置页注册与渲染
```

夹具在 `harness/test.mjs` 里用 jsdom 合成了一套侧栏骨架，通过 `getBoundingClientRect` 打桩模拟 flex 布局（jsdom 不做排版），因此断言的是**渲染高度、样式值、存储内容**这些可观察结果。

## 从「插件市场」安装（dsh-market）

本仓库同时提供一份符合 DSH **插件市场索引格式 1** 的索引文件：`market/index.json`。
在 DSH 的 **插件 → 发现** 里点「添加索引源」，粘贴：

```
https://raw.githubusercontent.com/nullifyi/dsh-sidebar-width/main/market/index.json
```

添加后可在「发现」里按 名称/关键词/分类/标签 搜索到「侧栏分区拖拽」，条目里会显示版本 `0.6.1`、作者、仓库与安装按钮；安装走的是固定在提交 `98afe8b` 的 `git+https` 源。索引条目字段：

| 字段 | 值 |
| --- | --- |
| `name` | `dsh-sidebar-width` |
| `metadata.category` | `sidebar`（侧栏） |
| `metadata.labels` | `resizable` 可拖拽调整、`collapsible` 可折叠、`chinese` 中文界面 |
| `metadata.keywords` | 侧栏 / 侧边栏 / 拖拽调整 / 分割条 / 折叠 + sidebar / sash / splitview / resizable / collapse |

索引标题、描述、分类、标签都带 `en` 与 `zh` 两份文案，市场按当前界面语言显示；`en` 是格式 1 的必填项。

### 发新版时

改 `market/index.json` 里该插件的 `versions`：追加一条 `{ version, publishTimestamp, source: { type: "git", url, commit } }`（`commit` 用已推送的 40 位 SHA），再更新 `metadata.sortKeys.updated`。

## 关于 Topics 与标签

- **GitHub topics 只能用 ASCII**（小写字母、数字、连字符），所以仓库 topics 是 `dsh` `dsh-plugin` `deepseek-harness` `sidebar` `sash` `splitview` `resizable` `collapsible`。
- **中文标签**放在两处：`package.json` 的 `keywords`（npm 标签，含 侧栏/侧边栏/拖拽调整/分割条/折叠）和插件市场索引的 `metadata.keywords` / 分类 / 标签中文标题里。

## 变更记录

### v0.6.4
- **其它插件加进侧栏的块自动纳入管理**：`root` 下不属于内置五块的自定义元素识别为 `extra:N`，自动生成分割条、可拖高、可缩放；序号随 DOM 顺序重排，卸载后自动消失。同一容器内的兄弟块一起参与，面板行级的拖动带同样覆盖。
- **折叠底部不再带走头像**：折叠 `foot` 时只把用量卡/远程控制/图标行这些旁支藏起来，账号头像那一行留在原位（仍在侧栏底部），折叠键也随之搬到图标坞上方，随时可展开。
- **折叠后折叠键不再消失**：以前整块折叠时按钮被一起藏掉，只能靠图标坞展开；现在折叠键保留在图标坞上方，键盘/鼠标都能直接点开。
- 拖拽恢复基准修正：正拖回**原生高度**才删除覆盖（以前拿当前高度当基准，压缩过的块拖回原生尺寸会被误当成“更大”）。

### v0.6.3
- 存储键升到 `dsh-sidebar-sections:v4`：首次加载把旧的 v3 迁移过来，只继承「块高度 + 折叠状态」，**历史行高一概丢弃**——它修的是“一打开侧栏，面板行就矮成一条、字号缩到底”。
- 行缝提示从贯穿全宽的 2px 线，改成缝中央一个 26×3 的小握把；指针离开、页面滚动、窗口失焦或 2.5 秒没有动作都会自动隐藏，不再留下“特别长的横线”。
