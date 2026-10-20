# dsh-sidebar-width

DSH 桌面/Web 端左侧栏的分区尺寸控制插件。名字沿用 v0.1 的「侧栏宽度」，**功能已完全换成侧栏分区（VS Code SplitView 模型）**。

## 能做什么

侧栏被认成 5 块（React 重挂后自动重新识别）：

| 区块 id | 认出方式 | 内容 |
| --- | --- | --- |
| `brand` | `logoRow` 子串 | 品牌行 + 品牌按钮 |
| `new` | `newSession` 子串（或前两块里的 button） | 新会话 |
| `nav` | `panelList` 子串（`nav` 语义） | 插件 / 自动化任务 / 任务看板 |
| `main` | `regionArea` 子串（或 nav 与 foot 之间） | 工作区与会话列表 |
| `foot` | `footArea` 子串 | 用量卡、远程控制、设置、账号头像 |

- **拖分界**：块与块之间悬停时出现一条 20×4 的居中握把，按住上下拖即改其中一块的高度。
  - `brand|new`、`new|nav`、`nav|main`：往下拖 = 上面这块变高。
  - `main|foot`：方向相反，往上拖 = 底部区变高。
- **双击分界**：把这块恢复成原生高度。
- **头像那一行独立**（v0.6.1）：账号/头像行保持原生大小，`flex-shrink:0` + `margin-top:auto` 钉在自己容器最底部；上面几行被压缩时它既不缩也不上移，视觉上与上面断开。它没有行缝、也不参与任何 zoom / 字号缩放。
- **每一行也能单独调**（v0.6.0 新增）：面板列表里的每一行（插件 / 自动化任务 / 任务看板 …）、底部区块之间、以及底部每个容器里的每一行（用量卡 / 设置行 / 账号行 …）下面各有一条同样的拖动带。鼠标移上去左侧浮现一个 14×3 的小握把，按住上下拖只改这一行的高度；双击这一行的缝即复位。文件夹里的子对话属于自动增删的列表，不做调整。
- **内容自动缩小**：被调矮的块如果装不下内容，块内子元素按 `zoom = 实际高度 / 自然高度` 等比缩小（含字号、图标、内边距），最紧 `42%`；拖高一点会自动放大回来。
- **不会挤掉底部**：`main` 永远 `flex-grow:1` 吃掉剩余空间并保底 `64px`，`foot` 另有 `margin-top:auto`——所以即使把「工作区与会话」整块折叠掉，底部账号区依旧贴在侧栏最下方，头像不会上移。账号行本身再叠一层 `flex-shrink:0`，永不被压扁。其余四块的基线高度之和超出可用高度时会被按比例回收。
- **折叠块**：每块左侧 12px 内边距里有一枚 11×22 的折叠键（常驻 0.6 透明度），点一下整块收起，变成头像正上方的图标；悬浮图标显示「区块名 · 已折叠」+ 剩余的条目名，再点一下原地展开。
- **窄轨让位**：侧栏被原生折叠成 56px 窄轨（`root` 带 `*_collapsed`）时，分界、折叠键、图标坞全部撤掉。

## 状态

- localStorage 键：`dsh-sidebar-sections:v3`
- 结构：`{ "heights": { "brand": 60, "nav": 120 }, "rows": { "nav:0": 30, "foot1:2": 26 }, "hidden": ["nav"] }`
- `heights` 是块级覆盖（键为 `brand` / `new` / `nav` / `foot`），`rows` 是行级覆盖（键形如 `nav:2`、`foot:0`、`foot1:1`：scope 名 + 行序号）。
- 只存被改动过的块/行；拖回原生高度会自动删掉对应键。v2（逐行 zoom）键会被清掉。

## 诊断

| 属性 | 位置 | 值 |
| --- | --- | --- |
| `data-dsh-sw-state` | `document.documentElement` | `panes:nav=62 rows:1 fit:1 hidden:0` / `rail` / `no-root` / `no-blocks` |
| `data-dsh-sw-fault` | `document.documentElement` | apply 抛错时的错误摘要 |
| `data-dsh-sw-sash` / `-pane` / `-hidden` / `-zoom` / `-block` | 相关元素 | 便于在 DevTools 里查 |
| `data-dsh-sw-rsash` / `-row` / `-rowspace` / `-font` | 行级手柄、行、行覆盖层 | 行级调高的诊断锚点 |

## 设置页

`设置 → 侧边栏分区`（`settings.section`，id `sidebar-sections`，order 37）：显示已调高度的块、已调行高的行、已折叠的块，并提供「恢复块的原始高度 / 恢复每一行的原始高度 / 展开全部区块 / 全部复位」。

## 与其它插件的关系

- 只写 `height` / `flex-basis` / `flex-grow` / `flex-shrink` / `overflow` / `zoom` / `width` / `font-size` / `line-height` / `margin-top` / `position` 这几个内联属性，且只用 `importance: important` 写自己要用的那几个。
- 不接管原生拖拽（v0.1 的 `col-resize` 接管已删除），不与 `dsh-better-sidebar`、`ui-theme` 的字体设置冲突。
- 不改任何全局 CSS 变量。

## 测试

```pwsh
cd F:\dsh\daliy\_probe
node harness\test.mjs        # 91 项：分界与行缝插入/拖动/夹取/持久化/折叠/图标坞/底部贴底/窄轨/幂等
node harness\settings-test.mjs  # 10 项：设置页注册与渲染
```

夹具在 `harness/test.mjs` 里用 jsdom 合成了一套侧栏骨架，通过 `getBoundingClientRect` 打桩模拟 flex 布局（jsdom 不做排版），因此断言的是**渲染高度、样式值、存储内容**这些可观察结果。
