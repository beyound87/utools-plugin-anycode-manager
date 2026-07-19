# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

AnyCode 会话管理器 —— uTools 插件，统一浏览和管理本地 AI 编程 CLI 的会话记录，支持 **Claude Code、Codex CLI、Gemini CLI、OpenCode** 四大平台。支持搜索、删除、重命名、fork 分支、在终端中恢复会话、导出为 Markdown/HTML/长图、记忆管理等操作。

各平台会话存储：
- Claude Code：`~/.claude/projects/<项目>/<uuid>.jsonl`
- Codex CLI：`~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`（按 cwd 分组为项目）
- Gemini CLI：`~/.gemini/tmp/<hash>/chats/session-*.jsonl`
- OpenCode：`~/.local/share/opencode/opencode.db`（SQLite，session/message/part 三表）

## 常用命令

```bash
pnpm dev      # 启动开发服务器 (localhost:5173)，配合 uTools 开发者模式使用
pnpm build    # 构建到 dist/ 目录，构建后自动裁剪 better-sqlite3 编译产物
```

无测试、无 lint 配置。

构建产物 `dist/` 约 5MB：`pnpm build` = `vite build` + `node scripts/prune-dist.mjs`。裁剪脚本删除 `dist/preload/node_modules/better-sqlite3` 的编译中间产物（`.pdb`/`.obj`/`.ilk`/`sqlite3.lib`/`deps`/`src`），只留运行时 `build/Release/better_sqlite3.node`（78MB→3MB），满足 uTools 插件市场 20MB 上限。源码 `node_modules` 不受影响。

## 技术栈

- Vue 3 (Composition API, `<script setup>`) + Vite 6
- 包管理器: pnpm
- 纯 CSS，无第三方 UI 库
- html2canvas 用于长图导出
- better-sqlite3 读取 OpenCode 数据库（preload 层，源码依赖）
- 亮色/暗色主题跟随系统 `prefers-color-scheme`

## 架构

### Preload 层（Node.js，provider 架构）

`public/preload/services.js` — 聚合入口，通过 `window.services` 暴露 API，按 `provider` 字段路由到对应 CLI 实现：

- `getProjectsQuick()` — 聚合所有可用 provider 的项目列表（快扫，不加载会话详情）
- `loadProjectSessions(projectPath, providerId, project)` — 加载指定项目会话列表
- `readSessionFile(filePath, providerId)` — 读取并归一化会话为统一消息格式
- `deleteSession` / `deleteProjectSessions` / `batchDeleteSessions` — 删除（按 provider 路由）
- `renameSession` / `toggleFavorite` / `forkSession` / `forkSummarySession` — 写回类操作（仅 Claude Code 支持）
- `resumeSession` / `newSession` — 按各 CLI 命令在终端中恢复/新建
- `getSnapshotFileContents` / `restoreSnapshot` — 快照（仅 Claude Code）
- `getMemoryFiles` / `saveMemoryFile` / `deleteMemoryFile` / `clearMemory` — 记忆管理（仅 Claude Code）
- `getAvailableProviders()` / `getProvider(id)` — provider 元信息查询（前端按能力显隐 UI）
- `watchSessionFile` / `watchMemoryDir` — 文件监听（OpenCode 的 SQLite 存储不支持）

`public/preload/providers/` — 各平台独立实现：

- `common.js` — 共享工具：`parseJsonl`（兼容单行/美化多行）、`isSystemText`、`spawnDetached`、`launchInTerminal`（跨平台终端启动 + 预设/自定义模板）、`readSessionFileSmart`（大文件只读尾部）
- `claude.js` — Claude Code：完整功能（fork/快照/记忆）。会话名 `readSessionMeta` 头 8KB 取 sessionId/cwd，尾部渐进读取（512KB→4MB→16MB）找真实用户消息，退回 `extractAiTitle`（ai-title slug）再退回 UUID
- `codex.js` — Codex CLI：日期分区扫描按 cwd 分组，首行 `session_meta` 带 mtime 缓存；`event_msg`/`response_item` 归一化，工具名映射（exec_command→Bash、apply_patch→Edit 等）
- `gemini.js` — Gemini CLI：JSONL 与旧 JSON 双格式
- `opencode.js` — OpenCode：`better-sqlite3` 读 session/message/part 三表

每个 provider 导出统一接口 + 能力标记（`supportsRename`/`supportsFork`/`supportsMemory`/`supportsSnapshot`）。项目/会话对象带 `provider` 字段标识来源。

**消息归一化**：各 CLI 原始格式在 `readSessionFile` 阶段统一转为 Claude 兼容中间格式（`{ type, message: { role, content: [{ type: 'text'|'tool_use'|'tool_result'|'thinking' }] }, sessionId, cwd, timestamp, uuid }`），provider 特有原始数据留在 `_raw`，使 `useMessageParser.js` 和 `SessionView.vue` 无需为每平台写分支。

### 渲染层（Vue）

`src/App.vue` 作为根组件协调全局状态和业务逻辑，UI 拆分为组件：

**组件** (`src/components/`)：
- `Sidebar.vue` — 左侧项目/会话列表、搜索、多选、过滤（仅展示有记忆的项目）
- `SessionView.vue` — 右侧会话消息渲染（消息合并、tool_use/tool_result 配对折叠、导出）
- `MemoryView.vue` — 记忆管理页：文件 Markdown 预览、在线编辑、外部变更冲突解决、MEMORY.md 页内链接导航
- `ExportOptionsDialog.vue` — 导出选项对话框（图片/HTML 导出设置）
- `RenameDialog.vue` / `DeleteConfirmDialog.vue` / `ForkDialog.vue` — 操作弹窗
- `SettingsDrawer.vue` — 右侧抽屉设置面板
- `StatsView.vue` — 统计洞察抽屉：会话数/占用/平台分布/活跃度/Top项目/OpenCode 花费（数据来自 `getStats`）
- `ImagePreview.vue` — 图片预览
- `SnackBar.vue` — 全局提示条
- `icons/index.js` — SVG 图标组件，函数式渲染（`h()` 函数）

**Composables** (`src/composables/`)：
- `useMessageParser.js` — 消息解析核心：content blocks 解析、tool_use/tool_result 配对合并、连续 assistant 消息合并、isMeta 命令注入合并、sourceToolUseID/sourceToolAssistantUUID 工具响应合并、isApiErrorMessage 错误识别、token 统计累加
- `useToolDisplay.js` — 工具调用展示：摘要生成、Edit diff 渲染（LCS + 内联高亮）、折叠状态管理（含 `forceExpand` 用于导出时临时展开）
- `useDiff.js` — LCS diff 算法与内联高亮工具函数（由 useToolDisplay 和 MemoryView 共用）
- `useSearch.js` — 会话内搜索：关键词高亮定位、区分大小写/全字匹配/正则表达式选项
- `useExport.js` — 导出功能：Markdown 导出、`collectPageStyles()` 收集页面 CSS、`serializeToHtml()` 将 DOM 克隆序列化为独立 HTML
- `useSnackbar.js` — 全局 snackbar 状态（模块级单例 ref）
- `useTheme.js` — 暗色模式检测（模块级单例 ref）
- `useFormat.js` — 时间/大小/路径格式化工具函数
- `useMarkdown.js` — Markdown 渲染（markdown-it 配置）
- `useSessionOverrides.js` — 跨平台会话别名/收藏，存 `utools.dbStorage`（键 `provider:sessionId`），`applyOverride` 叠加到会话对象上

### uTools 集成

- `public/plugin.json` — 插件配置，feature code `sessions`，关键词"CC会话管理"
- `public/window.html` — 开发模式下新窗口的中转页，`location.replace` 跳转到 Vite 地址
- 开发模式 `main` 指向 `http://localhost:5173`
- `window.utools.dbStorage` 持久化用户设置（key: `terminalCommand`）
- `window.utools.shellOpenPath()` 打开项目目录
- `window.utools.shellShowItemInFolder()` 定位文件
- `window.utools.createBrowserWindow()` 在独立窗口中打开会话；通过 `localStorage.__cc_pending_session` 传递会话信息，通过 `BroadcastChannel('cc-session')` 同步删除事件
- `window.utools.getWindowType()` 判断当前窗口是主窗口还是独立会话窗口（返回 `'browser'` 时为独立窗口）

### 样式规范：亮色/暗色双主题

新增或修改任何 CSS 样式时，必须同时处理亮色和暗色两种模式。根组件 `App.vue` 通过 `:class="{ dark: isDark }"` 控制主题，暗色样式使用 `.dark` 选择器覆盖：
- 各组件内使用 `.dark .xxx` 或父组件传递的 `.dark` 类来定义暗色变体
- 颜色、背景、边框、阴影等视觉属性都需要提供暗色版本
- `main.css` 中滚动条样式通过 `@media (prefers-color-scheme: dark)` 适配

### 关键设计模式

- Composables 中 `useSnackbar` 和 `useTheme` 使用模块级 `ref()` 实现跨组件单例共享状态
- 消息合并逻辑：连续 assistant 消息、tool_result 响应、sourceToolUseID/sourceToolAssistantUUID 工具响应、系统注入文本都会合并到前一个 assistant 消息中；isMeta 命令注入消息合并到前一个 user 消息中作为 `type: 'meta'` 块。合并时在 merged message 上记录 `lastUuid`（最后一条被合并的原始 item 的 uuid），供 fork 等功能定位截断点
- `isCompactSummary` 消息直接 push 为独立节点，不参与合并，在 SessionView 中以"上下文压缩"块展示
- 系统注入判定：`isSystemText(text)` 判断文本是否系统生成（`<` 开头一律系统；`[` 开头仅 `[Request/[Error/[System/[tool_/[WARNING` 前缀为系统，`[Image]` 等属用户输入）。该函数在 `preload/providers/common.js` 和 `src/composables/useMessageParser.js` 中各有一份，修改时必须同步更新两处。注意：含 `<command-name>` 的消息是用户命令，不算系统事件
- 会话名提取：优先 `custom-title`（用户重命名）> 尾部渐进读取找真实用户消息（跳过工具响应/命令注入/续接样板文 "This session is being continued..."）> `ai-title`（Claude 自动标题）> 会话 ID。Codex 从 `event_msg.user_message`/`response_item` role=user 提取；OpenCode 直接用 DB 的 title 字段
- 工具调用渲染：tool_use 与 tool_result 按 ID 配对，默认折叠，点击展开；若工具调用对应子对话，卡片头部显示"查看"链接（通过 `agentToolUseMap` computed 建立 toolUseId → subagent 映射）
- Edit 工具的 diff 使用 LCS 算法 + 内联差异高亮，结果通过 WeakMap 缓存；LCS 逻辑已提取到 `useDiff.js`，MemoryView 冲突 diff 复用同一实现
- 记忆管理：`getProjectsQuick()` 扫描项目时同时检测 `memory/MEMORY.md`，写入 `hasMemory`/`memorySize`/`memoryFileCount` 到项目对象；`App.vue` 通过 `watch(memoryFiles, ..., { deep: true })` 在记忆内容变化时实时同步侧边栏统计
- MEMORY.md 渲染：`renderMemoryContent(text, isIndex)` 检测 YAML frontmatter 单独渲染为样式化 key-value 块；`isIndex=true` 时为含相对链接的列表项注入管理按钮（内联 SVG），点击后弹出下拉菜单可删除记忆（同步从 MEMORY.md 移除引用行并删除文件）
- `referencedFiles` computed 实时解析 MEMORY.md 引用的文件名集合，未被引用的 `.md` 文件标记为"无效记忆"并显示删除按钮
- 共用滚动按钮：`.scroll-btn` 样式提取到 `main.css`，SessionView 和 MemoryView 共用同一 class
- 导出架构：图片和 HTML 导出共用 DOM 克隆方案（`prepareExportClone()` + `serializeToHtml()`），不维护独立的 HTML 模板和样式。`collectPageStyles()` 收集页面 CSS 时会过滤无关规则（sidebar/dialog 等）并剥除 `data-v-xxx` scoped 选择器，末尾追加覆盖规则确保独立 HTML 正常居中滚动
- `DeleteConfirmDialog` 的 `showHint` prop 控制是否显示 Ctrl 跳过提示：Sidebar 调用时传 event（showHint=true），SessionView 调用时不传 event（showHint=false）
- 项目懒加载：`loadProjects()` 调用 `getProjectsQuick()` 仅加载项目元数据；`loadProjectSessionsFor(name)` 在展开项目或搜索时按需加载完整会话列表
- Subagent 文件存放在 `<projectDir>/<sessionUuid>/subagents/agent-<agentId>.jsonl`，名称优先读 `agent-<agentId>.meta.json` 中的 `description` 字段
- Provider 能力显隐：前端通过 `window.services.getProvider(id)` 拿到 provider 的 `supportsRename`/`supportsFork` 等标记，据此显隐收藏/重命名/Fork/快照按钮；侧边栏 `getAvailableProviders()` 渲染筛选栏，缺失的 CLI 不显示
- 长会话分页：`SessionView.vue` 初始只渲染最近 50 条（`visibleMessages`），上滚到顶自动 `loadMoreMessages()`；打开搜索时切回全量渲染，保证搜索覆盖所有消息
- 会话名读取性能：大文件不全量读入，`readSessionMeta`/Codex 用尾部渐进读取（512KB→4MB→16MB）找用户消息；`scanProjects` 用目录 mtime 排序，避免逐文件 stat；超大项目（>500 会话）仅加载最近 200 个
- OpenCode 特殊性：会话 `path` 是 session ID（非文件路径），"打开源文件目录" 对其隐藏，`watchSessionFile` 因 SQLite 存储不生效（无实时刷新）
- Logo：`public/logo.svg` 为源，构建时 `vite.config.js` 的 svgToPngPlugin 用 sharp 同时输出到 `dist/logo.png` 和 `public/logo.png`（保证 dev 模式也用新图）
- 重命名/收藏：全平台走 `useSessionOverrides`（dbStorage），不再写回 JSONL；`applyOverride` 在 `loadProjectSessionsFor` 加载会话时叠加别名/收藏；Claude 的 custom-title/custom-favorite 老数据仍由 preload 读出作为基底
- 跨会话全文搜索：`services.searchSessions` 文件类 provider 用 `grepSessionFile`（大文件限首尾各 1MB）逐会话 grep，OpenCode 走 SQL LIKE；前端点击结果打开会话并把关键词经 `pendingSearch` 传给 SessionView 触发会话内高亮
- 统计：`services.getStats` 复用缓存元数据聚合会话数/大小/活跃度，OpenCode 额外 `getCostStats`（SQL SUM）
- 自动刷新：`App.vue` 每 8s 轮询 `getProjectsQuick`，签名（provider:name:sessionCount:mtime）变化才 `loadProjects`；覆盖全部 provider 含 OpenCode（DB MAX(time_updated)）
- 记住上次会话：`selectSession` 写 `anycode:lastSession` 到 dbStorage，`autoSelectLatestSession` 优先恢复
- 侧边栏宽度：`sidebarWidth`（dbStorage `anycode:sidebarWidth`），拖拽手柄 `.sidebar-resizer`，折叠用 `marginLeft: -sidebarWidth`
- 展开/折叠全部：`useCollapse` 的 `allMode`（'expand'/'collapse'）作默认 + `collapsedBlocks` 逐项例外
- uTools 主搜索框：plugin.json `recent-sessions` 功能（`mainPush`）+ `App.vue` 注册 `onMainPush`（特性检测），选中项经模块变量 `pendingMainPush` 在 onPluginEnter 打开

### 更新日志规范

更新 `CHANGELOG.md` 时，按以下格式编写，保持简洁：

```
## vX.Y.Z

1. 修复了xxx
2. 新增了xxx
3. 优化了xxx
```

每条一句话说明，不用分类标题，不用加粗或详细解释。
需要同步修改 README.md 和 CLAUDE.md，更新新功能的使用说明和技术细节，如果有新增或删除的文件也要更新文件列表。
