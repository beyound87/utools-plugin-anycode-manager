const { fs, path, os, parseJsonl, isSystemText, launchInTerminal, readSessionFileSmart } = require('./common')
const crypto = require('node:crypto')

const PROVIDER_ID = 'claude'
const PROVIDER_NAME = 'Claude Code'

function getRoot() {
  return path.join(os.homedir(), '.claude', 'projects')
}

function isAvailable() {
  return fs.existsSync(getRoot())
}

function extractSessionName(items, fallbackName) {
  // 1. custom-title 最优先（用户手动设置）
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].type === 'custom-title' && items[i].customTitle) return items[i].customTitle
  }
  for (let i = items.length - 1; i >= 0; i--) {
    const data = items[i]
    if (data.type !== 'user') continue
    const msg = data.message
    if (!msg) continue
    const msgContent = msg.content
    if (Array.isArray(msgContent) && msgContent.some(b => b.type === 'tool_result')) continue
    if (data.sourceToolUseID || data.sourceToolAssistantUUID) continue
    if (data.isMeta) continue
    let text = ''
    if (typeof msgContent === 'string') {
      text = isSystemText(msgContent) ? '' : msgContent
    } else if (Array.isArray(msgContent)) {
      for (const block of msgContent) {
        const t = typeof block === 'string' ? block : (block.type === 'text' && block.text ? block.text : '')
        if (!t) continue
        if (isSystemText(t)) {
          const cmdMatch = t.match(/<command-name>([^<]+)<\/command-name>/)
          if (cmdMatch) { text = cmdMatch[1].trim(); break }
          continue
        }
        text = t
        break
      }
    }
    text = text.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
    if (!text) continue
    // 跳过续接样板文（Claude Code 上下文续接注入），交给 ai-title
    if (/^This session is being continued from a previous conversation/.test(text)) continue
    return text.length > 50 ? text.slice(0, 50) + '...' : text
  }
  return fallbackName
}

// ai-title 兜底（Claude 自动生成的标题 slug）；单独拆出，避免短路渐进读取
function extractAiTitle(items) {
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].type === 'ai-title' && (items[i].aiTitle || items[i].title)) {
      return items[i].aiTitle || items[i].title
    }
  }
  return ''
}

// 最后兜底：任意用户文本（含 isMeta 注入，剥离 XML 标签），用于纯自动化会话
function extractAnyUserText(items) {
  for (const it of items) {
    if (it.type !== 'user' || !it.message) continue
    const mc = it.message.content
    let t = ''
    if (typeof mc === 'string') t = mc
    else if (Array.isArray(mc)) {
      for (const b of mc) { if (b.type === 'text' && b.text) { t = b.text; break } }
    }
    if (!t) continue
    t = t.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
    if (!t || /^This session is being continued/.test(t)) continue
    return t.length > 50 ? t.slice(0, 50) + '...' : t
  }
  return ''
}

// ponytail: Claude 目录编码不可逆（.- 都变 -），只做最小美化
function decodeProjectDir(name) {
  const m = name.match(/^([A-Za-z])--(.*)$/)
  if (m) return m[1] + ':\\' + m[2]
  return name
}

function scanProjects() {
  const projectsPath = getRoot()
  if (!fs.existsSync(projectsPath)) return []
  const projects = []
  for (const projectDir of fs.readdirSync(projectsPath)) {
    const projectPath = path.join(projectsPath, projectDir)
    const projectStat = fs.statSync(projectPath)
    if (!projectStat.isDirectory()) continue
    const allEntries = fs.readdirSync(projectPath)
    const jsonlFiles = allEntries.filter(f => f.endsWith('.jsonl'))
    const projectMemoryDir = path.join(projectPath, 'memory')
    const hasMemory = fs.existsSync(path.join(projectMemoryDir, 'MEMORY.md'))
    if (jsonlFiles.length === 0 && !hasMemory) continue

    // latestMtime：正常项目逐文件 stat 取准确时间（新建/修改会话都能正确置顶排序）；
    // 仅超大项目（>1000 文件）退回目录 mtime 避免海量 stat
    let latestMtime = projectStat.mtime
    let newestFile = jsonlFiles.length ? jsonlFiles[jsonlFiles.length - 1] : null
    if (jsonlFiles.length > 0 && jsonlFiles.length <= 1000) {
      let newestMtime = new Date(0)
      for (const f of jsonlFiles) {
        const m = fs.statSync(path.join(projectPath, f)).mtime
        if (m > latestMtime) latestMtime = m
        if (m > newestMtime) { newestMtime = m; newestFile = f }
      }
    }
    if (hasMemory) {
      try {
        const memMtime = fs.statSync(projectMemoryDir).mtime
        if (memMtime > latestMtime) latestMtime = memMtime
      } catch (e) {}
    }

    // 只读最新文件头部取 cwd（大文件不全量读）
    let cwd = ''
    if (newestFile) {
      try {
        const fp = path.join(projectPath, newestFile)
        const fd = fs.openSync(fp, 'r')
        const size = Math.min(fs.fstatSync(fd).size, 16 * 1024)
        const buf = Buffer.alloc(size)
        fs.readSync(fd, buf, 0, size, 0)
        fs.closeSync(fd)
        const items = parseJsonl(buf.toString('utf-8'))
        for (const data of items.slice(0, 20)) {
          if (data.cwd) { cwd = data.cwd; break }
        }
      } catch (e) {}
    }

    let memorySize = 0, memoryFileCount = 0
    if (hasMemory) {
      try {
        for (const mf of fs.readdirSync(projectMemoryDir)) {
          const s = fs.statSync(path.join(projectMemoryDir, mf))
          if (s.isFile()) { memorySize += s.size; memoryFileCount++ }
        }
      } catch (e) {}
    }

    projects.push({
      provider: PROVIDER_ID,
      name: projectDir,
      displayName: cwd || decodeProjectDir(projectDir),
      cwd,
      path: projectPath,
      sessionCount: jsonlFiles.length,
      sessions: [],
      sessionsLoaded: false,
      sessionsLoading: false,
      latestMtime,
      hasMemory,
      memorySize,
      memoryFileCount
    })
  }
  return projects.sort((a, b) => b.latestMtime - a.latestMtime)
}

// ponytail: 头部 8KB 取 sessionId/cwd；尾部渐进式读取取 timestamp/favorite/name
// 先读 512KB，若尾部全是工具链拿不到会话名，再扩读到 4MB（仅对超大文件触发）
function readSessionMeta(filePath) {
  const fd = fs.openSync(filePath, 'r')
  try {
    const fileSize = fs.fstatSync(fd).size

    // 头部：sessionId + cwd
    const headSize = Math.min(fileSize, 8 * 1024)
    const headBuf = Buffer.alloc(headSize)
    fs.readSync(fd, headBuf, 0, headSize, 0)
    const headItems = parseJsonl(headBuf.toString('utf-8'))
    let sessionId = '', cwd = ''
    for (const data of headItems.slice(0, 20)) {
      if (!sessionId && data.sessionId) sessionId = data.sessionId
      if (!cwd && data.cwd) cwd = data.cwd
      if (sessionId && cwd) break
    }

    const readTail = (size) => {
      const tailSize = Math.min(fileSize, size)
      const buf = Buffer.alloc(tailSize)
      fs.readSync(fd, buf, 0, tailSize, fileSize - tailSize)
      let text = buf.toString('utf-8')
      if (fileSize > tailSize) { const nl = text.indexOf('\n'); if (nl >= 0) text = text.slice(nl + 1) }
      return parseJsonl(text)
    }

    // 尾部 512KB：timestamp / favorite 一定在最末尾
    const tailItems = readTail(512 * 1024)
    let timestamp = ''
    for (let k = tailItems.length - 1; k >= 0; k--) {
      if (tailItems[k].timestamp) { timestamp = tailItems[k].timestamp; break }
    }
    const isFavorite = tailItems.some(item => item.type === 'custom-favorite')

    // 会话名：优先真实用户消息，逐级扩读尾部（512KB→4MB→16MB）；都没有再退回 ai-title
    let name = extractSessionName(tailItems, '')
    let biggestItems = tailItems
    if (!name && fileSize > 512 * 1024) {
      biggestItems = readTail(4 * 1024 * 1024)
      name = extractSessionName(biggestItems, '')
    }
    if (!name && fileSize > 4 * 1024 * 1024) {
      biggestItems = readTail(16 * 1024 * 1024)
      name = extractSessionName(biggestItems, '')
    }
    if (!name) name = extractAiTitle(biggestItems) || extractAnyUserText(headItems)

    return { sessionId, cwd, timestamp, isFavorite, name }
  } finally {
    fs.closeSync(fd)
  }
}

// ponytail: 会话元数据缓存 — key=filePath, value={ mtimeMs, meta }
// 展开/刷新项目时未修改的文件直接命中，避免重复 readSessionMeta（头+尾分片读取）
const sessionMetaCache = new Map()

function getSessionMetaCached(filePath, mtimeMs) {
  const cached = sessionMetaCache.get(filePath)
  if (cached && cached.mtimeMs === mtimeMs) return cached.meta
  const meta = readSessionMeta(filePath)
  sessionMetaCache.set(filePath, { mtimeMs, meta })
  return meta
}

// ponytail: limit 参数 — 大项目只加载最近 N 个会话，避免卡顿
function loadProjectSessions(projectPath, _project, limit) {
  try {
    let files = fs.readdirSync(projectPath).filter(f => f.endsWith('.jsonl'))

    // 按文件 mtime 排序（stat 快于 readSessionMeta，先排再截断）
    const fileStats = files.map(file => {
      const filePath = path.join(projectPath, file)
      const stat = fs.statSync(filePath)
      return { file, filePath, stat }
    })
    fileStats.sort((a, b) => b.stat.mtime - a.stat.mtime)

    // 大项目截断：只加载最近的会话
    const maxLoad = limit || (fileStats.length > 500 ? 200 : fileStats.length)
    const toLoad = fileStats.slice(0, maxLoad)
    const truncated = fileStats.length > maxLoad

    const sessions = toLoad.map(({ file, filePath, stat: fileStat }) => {
      let sessionInfo = { name: file.replace('.jsonl', ''), path: filePath }
      try {
        const meta = getSessionMetaCached(filePath, fileStat.mtime.getTime())
        sessionInfo = {
          name: meta.name || file.replace('.jsonl', ''),
          path: filePath,
          sessionId: meta.sessionId,
          timestamp: meta.timestamp,
          cwd: meta.cwd,
          isFavorite: meta.isFavorite
        }
      } catch (e) {}
      // subagents
      const sessionUuid = file.replace('.jsonl', '')
      const subagentDir = path.join(projectPath, sessionUuid, 'subagents')
      const subagents = []
      if (fs.existsSync(subagentDir)) {
        try {
          const subFiles = fs.readdirSync(subagentDir).filter(f => /^agent-[a-f0-9]+\.jsonl$/.test(f))
          for (const subFile of subFiles) {
            const agentId = subFile.replace(/^agent-/, '').replace(/\.jsonl$/, '')
            const subPath = path.join(subagentDir, subFile)
            const subStat = fs.statSync(subPath)
            let subName = agentId
            const metaPath = path.join(subagentDir, `agent-${agentId}.meta.json`)
            if (fs.existsSync(metaPath)) {
              try {
                const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
                if (meta.description) subName = meta.description
              } catch (e) {}
            }
            subagents.push({
              agentId, name: subName, path: subPath, size: subStat.size,
              modifiedTime: subStat.mtime, isSubagent: true, parentSessionPath: filePath,
              provider: PROVIDER_ID
            })
          }
        } catch (e) {}
      }
      return { ...sessionInfo, size: fileStat.size, modifiedTime: fileStat.mtime, subagents, provider: PROVIDER_ID }
    }).sort((a, b) => new Date(b.modifiedTime) - new Date(a.modifiedTime))
    return { success: true, sessions, truncated, totalCount: fileStats.length }
  } catch (error) {
    return { success: false, error: error.message, sessions: [] }
  }
}

function readSessionFile(filePath) {
  try {
    const { items } = readSessionFileSmart(filePath)
    return items
  } catch (error) {
    console.error('Error reading session file:', error)
    return []
  }
}

function deleteSession(filePath) {
  try {
    if (!fs.existsSync(filePath)) return { success: false, error: 'File not found' }
    fs.unlinkSync(filePath)
    const companionDir = filePath.replace(/\.jsonl$/, '')
    if (fs.existsSync(companionDir) && fs.statSync(companionDir).isDirectory()) {
      fs.rmSync(companionDir, { recursive: true, force: true })
    }
    return { success: true }
  } catch (error) {
    return { success: false, error: error.message }
  }
}

function deleteProjectSessions(projectPath) {
  try {
    const files = fs.readdirSync(projectPath).filter(f => f.endsWith('.jsonl'))
    let deleted = 0
    const errors = []
    for (const file of files) {
      const filePath = path.join(projectPath, file)
      try {
        fs.unlinkSync(filePath)
        const companionDir = filePath.replace(/\.jsonl$/, '')
        if (fs.existsSync(companionDir) && fs.statSync(companionDir).isDirectory()) {
          fs.rmSync(companionDir, { recursive: true, force: true })
        }
        deleted++
      } catch (e) { errors.push(file + ': ' + e.message) }
    }
    return { success: errors.length === 0, deleted, errors }
  } catch (error) {
    return { success: false, deleted: 0, errors: [error.message] }
  }
}

function getResumeCommand(sessionId, command) {
  return `${command || 'claude'} --resume ${sessionId}`
}

function resumeSession(sessionId, cwd, command, terminalApp) {
  return launchInTerminal(getResumeCommand(sessionId, command), cwd, terminalApp)
}

function newSession(cwd, command, terminalApp) {
  return launchInTerminal(command || 'claude', cwd, terminalApp)
}

function renameSession(filePath, newTitle) {
  try {
    if (!fs.existsSync(filePath)) return { success: false, error: 'File not found' }
    const content = fs.readFileSync(filePath, 'utf-8')
    const items = parseJsonl(content)
    let sessionId = ''
    for (const data of items) {
      if (data.sessionId) { sessionId = data.sessionId; break }
    }
    let foundTitle = false
    for (let i = items.length - 1; i >= 0; i--) {
      if (items[i].type === 'custom-title') { items[i].customTitle = newTitle; foundTitle = true; break }
    }
    if (!foundTitle) items.push({ type: 'custom-title', customTitle: newTitle, sessionId })
    let foundAgent = false
    for (let i = items.length - 1; i >= 0; i--) {
      if (items[i].type === 'agent-name') { items[i].agentName = newTitle; foundAgent = true; break }
    }
    if (!foundAgent) items.push({ type: 'agent-name', agentName: newTitle, sessionId })
    fs.writeFileSync(filePath, items.map(item => JSON.stringify(item)).join('\n') + '\n', 'utf-8')
    return { success: true }
  } catch (error) {
    return { success: false, error: error.message }
  }
}

function toggleFavorite(filePath) {
  try {
    if (!fs.existsSync(filePath)) return { success: false, error: 'File not found' }
    const content = fs.readFileSync(filePath, 'utf-8')
    const items = parseJsonl(content)
    let favIdx = -1
    for (let i = items.length - 1; i >= 0; i--) {
      if (items[i].type === 'custom-favorite') { favIdx = i; break }
    }
    if (favIdx >= 0) {
      items.splice(favIdx, 1)
    } else {
      let sessionId = ''
      for (const data of items) { if (data.sessionId) { sessionId = data.sessionId; break } }
      items.push({ type: 'custom-favorite', favorite: true, sessionId })
    }
    fs.writeFileSync(filePath, items.map(item => JSON.stringify(item)).join('\n') + '\n', 'utf-8')
    return { success: true, isFavorite: favIdx < 0 }
  } catch (error) {
    return { success: false, error: error.message }
  }
}

function forkSession(sourceFilePath, cutoffUuid, title) {
  try {
    if (!fs.existsSync(sourceFilePath)) return { success: false, error: 'File not found' }
    const content = fs.readFileSync(sourceFilePath, 'utf-8')
    const items = parseJsonl(content)
    let cutIdx = -1
    for (let i = items.length - 1; i >= 0; i--) {
      if (items[i].uuid === cutoffUuid) { cutIdx = i; break }
    }
    if (cutIdx < 0) return { success: false, error: 'Message not found' }
    const forked = items.slice(0, cutIdx + 1)
    const newSessionId = crypto.randomUUID()
    for (const item of forked) { if (item.sessionId) item.sessionId = newSessionId }
    forked.push({ type: 'custom-title', customTitle: title, sessionId: newSessionId })
    forked.push({ type: 'agent-name', agentName: title, sessionId: newSessionId })
    const dir = path.dirname(sourceFilePath)
    const newFilePath = path.join(dir, newSessionId + '.jsonl')
    fs.writeFileSync(newFilePath, forked.map(item => JSON.stringify(item)).join('\n') + '\n', 'utf-8')
    return { success: true, sessionId: newSessionId, path: newFilePath }
  } catch (error) {
    return { success: false, error: error.message }
  }
}

function forkSummarySession(sourceFilePath, summaryUuid, title) {
  try {
    if (!fs.existsSync(sourceFilePath)) return { success: false, error: 'File not found' }
    const content = fs.readFileSync(sourceFilePath, 'utf-8')
    const items = parseJsonl(content)
    const summaryItem = items.find(item => item.uuid === summaryUuid)
    if (!summaryItem) return { success: false, error: 'Summary message not found' }
    const newSessionId = crypto.randomUUID()
    const forked = [
      { ...summaryItem, sessionId: newSessionId },
      { type: 'custom-title', customTitle: title, sessionId: newSessionId },
      { type: 'agent-name', agentName: title, sessionId: newSessionId }
    ]
    const dir = path.dirname(sourceFilePath)
    const newFilePath = path.join(dir, newSessionId + '.jsonl')
    fs.writeFileSync(newFilePath, forked.map(item => JSON.stringify(item)).join('\n') + '\n', 'utf-8')
    return { success: true, sessionId: newSessionId, path: newFilePath }
  } catch (error) {
    return { success: false, error: error.message }
  }
}

function getSnapshotFileContents(sessionFilePath, selectedBackups) {
  try {
    const sessionUuid = path.basename(sessionFilePath, '.jsonl')
    const fileHistoryDir = path.join(os.homedir(), '.claude', 'file-history', sessionUuid)
    const content = fs.readFileSync(sessionFilePath, 'utf-8')
    const items = parseJsonl(content)
    let cwd = ''
    for (const item of items.slice(0, 20)) { if (item.cwd) { cwd = item.cwd; break } }
    if (!cwd) return { success: false, error: '无法确定项目目录' }
    const files = []
    for (const [relativePath, { backupFileName }] of Object.entries(selectedBackups)) {
      const backupFilePath = path.join(fileHistoryDir, backupFileName)
      const normalized = relativePath.split(/[/\\]/).join(path.sep)
      const absolutePath = path.join(cwd, normalized)
      let backupContent = null, currentContent = null
      try { backupContent = fs.readFileSync(backupFilePath, 'utf-8') } catch (e) {}
      try { currentContent = fs.readFileSync(absolutePath, 'utf-8') } catch (e) {}
      files.push({ filePath: relativePath, backupContent, currentContent })
    }
    return { success: true, files }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

function restoreSnapshot(sessionFilePath, trackedFileBackups) {
  try {
    const sessionUuid = path.basename(sessionFilePath, '.jsonl')
    const fileHistoryDir = path.join(os.homedir(), '.claude', 'file-history', sessionUuid)
    const content = fs.readFileSync(sessionFilePath, 'utf-8')
    const items = parseJsonl(content)
    let cwd = ''
    for (const item of items.slice(0, 20)) { if (item.cwd) { cwd = item.cwd; break } }
    if (!cwd) return { success: false, error: '无法确定项目目录', restoredFiles: [], errors: [] }
    const restoredFiles = [], errors = []
    for (const [relativePath, { backupFileName }] of Object.entries(trackedFileBackups)) {
      try {
        const backupFilePath = path.join(fileHistoryDir, backupFileName)
        if (!fs.existsSync(backupFilePath)) { errors.push(`备份文件不存在: ${relativePath}`); continue }
        const backupContent = fs.readFileSync(backupFilePath, 'utf-8')
        const normalized = relativePath.split(/[/\\]/).join(path.sep)
        fs.writeFileSync(path.join(cwd, normalized), backupContent, 'utf-8')
        restoredFiles.push(relativePath)
      } catch (e) { errors.push(`${relativePath}: ${e.message}`) }
    }
    return { success: errors.length === 0, restoredFiles, errors, cwd }
  } catch (error) {
    return { success: false, error: error.message, restoredFiles: [], errors: [] }
  }
}

// ponytail: memory 管理是 Claude Code 特有功能
function getMemoryFiles(projectPath) {
  const memoryDir = path.join(projectPath, 'memory')
  if (!fs.existsSync(memoryDir)) return { success: false, files: [] }
  try {
    const entries = fs.readdirSync(memoryDir).filter(f => fs.statSync(path.join(memoryDir, f)).isFile())
    const files = entries.map(f => ({
      name: f, path: path.join(memoryDir, f),
      content: fs.readFileSync(path.join(memoryDir, f), 'utf-8')
    }))
    files.sort((a, b) => {
      if (a.name === 'MEMORY.md') return -1
      if (b.name === 'MEMORY.md') return 1
      return a.name.localeCompare(b.name)
    })
    return { success: true, files }
  } catch (e) {
    return { success: false, error: e.message, files: [] }
  }
}

module.exports = {
  id: PROVIDER_ID,
  name: PROVIDER_NAME,
  getRoot,
  isAvailable,
  scanProjects,
  loadProjectSessions,
  readSessionFile,
  deleteSession,
  deleteProjectSessions,
  getResumeCommand,
  resumeSession,
  newSession,
  extractSessionName,
  renameSession,
  toggleFavorite,
  forkSession,
  forkSummarySession,
  getSnapshotFileContents,
  restoreSnapshot,
  getMemoryFiles,
  supportsRename: true,
  supportsFork: true,
  supportsMemory: true,
  supportsSnapshot: true
}
