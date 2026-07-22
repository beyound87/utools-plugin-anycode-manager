const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { grepSessionFile } = require('./providers/common')
const chat = require('./providers/chat')

// Provider registry
const claudeProvider = require('./providers/claude')
const providers = [claudeProvider]

// 按需加载其他 provider，缺依赖时静默跳过
try { providers.push(require('./providers/codex')) } catch (e) { console.warn('Codex provider unavailable:', e.message) }
try { providers.push(require('./providers/gemini')) } catch (e) { console.warn('Gemini provider unavailable:', e.message) }
try { providers.push(require('./providers/opencode')) } catch (e) { console.warn('OpenCode provider unavailable:', e.message) }

function getProvider(providerId) {
  return providers.find(p => p.id === providerId)
}

function getAvailableProviders() {
  return providers.filter(p => p.isAvailable()).map(p => ({ id: p.id, name: p.name }))
}

// --- 聚合扫描：合并所有 provider 的项目列表 ---

function getProjectsQuick() {
  const all = []
  for (const p of providers) {
    if (!p.isAvailable()) continue
    try {
      const projects = p.scanProjects()
      all.push(...projects)
    } catch (e) {
      console.error(`Provider ${p.id} scanProjects failed:`, e)
    }
  }
  return all.sort((a, b) => b.latestMtime - a.latestMtime)
}

// 增量扫描：逐 provider 扫描，每个之间 yield 给 UI 线程，项目列表逐步出现
function getProjectsIncremental(onBatch) {
  const available = providers.filter(p => { try { return p.isAvailable() } catch (e) { return false } })
  const all = []
  let i = 0
  function next() {
    if (i >= available.length) { onBatch(all, true); return }
    const p = available[i++]
    try { all.push(...p.scanProjects()) } catch (e) {}
    all.sort((a, b) => b.latestMtime - a.latestMtime)
    onBatch(all, i >= available.length)
    if (i < available.length) setTimeout(next, 0)
  }
  setTimeout(next, 0)
}

// --- 跨会话全文搜索 ---
// 文件类 provider（claude/codex/gemini）逐会话 grep 内容；OpenCode 用 SQL。返回匹配会话 + 片段
function searchSessions(query, opts = {}) {
  const q = (query || '').trim()
  if (!q) return []
  const limit = opts.limit || 100
  const perProviderCap = limit // 每个 provider 各自最多收集 limit 条，最后合并排序取 limit
  const results = []
  for (const p of providers) {
    if (!p.isAvailable()) continue
    try {
      if (typeof p.searchSessions === 'function') {
        results.push(...p.searchSessions(q, { limit: perProviderCap, caseSensitive: opts.caseSensitive }))
        continue
      }
      // 文件类：枚举会话，逐个 grep（各 provider 独立配额，避免会话多的平台挤掉其他平台结果）
      // scanned 上限：罕见词不会扫全库卡死 UI（每平台最多搜最近 800 个会话）
      let got = 0, scanned = 0
      const SCAN_CAP = 800
      for (const proj of p.scanProjects()) {
        if (got >= perProviderCap || scanned >= SCAN_CAP) break
        const { sessions } = p.loadProjectSessions(proj.path, proj)
        for (const s of (sessions || [])) {
          if (got >= perProviderCap || scanned >= SCAN_CAP) break
          scanned++
          const hit = grepSessionFile(s.path, q, opts.caseSensitive)
          if (hit) {
            got++
            results.push({
              provider: p.id, projectName: proj.displayName, projectPath: proj.path,
              sessionPath: s.path, sessionId: s.sessionId, name: s.name,
              cwd: s.cwd, modifiedTime: s.modifiedTime, count: hit.count, snippet: hit.snippet
            })
          }
        }
      }
    } catch (e) {
      console.error(`Provider ${p.id} search failed:`, e)
    }
  }
  return results.sort((a, b) => new Date(b.modifiedTime) - new Date(a.modifiedTime)).slice(0, limit)
}

function loadProjectSessions(projectPath, providerId, project) {
  const p = providerId ? getProvider(providerId) : claudeProvider
  if (!p) return { success: false, error: 'Unknown provider', sessions: [] }
  return p.loadProjectSessions(projectPath, project)
}

// --- 统计洞察 ---
// 会话数/大小/活跃度从缓存的元数据聚合；OpenCode 额外给花费/token（SQL）
function getStats() {
  const perProvider = {}
  const activityByDay = {}
  const projectSizes = []
  let totalSessions = 0, totalSize = 0
  for (const p of providers) {
    if (!p.isAvailable()) continue
    const st = { id: p.id, name: p.name, sessions: 0, size: 0, projects: 0 }
    try {
      for (const proj of p.scanProjects()) {
        const { sessions } = p.loadProjectSessions(proj.path, proj)
        const list = sessions || []
        st.projects++
        let projSize = 0
        for (const s of list) {
          st.sessions++; totalSessions++
          const sz = s.size || 0
          st.size += sz; totalSize += sz; projSize += sz
          if (s.modifiedTime) {
            const key = new Date(s.modifiedTime).toISOString().slice(0, 10)
            activityByDay[key] = (activityByDay[key] || 0) + 1
          }
        }
        if (list.length) projectSizes.push({ name: proj.displayName, provider: p.id, sessions: list.length, size: projSize })
      }
      if (typeof p.getCostStats === 'function') st.cost = p.getCostStats()
    } catch (e) { console.error(`stats ${p.id} failed:`, e) }
    perProvider[p.id] = st
  }
  const topProjects = projectSizes.sort((a, b) => b.sessions - a.sessions).slice(0, 8)
  return { totalSessions, totalSize, perProvider, activityByDay, topProjects }
}


// --- 会话操作：根据 provider 路由 ---

function readSessionFile(filePath, providerId) {
  const p = providerId ? getProvider(providerId) : claudeProvider
  if (!p) return []
  return p.readSessionFile(filePath)
}

function deleteSession(filePath, providerId) {
  const p = providerId ? getProvider(providerId) : claudeProvider
  if (!p) return { success: false, error: 'Unknown provider' }
  return p.deleteSession(filePath)
}

function deleteProjectSessions(projectPath, providerId) {
  const p = providerId ? getProvider(providerId) : claudeProvider
  if (!p) return { success: false, deleted: 0, errors: ['Unknown provider'] }
  if (!p.deleteProjectSessions) return { success: false, deleted: 0, errors: ['Not supported'] }
  return p.deleteProjectSessions(projectPath)
}

function batchDeleteSessions(filePaths) {
  let deleted = 0, errors = []
  for (const fp of filePaths) {
    // ponytail: OpenCode 的 session path 是 UUID（非文件路径），无路径分隔符和扩展名
    const isFilePath = fp.includes('/') || fp.includes('\\') || fp.includes('.')
    const providerId = isFilePath ? undefined : 'opencode'
    try {
      const result = deleteSession(fp, providerId)
      if (result.success) deleted++
      else errors.push(fp + ': ' + (result.error || 'failed'))
    } catch (e) { errors.push(fp + ': ' + e.message) }
  }
  return { success: errors.length === 0, deleted, errors }
}

function renameSession(filePath, newTitle, providerId) {
  const p = providerId ? getProvider(providerId) : claudeProvider
  if (!p || !p.supportsRename) return { success: false, error: 'Not supported' }
  return p.renameSession(filePath, newTitle)
}

function resumeSession(sessionId, cwd, command, terminalApp, providerId, sessionPath) {
  const p = providerId ? getProvider(providerId) : claudeProvider
  if (!p) return Promise.reject(new Error('Unknown provider'))
  return p.resumeSession(sessionId, cwd, command, terminalApp, sessionPath)
}

function newSession(cwd, command, terminalApp, providerId) {
  const p = providerId ? getProvider(providerId) : claudeProvider
  if (!p) return Promise.reject(new Error('Unknown provider'))
  return p.newSession(cwd, command, terminalApp)
}

function forkSession(sourceFilePath, cutoffUuid, title, providerId) {
  const p = providerId ? getProvider(providerId) : claudeProvider
  if (!p || !p.supportsFork) return { success: false, error: 'Not supported' }
  return p.forkSession(sourceFilePath, cutoffUuid, title)
}

function forkSummarySession(sourceFilePath, summaryUuid, title, providerId) {
  const p = providerId ? getProvider(providerId) : claudeProvider
  if (!p || !p.supportsFork) return { success: false, error: 'Not supported' }
  return p.forkSummarySession(sourceFilePath, summaryUuid, title)
}

function toggleFavorite(filePath, providerId) {
  const p = providerId ? getProvider(providerId) : claudeProvider
  if (!p) return { success: false, error: 'Unknown provider' }
  return p.toggleFavorite(filePath)
}

// --- Claude-specific: 快照和记忆（只有 Claude 支持）---

function getSnapshotFileContents(sessionFilePath, selectedBackups) {
  return claudeProvider.getSnapshotFileContents(sessionFilePath, selectedBackups)
}

function restoreSnapshot(sessionFilePath, trackedFileBackups) {
  return claudeProvider.restoreSnapshot(sessionFilePath, trackedFileBackups)
}

function getMemoryFiles(projectPath) {
  return claudeProvider.getMemoryFiles(projectPath)
}

function saveMemoryFile(filePath, content) {
  try {
    fs.writeFileSync(filePath, content, 'utf-8')
    return { success: true }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

function deleteMemoryFile(filePath) {
  try {
    fs.unlinkSync(filePath)
    return { success: true }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

function clearMemory(projectPath) {
  const memoryDir = path.join(projectPath, 'memory')
  try {
    if (!fs.existsSync(memoryDir)) return { success: true }
    const entries = fs.readdirSync(memoryDir)
    const errors = []
    for (const entry of entries) {
      try { fs.rmSync(path.join(memoryDir, entry), { recursive: true, force: true }) }
      catch (e) { errors.push(`${entry}: ${e.message}`) }
    }
    if (errors.length > 0) return { success: false, error: errors.join('\n') }
    return { success: true }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

// --- File watchers (共用，不分 provider) ---

let currentWatcher = null
let currentMemoryWatcher = null

function watchSessionFile(filePath, callback) {
  if (currentWatcher) { currentWatcher.close(); currentWatcher = null }
  if (!filePath || !fs.existsSync(filePath)) return
  let debounceTimer = null
  currentWatcher = fs.watch(filePath, (eventType) => {
    if (eventType !== 'change') return
    clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => { if (callback) callback() }, 300)
  })
}

function unwatchSessionFile() {
  if (currentWatcher) { currentWatcher.close(); currentWatcher = null }
}

function watchMemoryDir(projectPath, callback) {
  if (currentMemoryWatcher) { currentMemoryWatcher.close(); currentMemoryWatcher = null }
  const memoryDir = path.join(projectPath, 'memory')
  if (!fs.existsSync(memoryDir)) return
  let debounceTimer = null
  currentMemoryWatcher = fs.watch(memoryDir, () => {
    clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => { if (callback) callback() }, 300)
  })
}

function unwatchMemoryDir() {
  if (currentMemoryWatcher) { currentMemoryWatcher.close(); currentMemoryWatcher = null }
}

// --- 导出工具 ---

function saveImage(base64, ext) {
  const filePath = path.join(window.utools.getPath('downloads'), Date.now() + '.' + ext)
  fs.writeFileSync(filePath, Buffer.from(base64, 'base64'))
  return filePath
}

function saveText(content, filename) {
  const safe = (filename || 'export.txt').replace(/[<>:"/\\|?*]/g, '_')
  const filePath = path.join(window.utools.getPath('downloads'), Date.now() + '-' + safe)
  fs.writeFileSync(filePath, content, 'utf-8')
  return filePath
}

// --- 兼容旧 API: getProjectsPath / getAllProjects ---

function getProjectsPath() {
  return claudeProvider.getRoot()
}

function getAllProjects() {
  return getProjectsQuick()
}

// --- window.services ---

window.services = {
  getProjectsPath,
  getProjectsQuick,
  getProjectsIncremental,
  searchSessions,
  getStats,
  loadProjectSessions,
  getAllProjects,
  readSessionFile,
  deleteSession,
  deleteProjectSessions,
  renameSession,
  watchSessionFile,
  unwatchSessionFile,
  saveImage,
  saveText,
  newSession,
  resumeSession,
  forkSession,
  forkSummarySession,
  toggleFavorite,
  batchDeleteSessions,
  restoreSnapshot,
  getSnapshotFileContents,
  getMemoryFiles,
  saveMemoryFile,
  deleteMemoryFile,
  clearMemory,
  watchMemoryDir,
  unwatchMemoryDir,
  getAvailableProviders,
  getProvider,
  // 对话（四平台）
  startChat: chat.startChat,
  sendChatMessage: chat.sendChatMessage,
  stopChat: chat.stopChat,
  isChatRunning: chat.isRunning,
  newChatSession: chat.newChatSession,
  listModels: chat.listModels
}

