# Changelog

## v1.0.0

首个发布版本。AnyCode 会话管理器 —— 统一浏览、管理本地 AI 编程 CLI 的会话记录，支持 Claude Code、Codex CLI、Gemini CLI、OpenCode 四大平台。

### 多平台

1. 支持 Claude Code（`~/.claude/projects`）、Codex CLI（`~/.codex/sessions`）、Gemini CLI（`~/.gemini/tmp`）、OpenCode（`opencode.db` SQLite）四平台会话浏览
2. preload 层按 provider 架构组织，各 CLI 独立实现，会话消息统一归一化后复用同一套渲染/搜索/导出逻辑
3. 侧边栏 provider 筛选栏（全部/Claude/Codex/Gemini/OpenCode），项目与会话带来源角标
4. 未安装的 CLI 自动隐藏；收藏/重命名/Fork/快照恢复按平台能力自动显隐
5. 复制恢复命令、终端恢复按各 CLI 命令适配（claude --resume / codex resume / opencode -s / gemini --resume）

### 会话浏览

6. 自动扫描各 CLI 会话目录，按最后活跃时间倒序排列
7. 懒加载：启动只显示项目列表，展开项目时才加载会话详情
8. 首次进入自动展开最新项目并选中最近会话
9. 会话名智能识别：自定义标题 > 真实用户消息（尾部渐进读取，跳过工具链/续接样板）> AI 生成标题 > 会话 ID
10. 收藏/置顶（Claude Code），子对话（Subagent）展开查看

### 会话查看

11. 双栏布局，AI 回复 Markdown 渲染，代码块带语言标签和一键复制
12. 长会话分页渲染：初始最近 50 条，上滚自动加载，打开搜索时切回全量
13. 智能消息合并：连续 AI 消息、工具调用与结果配对折叠
14. 工具调用卡片（Read/Write/Edit/Bash 等；Codex 的 exec_command/apply_patch 自动映射），Edit 红绿 diff + 行内高亮
15. 图片预览、上下文压缩摘要块、Token 用量统计
16. 会话内搜索：高亮定位、上下导航，支持区分大小写/全字/正则，Ctrl+F/F3/Esc 快捷键
17. 实时监听文件变化自动刷新（OpenCode 因 SQLite 存储不支持）

### 会话操作

18. 侧边栏右键菜单：新窗口打开、终端恢复、复制恢复命令、收藏、重命名、删除
19. 单条删除 / 多选批量删除 / 项目级"删除所有会话"（二次确认）
20. Fork 分支（Claude Code）：从任意 AI 消息或压缩摘要处截断创建新会话
21. 在终端中恢复会话，跨 Windows / macOS / Linux
22. 新建会话、打开源文件目录、打开项目目录

### 导出与记忆

23. 导出 Markdown / HTML / 长图，基于 DOM 克隆，样式与预览一致，可自定义导出内容
24. 记忆管理（Claude Code）：MEMORY.md 预览、在线编辑、页内导航、外部变更冲突解决

### 界面与设置

25. 明暗主题切换（跟随系统 / 手动），侧边栏可收起，右侧抽屉设置面板
26. 终端命令留空自动用各 CLI 默认命令；终端程序预设列表（CMD/PowerShell 7/Windows Terminal 等）+ 自定义

### 性能

27. 项目扫描用目录 mtime，避免逐文件 stat（万级会话项目秒开）
28. 会话名头尾分片读取，超大文件不全量读入；超大项目仅加载最近 200 个会话
29. 大会话文件（>5MB）读取只取尾部，加快首次打开
