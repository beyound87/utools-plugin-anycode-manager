# AnyCode 会话管理器

一款 [uTools](https://www.u-tools.cn/) 插件，用于浏览、管理和查看本地 AI 编程 CLI 的会话记录，支持 **Claude Code、Codex CLI、Gemini CLI、OpenCode** 四大平台。

> 目前主要在 Windows 端测试，其他端用户如遇问题请反馈，会尽快修复。

## 多平台支持

| 平台 | 会话存储 | 恢复命令 | 重命名/Fork/收藏 |
|------|---------|---------|-----------------|
| Claude Code | `~/.claude/projects/<项目>/<uuid>.jsonl` | `claude --resume <id>` | 支持 |
| Codex CLI | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` | `codex resume <id>` | 仅浏览/删除/恢复 |
| Gemini CLI | `~/.gemini/tmp/<hash>/chats/session-*.jsonl` | `gemini --resume` | 仅浏览/删除/恢复 |
| OpenCode | `~/.local/share/opencode/opencode.db` (SQLite) | `opencode -s <id>` | 仅浏览/删除/恢复 |

- 侧边栏顶部 **provider 筛选栏**，可按平台过滤；每个项目/会话带来源角标（CC/CX/GM/OC）
- 未安装的 CLI 自动隐藏，不显示空列表
- 各平台会话消息在读取时归一化为统一格式，复用同一套渲染、搜索、导出逻辑
- 收藏、重命名、Fork、快照恢复等功能按平台能力自动显隐（当前仅 Claude Code 支持写回类操作）

## 功能特性

### 会话浏览

- 自动扫描各 CLI 的会话目录，按最后活跃时间倒序排列
- **懒加载**：启动时快速显示项目列表，展开项目时才加载完整会话详情
- **首次自动选中**：进入插件自动展开最新项目并选中最近会话
- 项目按实际工作目录路径显示，长路径自动缩短，hover 显示完整路径
- 自动识别会话名称：优先自定义标题，其次最后一条有效用户消息，再退回 AI 生成标题
- 智能跳过无效消息（工具响应、命令注入、续接样板文等）作为会话名
- **收藏/置顶**（Claude Code）：星标重要会话，收藏的会话在项目内置顶
- **子对话（Subagent）**：展开会话可查看其下的子对话列表

### 会话查看

- 双栏布局：左侧项目/会话列表，右侧会话内容查看
- **分页渲染**：长会话初始只渲染最近 50 条消息，上滚自动加载更早消息，打开搜索时切回全量
- **Markdown 渲染**：AI 回复使用 markdown-it 渲染，支持代码块、表格、列表、链接、标题等
- **代码块复制**：每个代码块右上角显示语言标签和复制按钮
- 智能消息合并：连续 AI 消息、tool_result、工具响应合并到对应 AI 消息中
- **工具调用卡片**：Read/Write/Edit/Bash 等工具调用以卡片形式展示（Codex 的 exec_command/apply_patch 等自动映射）
- **Edit Diff 视图**：Edit 工具以红绿 diff 形式展示代码变更，行内差异高亮
- **图片预览**：用户上传的图片可点击放大、复制、另存为文件
- **上下文压缩摘要**：压缩后的会话显示"上下文压缩"标记块
- **Token 统计**：每条 AI 消息底部显示模型、token 用量、缓存命中、耗时
- **会话内搜索**：关键词高亮定位、上下导航，支持区分大小写、全字匹配、正则
- **搜索快捷键**：Ctrl+F 打开、F3/Shift+F3 导航、Esc 关闭
- 兼容标准 JSONL 和美化多行 JSON 两种会话文件格式
- 实时监听：选中会话后自动监听文件变化，新消息实时刷新（OpenCode 因 SQLite 存储不支持自动刷新）

### 会话操作

- **搜索过滤**：按会话名、sessionId、工作目录模糊搜索
- **侧边栏右键菜单**：新窗口打开、终端恢复、复制恢复命令、收藏、重命名、删除（Ctrl 跳过确认）
- **新窗口打开**：将任意会话（含子对话）在独立窗口中查看
- **删除会话**：单条删除、多选批量删除
- **删除所有会话**：项目右键菜单一键删除该项目下全部会话（二次确认）
- **Fork 分支**（Claude Code）：从任意 AI 消息或压缩摘要处截断创建新会话分支
- **恢复会话**：在新终端窗口中执行对应 CLI 的恢复命令，支持 Windows / macOS / Linux
- **复制恢复命令**：一键复制对应 CLI 的完整恢复命令到剪贴板
- **打开源文件目录 / 项目目录**：定位会话文件或在文件管理器中打开项目
- **新建会话**：项目右键菜单在终端中以项目目录启动对应 CLI

### 导出

- **导出 Markdown / HTML / 长图**：基于 DOM 克隆，样式与预览一致
- **导出选项**：可自定义显示 Session ID、项目路径、统计信息、工具详情、思考过程

### 记忆管理（Claude Code）

- 项目目录下有 `memory/MEMORY.md` 时，侧边栏显示"记忆管理"入口
- 支持 Markdown 预览、在线编辑保存、页内链接导航、外部变更冲突解决
- 侧边栏过滤按钮可筛选"仅展示有记忆的项目"

### 界面交互

- 明暗主题切换（跟随系统 / 手动切换）
- 侧边栏可收起/展开，右侧抽屉式设置面板

### 设置

- **终端命令**：留空则自动使用各 CLI 默认命令（claude/codex/gemini/opencode）
- **终端程序**：预设列表（CMD / PowerShell 7 / Windows Terminal 等）+ 自定义，自定义支持 `${cwd}`、`${cwd_raw}`、`${cc_cmd}` 占位符
- **主题模式**：系统跟随 / 亮色 / 暗色

## 技术栈

- **Vue 3** + Composition API
- **Vite 6** 构建
- **markdown-it** Markdown 渲染
- **html2canvas** 长图导出
- **better-sqlite3** 读取 OpenCode 数据库（preload 层）
- **纯 CSS** 手写样式，无第三方 UI 库
- **Node.js** preload 层处理文件系统与数据库操作
- **uTools API** 插件平台集成与数据持久化

## 安装使用

1. 安装依赖：`pnpm install`
2. preload 层依赖（OpenCode 支持）：`cd public/preload && npm install`
3. 开发模式：`pnpm run dev`
4. 构建：`pnpm run build`
5. 在 uTools 开发者工具中加载 `public/plugin.json`
6. 在 uTools 中输入「AnyCode会话管理」启动插件

## 项目结构

```
├── public/
│   ├── plugin.json                 # uTools 插件配置
│   ├── logo.svg / logo.png         # 插件图标（构建时 svg→png）
│   └── preload/
│       ├── services.js             # 聚合入口，按 provider 路由所有会话操作
│       ├── package.json            # preload 层依赖（better-sqlite3）
│       └── providers/
│           ├── common.js           # 共享工具（parseJsonl、终端启动、分片读取）
│           ├── claude.js           # Claude Code provider（含 Fork/快照/记忆）
│           ├── codex.js            # Codex CLI provider
│           ├── gemini.js           # Gemini CLI provider
│           └── opencode.js         # OpenCode provider（SQLite）
├── src/
│   ├── main.js                     # Vue 入口
│   ├── main.css                    # 全局样式
│   ├── App.vue                     # 根组件（全局状态、业务逻辑协调）
│   ├── assets/
│   │   └── markdown.css            # Markdown 渲染样式
│   ├── components/
│   │   ├── Sidebar.vue             # 左侧列表、搜索、多选、provider 筛选
│   │   ├── SessionView.vue         # 右侧会话渲染、分页、搜索、导出
│   │   ├── MemoryView.vue          # 记忆管理页
│   │   ├── ExportOptionsDialog.vue # 导出选项对话框
│   │   ├── RenameDialog.vue        # 重命名弹窗
│   │   ├── DeleteConfirmDialog.vue # 删除确认弹窗
│   │   ├── ForkDialog.vue          # Fork 分支弹窗
│   │   ├── SettingsDrawer.vue      # 设置抽屉面板
│   │   ├── ImagePreview.vue        # 图片预览
│   │   ├── SnackBar.vue            # 全局提示条
│   │   └── icons/
│   │       └── index.js            # SVG 图标组件库
│   └── composables/
│       ├── useMessageParser.js     # 消息解析与合并
│       ├── useToolDisplay.js       # 工具调用展示与 diff 渲染
│       ├── useDiff.js              # LCS diff 算法
│       ├── useMarkdown.js          # Markdown 渲染
│       ├── useSearch.js            # 会话内搜索
│       ├── useExport.js            # 导出功能
│       ├── useSnackbar.js          # 全局提示状态
│       ├── useTheme.js             # 主题管理
│       └── useFormat.js            # 时间/大小/路径格式化
├── package.json
└── vite.config.js
```

