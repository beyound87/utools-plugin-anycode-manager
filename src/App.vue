<script setup>
import { ref, onMounted, nextTick, watch, computed } from 'vue'
import { useTheme } from './composables/useTheme'
import { useSnackbar } from './composables/useSnackbar'
import { useDisplayMessages } from './composables/useMessageParser'
import { useSessionOverrides } from './composables/useSessionOverrides'
import { IconChevronLeft, IconChevronRight } from './components/icons'
import Sidebar from './components/Sidebar.vue'
import SessionView from './components/SessionView.vue'
import MemoryView from './components/MemoryView.vue'
import RenameDialog from './components/RenameDialog.vue'
import DeleteConfirmDialog from './components/DeleteConfirmDialog.vue'
import ForkDialog from './components/ForkDialog.vue'
import ImagePreview from './components/ImagePreview.vue'
import SettingsDrawer from './components/SettingsDrawer.vue'
import StatsView from './components/StatsView.vue'
import ChatComposer from './components/ChatComposer.vue'
import SnackBar from './components/SnackBar.vue'

const { isDark, initThemeListener } = useTheme()
const { showSnackbar } = useSnackbar()
const { applyOverride, setAlias, toggleFavorite: toggleFavoriteOverride } = useSessionOverrides()

// State
const projects = ref([])
const projectsLoaded = ref(false)
const expandedProjects = ref({})
const selectedSession = ref(null)
const sessionContent = ref([])
const loading = ref(false)
// 对话状态
const chatActive = ref(false)          // 是否处于对话模式
const chatSending = ref(false)         // 当前是否有一轮进行中
const chatPermMode = ref(window.utools.dbStorage.getItem('anycode:chatPermMode') || 'plan')
const chatModel = ref('')
const chatEffort = ref('')
let chatLiveItem = null                // 流式中的 live assistant item
let chatWatchSuspended = false
// #10: 流式 delta 节流——聚合 token 后 100ms 一次性刷 Vue 响应式 + 滚动
let deltaFlushTimer = null
function scheduleDeltaFlush() {
  if (deltaFlushTimer) return
  deltaFlushTimer = setTimeout(() => {
    deltaFlushTimer = null
    sessionContent.value = [...sessionContent.value]
    nextTick(() => sessionViewRef.value?.scrollToEnd())
  }, 100)
}
const selectedMemory = ref(null)
const memoryFiles = ref([])
const memoryLoading = ref(false)
const searchQuery = ref('')
const sidebarCollapsed = ref(false)
const sidebarWidth = ref(Number(window.utools.dbStorage.getItem('anycode:sidebarWidth')) || 320)
function startResize(e) {
  e.preventDefault()
  const startX = e.clientX
  const startW = sidebarWidth.value
  const onMove = (ev) => { sidebarWidth.value = Math.max(240, Math.min(560, startW + ev.clientX - startX)) }
  const onUp = () => {
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
    document.body.style.userSelect = ''
    try { window.utools.dbStorage.setItem('anycode:sidebarWidth', sidebarWidth.value) } catch (e) {}
  }
  document.body.style.userSelect = 'none'
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}
const showSettings = ref(false)
const showStats = ref(false)
const terminalCommand = ref(window.utools.dbStorage.getItem('terminalCommand') || '')
const terminalApp = ref(window.utools.dbStorage.getItem('terminalApp') || 'auto')
const isStandaloneWindow = ref(false)
const sessionBroadcast = new BroadcastChannel('cc-session')

// 全局全文搜索
const globalSearch = ref({ active: false, query: '', results: [], loading: false })
let globalSearchSeq = 0
function runGlobalSearch(query) {
  const q = (query || '').trim()
  globalSearch.value.query = query
  if (!q) { globalSearch.value.results = []; globalSearch.value.loading = false; return }
  const seq = ++globalSearchSeq
  globalSearch.value.loading = true
  setTimeout(() => {
    let results = []
    try { results = window.services.searchSessions(q, { limit: 100 }) || [] } catch (e) { console.error(e) }
    if (seq !== globalSearchSeq) return // 有更新的搜索，丢弃旧结果
    globalSearch.value.results = results
    globalSearch.value.loading = false
  }, 0)
}
function setGlobalSearchActive(active) {
  globalSearch.value.active = active
  if (!active) { globalSearch.value.query = ''; globalSearch.value.results = [] }
}
// 点击搜索结果：打开会话并触发会话内高亮
function openSearchResult(result) {
  // 若该会话已在加载的项目里，用真实对象（含 subagents/size/timestamp）
  let session = null
  for (const p of projects.value) {
    const s = p.sessions?.find(s => s.path === result.sessionPath)
    if (s) { session = s; break }
  }
  if (!session) {
    session = applyOverride({
      provider: result.provider, path: result.sessionPath, sessionId: result.sessionId,
      name: result.name, cwd: result.cwd, isFavorite: false, subagents: []
    })
  }
  pendingInSearch.value = globalSearch.value.query
  selectSession(session, true)
}
const pendingInSearch = ref('')

// uTools 主搜索框推送：最近会话（取最近几个项目的会话，按时间排，关键词过滤）
let pendingMainPush = null
function buildMainPushItems(searchWord) {
  const q = (searchWord || '').toLowerCase()
  let quick = []
  try { quick = window.services.getProjectsQuick() } catch (e) { return [] }
  const recent = []
  for (const p of quick.slice(0, 6)) {
    try {
      const { sessions } = window.services.loadProjectSessions(p.path, p.provider, p)
      for (const s of (sessions || [])) recent.push({ ...applyOverride(s), projectName: p.displayName })
    } catch (e) {}
    if (recent.length > 80) break
  }
  recent.sort((a, b) => new Date(b.modifiedTime) - new Date(a.modifiedTime))
  return recent
    .filter(s => !q || (s.name || '').toLowerCase().includes(q) || (s.cwd || '').toLowerCase().includes(q))
    .slice(0, 12)
    .map(s => ({
      text: s.name || s.sessionId || '会话',
      title: s.name || s.sessionId || '会话',
      description: s.projectName || s.cwd || '',
      icon: 'logo.png',
      provider: s.provider, sessionPath: s.path, sessionId: s.sessionId, cwd: s.cwd
    }))
}

// Computed
const displayMessages = useDisplayMessages(sessionContent)
const sessionSupportsChat = computed(() => {
  const p = selectedSession.value?.provider
  return p ? window.services.getProvider(p)?.supportsChat : false
})

// 当前会话中 toolUseId → subagent session 的映射，用于在工具调用卡片上显示"查看"链接
const agentToolUseMap = computed(() => {
  if (!selectedSession.value || selectedSession.value.isSubagent) return {}
  const subagents = selectedSession.value.subagents
  if (!subagents?.length) return {}
  const agentById = {}
  for (const sub of subagents) agentById[sub.agentId] = sub
  const map = {}
  for (const item of sessionContent.value) {
    const agentId = item.toolUseResult?.agentId
    if (!agentId || !agentById[agentId]) continue
    const content = item.message?.content
    if (!Array.isArray(content)) continue
    for (const block of content) {
      if (block.type === 'tool_result' && block.tool_use_id) {
        map[block.tool_use_id] = agentById[agentId]
        break
      }
    }
  }
  return map
})

// Refs
const sessionViewRef = ref(null)
const sidebarRef = ref(null)

// 自动刷新：定时轮询 getProjectsQuick（覆盖全部 provider 含 OpenCode），仅签名变化时静默刷新
let autoRefreshTimer = null
let lastProjectsSig = ''
// 只看项目/会话数量，不含 mtime：活动会话被写入（mtime 变、数量不变）由 watchSessionFile 处理，
// 轮询只在新增/删除会话或项目时刷新，避免每 8s 全量重载已展开项目
function projectsSignature(list) {
  return list.map(p => `${p.provider}:${p.name}:${p.sessionCount}`).join('|')
}
function startAutoRefresh() {
  stopAutoRefresh()
  autoRefreshTimer = setInterval(() => {
    try {
      const quick = window.services.getProjectsQuick()
      const sig = projectsSignature(quick)
      if (lastProjectsSig && sig !== lastProjectsSig) loadProjects()
      lastProjectsSig = sig
    } catch (e) {}
  }, 8000)
}
function stopAutoRefresh() {
  if (autoRefreshTimer) { clearInterval(autoRefreshTimer); autoRefreshTimer = null }
}

// 键盘：上下键切换会话，Ctrl+K 快速全文搜索
function onGlobalKey(e) {
  if (isStandaloneWindow.value) return
  const t = e.target
  const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
  if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
    e.preventDefault()
    setGlobalSearchActive(true)
    nextTick(() => { document.querySelector('.search-box .search-input')?.focus() })
    return
  }
  if (typing) return
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    const flat = sidebarRef.value?.flatVisibleSessions?.() || []
    if (!flat.length) return
    e.preventDefault()
    const curPath = selectedSession.value?.path
    let idx = flat.findIndex(s => s.path === curPath)
    if (idx < 0) idx = e.key === 'ArrowDown' ? -1 : flat.length
    let next = e.key === 'ArrowDown' ? idx + 1 : idx - 1
    next = Math.max(0, Math.min(flat.length - 1, next))
    if (flat[next]) {
      selectSession(flat[next])
      nextTick(() => document.querySelector('.session-item.selected, .subagent-item.selected')?.scrollIntoView({ block: 'nearest' }))
    }
  }
}

// Dialog state
const renameDialog = ref({ show: false, session: null })
const deleteConfirm = ref({ show: false, session: null, showHint: true })
const batchDeleteConfirm = ref({ show: false, paths: [] })
const projectDeleteConfirm = ref({ show: false, project: null })
const forkDialog = ref({ show: false, item: null })
const forkResumeConfirm = ref({ show: false, sessionId: null, cwd: null })
const imagePreview = ref({ show: false, src: '', mediaType: '' })

// Project/session operations
function autoSelectLatestSession() {
  if (selectedSession.value) return
  // 优先恢复上次打开的会话（其项目仍存在时）
  let last = null
  try { last = window.utools.dbStorage.getItem('anycode:lastSession') } catch (e) {}
  if (last && last.path) {
    const proj = projects.value.find(p => p.provider === (last.provider || 'claude') && (p.cwd === last.cwd || last.path.startsWith(p.path)))
    if (proj) {
      expandedProjects.value[proj.name] = true
      loadProjectSessionsFor(proj.name)
      setTimeout(() => {
        const p = projects.value.find(x => x.name === proj.name)
        const s = p?.sessions?.find(s => s.path === last.path)
        if (s) { selectSession(s); return }
        selectNewestSession()
      }, 50)
      return
    }
  }
  selectNewestSession()
}

function selectNewestSession() {
  if (selectedSession.value) return
  const latest = projects.value[0]
  if (!latest) return
  expandedProjects.value[latest.name] = true
  loadProjectSessionsFor(latest.name)
  setTimeout(() => {
    const proj = projects.value.find(p => p.name === latest.name)
    if (proj?.sessions?.length > 0) {
      selectSession(proj.sessions[0])
    }
  }, 50)
}

// force=true 时清空旧 sessions（手动刷新，展示加载效果）；默认静默刷新不闪烁
function loadProjects(force = false) {
  const prevMap = {}
  for (const p of projects.value) {
    prevMap[p.name] = p
  }
  try {
    const quickProjects = window.services.getProjectsQuick()
    lastProjectsSig = projectsSignature(quickProjects)
    projects.value = quickProjects.map(p => {
      const prev = prevMap[p.name]
      const keep = !force && prev?.sessionsLoaded
      return {
        ...p,
        sessions: keep ? prev.sessions : [],
        sessionsLoaded: keep,
        sessionsLoading: false
      }
    })
  } catch (error) {
    console.error('Failed to load projects:', error)
    showSnackbar('加载项目失败', 'error')
  }
  projectsLoaded.value = true
  const skipSessionLoad = sidebarRef.value?.filterOnlyMemory
  for (const p of projects.value) {
    if (!skipSessionLoad && (p.sessionsLoaded || expandedProjects.value[p.name])) {
      loadProjectSessionsFor(p.name)
    }
  }
}

// 异步懒加载某个项目的完整会话列表
function loadProjectSessionsFor(name) {
  const idx = projects.value.findIndex(p => p.name === name)
  if (idx < 0) return
  if (projects.value[idx].sessionsLoading) return
  projects.value = projects.value.map((p, i) =>
    i === idx ? { ...p, sessionsLoading: true } : p
  )
  setTimeout(() => {
    const currentIdx = projects.value.findIndex(p => p.name === name)
    if (currentIdx < 0) return
    const proj = projects.value[currentIdx]
    const result = window.services.loadProjectSessions(proj.path, proj.provider, proj)
    const sessions = (result.sessions || []).map(applyOverride)
    projects.value = projects.value.map((p, i) =>
      i === currentIdx ? { ...p, sessions, sessionsLoaded: true, sessionsLoading: false } : p
    )
    // 更新选中会话名称
    if (selectedSession.value) {
      const s = sessions.find(s => s.path === selectedSession.value.path)
      if (s) selectedSession.value = { ...selectedSession.value, name: s.name }
    }
  }, 0)
}

function openProjectDir(project) {
  const cwd = project.cwd || project.sessions[0]?.cwd
  if (cwd) window.utools.shellOpenPath(cwd)
}

function toggleProject(name, skipLoad = false) {
  expandedProjects.value[name] = !expandedProjects.value[name]
  if (expandedProjects.value[name] && !skipLoad) {
    const project = projects.value.find(p => p.name === name)
    if (project && !project.sessionsLoaded && !project.sessionsLoading) {
      loadProjectSessionsFor(name)
    }
  }
}

function onFilterMemoryChange(val) {
  if (val) {
    // 开启仅记忆过滤：自动展开有记忆但未展开的项目（不触发会话加载）
    for (const p of projects.value) {
      if (p.hasMemory && !expandedProjects.value[p.name]) {
        expandedProjects.value[p.name] = true
      }
    }
  } else {
    // 关闭过滤：为已展开但未加载会话的项目触发加载
    for (const p of projects.value) {
      if (expandedProjects.value[p.name] && !p.sessionsLoaded && !p.sessionsLoading) {
        loadProjectSessionsFor(p.name)
      }
    }
  }
}

function toggleAllProjects() {
  const expand = !projects.value.every(p => expandedProjects.value[p.name])
  for (const p of projects.value) {
    expandedProjects.value[p.name] = expand
    if (expand && !p.sessionsLoaded && !p.sessionsLoading) {
      loadProjectSessionsFor(p.name)
    }
  }
}

// 搜索时自动加载所有未加载项目的会话
watch(searchQuery, (q) => {
  if (q && q.trim()) {
    for (const p of projects.value) {
      if (!p.sessionsLoaded && !p.sessionsLoading) {
        loadProjectSessionsFor(p.name)
      }
    }
  }
})

function loadSessionContent(path, autoScroll = false) {
  const view = sessionViewRef.value
  const wasAtBottom = autoScroll && view?.isScrolledToBottom()
  try {
    const provider = selectedSession.value?.provider
    sessionContent.value = window.services.readSessionFile(path, provider)
  } catch (error) {
    console.error('Failed to load session:', error)
  }
  if (wasAtBottom) {
    nextTick(() => view?.scrollToEnd())
  }
}

function selectMemory(project) {
  selectedMemory.value = project
  selectedSession.value = null
  sessionContent.value = []
  memoryLoading.value = true
  const result = window.services.getMemoryFiles(project.path)
  memoryLoading.value = false
  memoryFiles.value = result.success ? result.files : []
}

function reloadMemoryFiles() {
  if (!selectedMemory.value) return
  const result = window.services.getMemoryFiles(selectedMemory.value.path)
  memoryFiles.value = result.success ? result.files : []
}

function onMemoryCleared() {
  const name = selectedMemory.value?.name
  selectedMemory.value = null
  memoryFiles.value = []
  const p = projects.value.find(p => p.name === name)
  if (p) { p.hasMemory = false; p.memorySize = 0; p.memoryFileCount = 0 }
}

// 记忆文件变化时同步更新侧边栏的大小/数量显示
watch(memoryFiles, (files) => {
  if (!selectedMemory.value) return
  const p = projects.value.find(p => p.name === selectedMemory.value.name)
  if (!p) return
  p.memoryFileCount = files.length
  p.memorySize = files.reduce((sum, f) => sum + new Blob([f.content || '']).size, 0)
  p.hasMemory = files.length > 0
}, { deep: true })

function selectSession(session, fromSearch = false) {
  // 切会话时停止当前对话进程
  if (chatActive.value) stopChatSession()
  selectedMemory.value = null
  memoryFiles.value = []
  if (!fromSearch) pendingInSearch.value = ''
  selectedSession.value = session
  // 记住上次打开的会话
  if (!session.isSubagent && !isStandaloneWindow.value) {
    try { window.utools.dbStorage.setItem('anycode:lastSession', { provider: session.provider, path: session.path, sessionId: session.sessionId, name: session.name, cwd: session.cwd }) } catch (e) {}
  }
  if (session.isSubagent) {
    sidebarRef.value?.expandSubagents(session.parentSessionPath)
  }
  loading.value = true
  loadSessionContent(session.path)
  loading.value = false
  nextTick(() => sessionViewRef.value?.scrollToEnd())
  window.services.watchSessionFile(session.path, () => {
    if (selectedSession.value?.path === session.path) {
      loadSessionContent(session.path, true)
    }
    loadProjects()
    if (selectedSession.value) {
      for (const p of projects.value) {
        const s = p.sessions.find(s => s.path === selectedSession.value.path)
        if (s) { selectedSession.value = { ...selectedSession.value, name: s.name }; break }
      }
    }
  })
}

// ============ 对话功能 ============

function toggleChat() {
  if (chatActive.value) { stopChatSession(); return }
  const s = selectedSession.value
  if (!s?.sessionId || s.isSubagent) return
  const p = s.provider ? window.services.getProvider(s.provider) : null
  if (!p?.supportsChat) { showSnackbar('该平台暂不支持对话', 'error'); return }
  chatActive.value = true
  // 挂起文件监听（流式期间由 onChatEvent 驱动，避免 watch 触发整表替换冲掉 live item）
  chatWatchSuspended = true
  window.services.unwatchSessionFile()
  const result = window.services.startChat({
    provider: s.provider, sessionId: s.sessionId, cwd: s.cwd || '',
    command: terminalCommand.value || undefined,
    permissionMode: chatPermMode.value, model: chatModel.value || undefined, effort: chatEffort.value || undefined
  }, onChatEvent)
  if (!result.success) { showSnackbar('启动对话失败: ' + result.error, 'error'); stopChatSession() }
}

function stopChatSession() {
  window.services.stopChat()
  chatActive.value = false
  chatSending.value = false
  chatLiveItem = null
  chatWatchSuspended = false
  // 恢复文件监听 + 重载对齐落盘数据
  if (selectedSession.value) {
    loadSessionContent(selectedSession.value.path)
    window.services.watchSessionFile(selectedSession.value.path, () => {
      if (selectedSession.value) loadSessionContent(selectedSession.value.path, true)
      loadProjects()
    })
  }
}

function sendChat(msg) {
  if (!chatActive.value || chatSending.value) return
  // push 用户消息到 sessionContent（实时显示）
  const userItem = {
    type: 'user', message: { role: 'user', content: [] },
    sessionId: selectedSession.value?.sessionId, cwd: selectedSession.value?.cwd,
    timestamp: new Date().toISOString(), uuid: 'chat-user-' + Date.now()
  }
  if (msg.text) userItem.message.content.push({ type: 'text', text: msg.text })
  for (const img of (msg.images || [])) {
    userItem.message.content.push({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } })
  }
  // 附件：以 @ 路径注入文本（CLI 识别 @文件路径 自动读取）
  if (msg.attachments?.length) {
    const paths = msg.attachments.map(a => '@' + a).join(' ')
    const textBlock = userItem.message.content.find(b => b.type === 'text')
    if (textBlock) textBlock.text = paths + '\n' + textBlock.text
    else userItem.message.content.unshift({ type: 'text', text: paths })
  }
  sessionContent.value = [...sessionContent.value, userItem]
  nextTick(() => sessionViewRef.value?.scrollToEnd())
  chatSending.value = true
  const s = selectedSession.value
  // 附件路径注入文本（#3 fix: 传给 CLI 而非仅 UI 展示）
  let chatText = msg.text || ''
  if (msg.attachments?.length) chatText = msg.attachments.map(a => '@"' + a + '"').join(' ') + '\n' + chatText
  const result = window.services.sendChatMessage({ text: chatText, images: msg.images }, {
    provider: s?.provider, sessionId: s?.sessionId, cwd: s?.cwd || '',
    command: terminalCommand.value || undefined, model: chatModel.value || undefined,
    effort: chatEffort.value || undefined,
    sandbox: chatPermMode.value === 'bypassPermissions' ? 'full' : undefined,
    approvalMode: chatPermMode.value === 'plan' ? 'plan' : chatPermMode.value === 'bypassPermissions' ? 'yolo' : 'default'
  })
  if (!result.success) { showSnackbar('发送失败: ' + result.error, 'error'); chatSending.value = false }
}

function onChatEvent(ev) {
  if (ev.type === 'assistant') {
    // 完整 assistant 消息（替换 live item）
    const item = {
      type: 'assistant', message: ev.message, sessionId: ev.session_id,
      cwd: selectedSession.value?.cwd, timestamp: new Date().toISOString(), uuid: ev.uuid || 'chat-a-' + Date.now(),
      _stats: ev.message?.usage ? {
        input_tokens: ev.message.usage.input_tokens || 0,
        output_tokens: ev.message.usage.output_tokens || 0,
        model: ev.message.model || '', durationMs: 0
      } : undefined
    }
    // 替换 live item 或追加
    if (chatLiveItem) {
      const idx = sessionContent.value.indexOf(chatLiveItem)
      if (idx >= 0) sessionContent.value[idx] = item
      else sessionContent.value = [...sessionContent.value, item]
      chatLiveItem = null
    } else {
      sessionContent.value = [...sessionContent.value, item]
    }
    nextTick(() => sessionViewRef.value?.scrollToEnd())
  } else if (ev.type === 'stream_event' && ev.event) {
    // 打字机增量
    const se = ev.event
    if (se.type === 'content_block_delta') {
      if (!chatLiveItem) {
        chatLiveItem = {
          type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: '' }] },
          sessionId: ev.session_id, cwd: selectedSession.value?.cwd,
          timestamp: new Date().toISOString(), uuid: 'chat-live-' + Date.now()
        }
        sessionContent.value = [...sessionContent.value, chatLiveItem]
      }
      const delta = se.delta
      if (delta?.type === 'text_delta' && delta.text) {
        const blocks = chatLiveItem.message.content
        const last = blocks[blocks.length - 1]
        if (last?.type === 'text') last.text += delta.text
        else blocks.push({ type: 'text', text: delta.text })
      } else if (delta?.type === 'thinking_delta' && delta.thinking) {
        const blocks = chatLiveItem.message.content
        const last = blocks[blocks.length - 1]
        if (last?.type === 'thinking') last.thinking += delta.thinking
        else blocks.push({ type: 'thinking', thinking: delta.thinking })
      }
      // #10 fix: 节流 Vue 响应式刷新 + 滚动，避免每 token 全量数组展开 + layout
      scheduleDeltaFlush()
    } else if (se.type === 'content_block_start' && se.content_block?.type === 'tool_use') {
      // 工具调用开始
      if (!chatLiveItem) {
        chatLiveItem = {
          type: 'assistant', message: { role: 'assistant', content: [] },
          sessionId: ev.session_id, cwd: selectedSession.value?.cwd,
          timestamp: new Date().toISOString(), uuid: 'chat-live-' + Date.now()
        }
        sessionContent.value = [...sessionContent.value, chatLiveItem]
      }
      chatLiveItem.message.content.push({
        type: 'tool_use', name: se.content_block.name || '',
        id: se.content_block.id || '', input: {}
      })
      sessionContent.value = [...sessionContent.value]
    }
  } else if (ev.type === 'user' && ev.message?.content?.some(b => b.type === 'tool_result')) {
    // 工具执行结果（CLI 自动执行后回传）
    sessionContent.value = [...sessionContent.value, {
      type: 'user', message: ev.message, sessionId: ev.session_id,
      cwd: selectedSession.value?.cwd, timestamp: ev.timestamp || new Date().toISOString(),
      uuid: ev.uuid || 'chat-tr-' + Date.now()
    }]
    chatLiveItem = null // 下一个 assistant 是新消息
    nextTick(() => sessionViewRef.value?.scrollToEnd())
  } else if (ev.type === 'result') {
    chatSending.value = false
    chatLiveItem = null
  } else if (ev.type === '_exit' || ev.type === '_error') {
    chatSending.value = false
    chatLiveItem = null
    if (ev.type === '_error') showSnackbar('对话进程出错: ' + (ev.error || ''), 'error')
    if (chatActive.value) stopChatSession()
  }
}

function setChatPermMode(mode) {
  chatPermMode.value = mode
  try { window.utools.dbStorage.setItem('anycode:chatPermMode', mode) } catch (e) {}
}

const chatCwd = computed(() => selectedSession.value?.cwd || '')

function startNewChat() {
  const p = selectedSession.value?.provider || 'claude'
  const cwd = chatCwd.value || ''
  stopChatSession()
  sessionContent.value = []
  chatActive.value = true
  chatWatchSuspended = true
  window.services.unwatchSessionFile()
  const result = window.services.newChatSession({
    provider: p, cwd, command: terminalCommand.value || undefined,
    permissionMode: chatPermMode.value, model: chatModel.value || undefined, effort: chatEffort.value || undefined
  }, onChatEvent)
  if (!result.success) { showSnackbar('新建会话失败: ' + result.error, 'error'); stopChatSession() }
}

function changeChatCwd(newCwd) {
  if (selectedSession.value) selectedSession.value = { ...selectedSession.value, cwd: newCwd }
  if (chatActive.value) {
    // 重启对话进程在新目录
    stopChatSession()
    toggleChat()
  }
}

function refresh() {
  loadProjects(true)
  showSnackbar('已刷新')
}

// Delete
function handleDelete(session, event) {
  if (event?.ctrlKey || event?.metaKey) {
    doDelete(session)
  } else {
    deleteConfirm.value = { show: true, session, showHint: !!event }
  }
}

function doDelete(session) {
  if (!session) session = deleteConfirm.value.session
  const result = window.services.deleteSession(session.path, session.provider)
  if (result.success) {
    showSnackbar('会话已删除')
    if (selectedSession.value?.path === session.path ||
        selectedSession.value?.parentSessionPath === session.path) {
      window.services.unwatchSessionFile()
      selectedSession.value = null
      sessionContent.value = []
      if (isStandaloneWindow.value) {
        sessionBroadcast.postMessage({ action: 'delete', path: session.path })
        window.close()
        return
      }
    }
    sessionBroadcast.postMessage({ action: 'delete', path: session.path })
    loadProjects()
  } else {
    showSnackbar(result.error || '删除失败', 'error')
  }
  deleteConfirm.value.show = false
}

// Batch delete
function handleBatchDelete(paths) {
  batchDeleteConfirm.value = { show: true, paths }
}

function doBatchDelete() {
  const paths = batchDeleteConfirm.value.paths
  const result = window.services.batchDeleteSessions(paths)
  if (result.deleted > 0) {
    showSnackbar(`已删除 ${result.deleted} 个会话`)
    if (selectedSession.value && (paths.includes(selectedSession.value.path) ||
        paths.includes(selectedSession.value.parentSessionPath))) {
      window.services.unwatchSessionFile()
      selectedSession.value = null
      sessionContent.value = []
    }
    loadProjects()
    sidebarRef.value?.clearMultiSelect()
  }
  if (result.errors?.length) showSnackbar(`${result.errors.length} 个失败`, 'error')
  batchDeleteConfirm.value.show = false
}

// Delete project sessions
function handleDeleteProjectSessions(project) {
  projectDeleteConfirm.value = { show: true, project }
}

function doDeleteProjectSessions() {
  const project = projectDeleteConfirm.value.project
  if (!project) return
  const result = window.services.deleteProjectSessions(project.path, project.provider)
  if (result.deleted > 0) {
    showSnackbar(`已删除 ${result.deleted} 个会话`)
    if (selectedSession.value) {
      const p = projects.value.find(p => p.name === project.name)
      if (p?.sessions?.some(s => s.path === selectedSession.value.path)) {
        window.services.unwatchSessionFile()
        selectedSession.value = null
        sessionContent.value = []
      }
    }
    loadProjects()
  }
  if (result.errors?.length) showSnackbar(`${result.errors.length} 个失败`, 'error')
  projectDeleteConfirm.value.show = false
}

// Rename
function startRename(session) {
  renameDialog.value = { show: true, session }
}

function confirmRename(newName) {
  const session = renameDialog.value.session
  // 全平台统一走 dbStorage 别名，不再改文件
  setAlias(session, newName)
  applyOverrideToLoaded(session, { name: newName })
  if (selectedSession.value && sameSession(selectedSession.value, session)) {
    selectedSession.value = { ...selectedSession.value, name: newName }
  }
  showSnackbar('已重命名')
  renameDialog.value.show = false
}

// 把覆盖就地应用到已加载的会话列表和选中会话，避免整表重载
function sameSession(a, b) {
  return a && b && (a.provider || 'claude') === (b.provider || 'claude') && (a.sessionId || a.path) === (b.sessionId || b.path)
}
function applyOverrideToLoaded(session, patch) {
  for (const p of projects.value) {
    if (!p.sessions?.length) continue
    const s = p.sessions.find(s => sameSession(s, session))
    if (s) Object.assign(s, patch)
  }
}

// Fork
function startFork(item) {
  forkDialog.value = { show: true, item, isSummary: false }
}

function startSummaryFork(item) {
  forkDialog.value = { show: true, item, isSummary: true }
}

function confirmFork(name) {
  const { item, isSummary } = forkDialog.value
  const cwd = selectedSession.value?.cwd || ''
  let result
  if (isSummary) {
    result = window.services.forkSummarySession(selectedSession.value.path, item.uuid, name, selectedSession.value.provider)
  } else {
    const cutoffUuid = item.lastUuid || item.uuid
    result = window.services.forkSession(selectedSession.value.path, cutoffUuid, name, selectedSession.value.provider)
  }
  if (result.success) {
    loadProjects()
    forkResumeConfirm.value = { show: true, sessionId: result.sessionId, cwd }
  } else {
    showSnackbar(result.error || 'Fork 失败', 'error')
  }
  forkDialog.value.show = false
}

async function resumeForkedSession() {
  const { sessionId, cwd } = forkResumeConfirm.value
  forkResumeConfirm.value.show = false
  try {
    await window.services.resumeSession(sessionId, cwd, terminalCommand.value, terminalApp.value, selectedSession.value?.provider)
    showSnackbar('已在终端中打开')
  } catch (e) {
    showSnackbar('打开终端失败：' + (e.message || e), 'error')
  }
}

// New session in terminal
async function newSessionForProject(project) {
  const cwd = project.cwd || project.sessions?.[0]?.cwd || ''
  try {
    await window.services.newSession(cwd, terminalCommand.value, terminalApp.value, project.provider)
    showSnackbar('已在终端中打开')
  } catch (e) {
    showSnackbar('打开终端失败：' + (e.message || e), 'error')
  }
}

// Resume
async function resumeSession(session) {
  const s = session || selectedSession.value
  if (!s?.sessionId) return
  try {
    await window.services.resumeSession(s.sessionId, s.cwd || '', terminalCommand.value, terminalApp.value, s.provider, s.path)
    showSnackbar('已在终端中打开')
  } catch (e) {
    showSnackbar('打开终端失败：' + (e.message || e), 'error')
  }
}

// Toggle favorite from SessionView
function toggleFavoriteFromView(session) {
  if (!session) return
  const nextFav = toggleFavoriteOverride(session)
  applyOverrideToLoaded(session, { isFavorite: nextFav })
  if (selectedSession.value && sameSession(selectedSession.value, session)) {
    selectedSession.value = { ...selectedSession.value, isFavorite: nextFav }
  }
}

// Image preview
function openImagePreview(src, mediaType) {
  imagePreview.value = { show: true, src, mediaType }
}

// 在新窗口中打开会话
// 通过 localStorage 传递会话数据，子窗口 onMounted 时读取
// 在新窗口中打开会话
// dev 模式直接传 vite 地址，prod 模式用相对路径 index.html
// 通过 localStorage 传递会话数据，子窗口 onMounted 时读取
function openSessionWindow(session) {
  if (typeof window.utools?.createBrowserWindow !== 'function') {
    showSnackbar('当前 uTools 版本不支持多窗口', 'error')
    return
  }
  const isDev = window.location.protocol !== 'file:'
  try {
    localStorage.setItem('__cc_pending_session', JSON.stringify(session))
    // dev: window.html 内含 location.replace 跳转到 vite，show:true 立即显示避免时序问题
    // prod: index.html 直接加载完整 app，callback 里再 show 避免白屏闪烁
    const win = window.utools.createBrowserWindow(isDev ? 'window.html' : 'index.html', {
      title: session.name || '会话详情',
      width: 960,
      height: 700,
      minWidth: 600,
      minHeight: 400,
      show: isDev,
      webPreferences: { preload: 'preload/services.js' }
    }, () => {
      if (!isDev) win.show()
    })
  } catch (e) {
    localStorage.removeItem('__cc_pending_session')
    showSnackbar('打开失败: ' + (e?.message || String(e)), 'error')
  }
}

// Lifecycle
onMounted(() => {
  const windowType = window.utools.getWindowType?.() || 'main'
  if (windowType === 'browser') {
    isStandaloneWindow.value = true
    initThemeListener()
    const stored = localStorage.getItem('__cc_pending_session')
    if (stored) {
      localStorage.removeItem('__cc_pending_session')
      try {
        const session = JSON.parse(stored)
        selectSession(session)
        nextTick(() => { document.title = session.name || '会话详情' })
      } catch (e) {}
    }
    sessionBroadcast.onmessage = ({ data }) => {
      if (data.action === 'delete' && (
        selectedSession.value?.path === data.path ||
        selectedSession.value?.parentSessionPath === data.path
      )) window.close()
    }
    return
  }
  window.utools.onPluginEnter(({ code }) => {
    if (code === 'sessions') {
      loadProjects()
      autoSelectLatestSession()
      startAutoRefresh()
    } else if (code === 'recent-sessions') {
      loadProjects()
      startAutoRefresh()
      const t = pendingMainPush
      pendingMainPush = null
      if (t && t.sessionPath) {
        selectSession(applyOverride({
          provider: t.provider, path: t.sessionPath, sessionId: t.sessionId,
          name: t.title, cwd: t.cwd, isFavorite: false, subagents: []
        }))
      } else {
        autoSelectLatestSession()
      }
    }
  })
  // 主搜索框推送最近会话（特性检测，部分环境无 onMainPush）
  if (typeof window.utools.onMainPush === 'function') {
    try {
      window.utools.onMainPush(
        ({ searchWord }) => buildMainPushItems(searchWord),
        (action) => { pendingMainPush = action.option || null; return true }
      )
    } catch (e) { console.warn('onMainPush 注册失败:', e) }
  }
  window.utools.onPluginOut(() => {
    window.services.unwatchSessionFile()
    if (chatActive.value) stopChatSession()
    stopAutoRefresh()
  })
  document.addEventListener('keydown', onGlobalKey)
  sessionBroadcast.onmessage = ({ data }) => {
    if (data.action === 'delete') {
      if (selectedSession.value?.path === data.path ||
          selectedSession.value?.parentSessionPath === data.path) {
        window.services.unwatchSessionFile()
        selectedSession.value = null
        sessionContent.value = []
      }
      loadProjects()
    }
  }
  initThemeListener()
})
</script>

<template>
  <div class="app" :class="{ dark: isDark }">
    <Sidebar
      v-if="!isStandaloneWindow"
      ref="sidebarRef"
      :style="{ width: sidebarWidth + 'px', minWidth: sidebarWidth + 'px', marginLeft: sidebarCollapsed ? (-sidebarWidth + 'px') : '0' }"
      :projects="projects"
      :expanded-projects="expandedProjects"
      :selected-session="selectedSession"
      :selected-memory="selectedMemory"
      :search-query="searchQuery"
      :collapsed="sidebarCollapsed"
      :projects-loaded="projectsLoaded"
      :global-search="globalSearch"
      @update:search-query="searchQuery = $event"
      @global-search="runGlobalSearch"
      @global-search-active="setGlobalSearchActive"
      @open-search-result="openSearchResult"
      @toggle-project="toggleProject"
      @toggle-all="toggleAllProjects"
      @select-session="selectSession"
      @rename-session="startRename"
      @toggle-favorite="toggleFavoriteFromView"
      @delete-session="handleDelete"
      @batch-delete="handleBatchDelete"
      @delete-project-sessions="handleDeleteProjectSessions"
      @open-project-dir="openProjectDir"
      @new-session="newSessionForProject"
      @select-memory="selectMemory"
      @refresh="refresh"
      @open-settings="showSettings = true"
      @open-stats="showStats = true"
      @open-session-window="openSessionWindow"
      @resume-session="resumeSession"
      @filter-memory-change="onFilterMemoryChange"
    />

    <!-- 侧边栏拖拽调宽手柄 -->
    <div v-if="!isStandaloneWindow && !sidebarCollapsed" class="sidebar-resizer" @mousedown="startResize"></div>

    <!-- 侧边栏收起/展开按钮 -->
    <button v-if="!isStandaloneWindow" class="sidebar-toggle" @click="sidebarCollapsed = !sidebarCollapsed" :title="sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'">
      <IconChevronLeft v-if="!sidebarCollapsed" />
      <IconChevronRight v-else />
    </button>

    <!-- 右侧内容区 -->
    <main class="content">
      <MemoryView
        v-if="selectedMemory"
        :project="selectedMemory"
        :files="memoryFiles"
        :loading="memoryLoading"
        @reload="reloadMemoryFiles"
        @cleared="onMemoryCleared"
      />
      <SessionView
        v-else
        ref="sessionViewRef"
        :session="selectedSession"
        :display-messages="displayMessages"
        :loading="loading"
        :agent-tool-use-map="agentToolUseMap"
        :standalone="isStandaloneWindow"
        :pending-search="pendingInSearch"
        @fork="startFork"
        @fork-summary="startSummaryFork"
        @resume="resumeSession"
        @preview-image="openImagePreview"
        @rename="startRename"
        @delete="handleDelete"
        @toggle-favorite="toggleFavoriteFromView"
        @select-session="selectSession"
        @open-session-window="openSessionWindow"
      />
      <ChatComposer
        v-if="selectedSession && !selectedSession.isSubagent && sessionSupportsChat"
        :active="chatActive"
        :sending="chatSending"
        :perm-mode="chatPermMode"
        :provider="selectedSession.provider"
        :cwd="chatCwd"
        :model="chatModel"
        :effort="chatEffort"
        @toggle-chat="toggleChat"
        @stop-chat="stopChatSession"
        @send="sendChat"
        @update:perm-mode="setChatPermMode"
        @update:model="chatModel = $event"
        @update:effort="chatEffort = $event"
        @new-chat="startNewChat"
        @change-cwd="changeChatCwd"
      />
    </main>

    <!-- Dialogs -->
    <RenameDialog
      :show="renameDialog.show"
      :session="renameDialog.session"
      @confirm="confirmRename"
      @cancel="renameDialog.show = false"
    />

    <DeleteConfirmDialog
      :show="deleteConfirm.show"
      :session="deleteConfirm.session"
      :show-hint="deleteConfirm.showHint"
      @confirm="doDelete(deleteConfirm.session)"
      @cancel="deleteConfirm.show = false"
    />

    <DeleteConfirmDialog
      :show="batchDeleteConfirm.show"
      :session="{ name: batchDeleteConfirm.paths.length + ' 个会话' }"
      :show-hint="false"
      @confirm="doBatchDelete"
      @cancel="batchDeleteConfirm.show = false"
    />

    <DeleteConfirmDialog
      :show="projectDeleteConfirm.show"
      :session="{ name: (projectDeleteConfirm.project?.displayName || '') + ' 的所有会话 (' + (projectDeleteConfirm.project?.sessionCount || 0) + ' 个)' }"
      :show-hint="false"
      @confirm="doDeleteProjectSessions"
      @cancel="projectDeleteConfirm.show = false"
    />

    <ForkDialog
      :show="forkDialog.show"
      :desc="forkDialog.isSummary ? '仅保留此条上下文压缩记录，创建新的会话分支' : '从当前 AI 消息处截断，创建新的会话分支'"
      @confirm="confirmFork"
      @cancel="forkDialog.show = false"
    />

    <Transition name="fade">
      <div v-if="forkResumeConfirm.show" class="fork-resume-overlay" @click.self="forkResumeConfirm.show = false">
        <div class="fork-resume-card">
          <div class="fork-resume-check">✓</div>
          <h3 class="fork-resume-title">Fork 成功</h3>
          <p class="fork-resume-desc">是否立即在终端中打开新会话？</p>
          <div class="fork-resume-actions">
            <button class="fork-resume-btn cancel" @click="forkResumeConfirm.show = false">稍后再说</button>
            <button class="fork-resume-btn confirm" @click="resumeForkedSession">立即打开</button>
          </div>
        </div>
      </div>
    </Transition>

    <ImagePreview
      :show="imagePreview.show"
      :src="imagePreview.src"
      :media-type="imagePreview.mediaType"
      @close="imagePreview.show = false"
    />

    <SettingsDrawer
      :show="showSettings"
      :terminal-command="terminalCommand"
      :terminal-app="terminalApp"
      @update:terminal-command="terminalCommand = $event"
      @update:terminal-app="terminalApp = $event"
      @close="showSettings = false"
    />

    <StatsView :show="showStats" @close="showStats = false" />

    <SnackBar />
  </div>
</template>

<style scoped>
.app {
  display: flex;
  height: 100vh;
  font-family: system-ui, -apple-system, sans-serif;
  background: #f5f5f5;
  color: #333;
  position: relative;
  overflow: hidden;
}
.app.dark {
  background: #121212;
  color: #e0e0e0;
}

.sidebar-toggle {
  position: absolute;
  left: v-bind("sidebarCollapsed ? '0px' : sidebarWidth + 'px'");
  top: 50%;
  transform: translateY(-50%);
  z-index: 21;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 48px;
  border: none;
  border-radius: 0 6px 6px 0;
  background: rgba(0,0,0,0.04);
  cursor: pointer;
  color: inherit;
  opacity: 0.3;
  padding: 0;
  transition: left 0.2s, opacity 0.15s;
}
.sidebar-toggle:hover {
  opacity: 0.8;
  background: rgba(0,0,0,0.08);
}
.dark .sidebar-toggle {
  background: rgba(255,255,255,0.06);
}
.dark .sidebar-toggle:hover {
  background: rgba(255,255,255,0.12);
}
/* 侧边栏拖拽调宽手柄 */
.sidebar-resizer {
  position: absolute;
  left: v-bind("sidebarWidth + 'px'");
  top: 0;
  bottom: 0;
  width: 5px;
  margin-left: -2px;
  z-index: 22;
  cursor: col-resize;
}
.sidebar-resizer:hover {
  background: rgba(25,118,210,0.3);
}

.content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
  position: relative;
}

.fork-resume-overlay {
  position: fixed;
  inset: 0;
  z-index: 10000;
  background: rgba(0,0,0,0.5);
  display: flex;
  align-items: center;
  justify-content: center;
}
.fork-resume-card {
  background: #fff;
  border-radius: 12px;
  padding: 28px 24px 24px;
  width: 320px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.2);
  text-align: center;
}
.dark .fork-resume-card {
  background: #2a2a2a;
  box-shadow: 0 8px 32px rgba(0,0,0,0.5);
}
.fork-resume-check {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: #e8f5e9;
  color: #43a047;
  font-size: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 12px;
}
.dark .fork-resume-check {
  background: rgba(67,160,71,0.2);
}
.fork-resume-title {
  margin: 0 0 6px;
  font-size: 16px;
  font-weight: 600;
}
.fork-resume-desc {
  margin: 0 0 20px;
  font-size: 13px;
  opacity: 0.6;
}
.fork-resume-actions {
  display: flex;
  justify-content: center;
  gap: 10px;
}
.fork-resume-btn {
  padding: 7px 20px;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
}
.fork-resume-btn.cancel {
  background: rgba(0,0,0,0.06);
  color: inherit;
}
.dark .fork-resume-btn.cancel {
  background: rgba(255,255,255,0.1);
}
.fork-resume-btn.confirm {
  background: #1976d2;
  color: #fff;
}
.fade-enter-active, .fade-leave-active { transition: opacity 0.2s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
