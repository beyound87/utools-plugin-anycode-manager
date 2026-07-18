const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

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

function loadProjectSessions(projectPath, providerId, project) {
  const p = providerId ? getProvider(providerId) : claudeProvider
  if (!p) return { success: false, error: 'Unknown provider', sessions: [] }
  return p.loadProjectSessions(projectPath, project)
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
    // ponytail: 根据路径特征推断 provider
    const providerId = fp.startsWith('ses_') ? 'opencode' : undefined
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

function resumeSession(sessionId, cwd, command, terminalApp, providerId) {
  const p = providerId ? getProvider(providerId) : claudeProvider
  if (!p) return Promise.reject(new Error('Unknown provider'))
  return p.resumeSession(sessionId, cwd, command, terminalApp)
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
  getProvider
}
