const { fs, path, os, parseJsonl, launchInTerminal, readSessionFileSmart } = require('./common')

// ponytail: 按块读取首行，避免全量读大文件（Codex session_meta 首行 ~21KB）
function readFirstLine(filePath) {
  const fd = fs.openSync(filePath, 'r')
  try {
    let result = ''
    const chunkSize = 32 * 1024
    const buf = Buffer.alloc(chunkSize)
    let pos = 0
    const fileSize = fs.fstatSync(fd).size
    while (pos < fileSize) {
      const bytesRead = fs.readSync(fd, buf, 0, chunkSize, pos)
      if (bytesRead === 0) break
      const chunk = buf.toString('utf-8', 0, bytesRead)
      const nlIdx = chunk.indexOf('\n')
      if (nlIdx >= 0) {
        result += chunk.slice(0, nlIdx)
        return result
      }
      result += chunk
      pos += bytesRead
    }
    return result
  } finally {
    fs.closeSync(fd)
  }
}

const PROVIDER_ID = 'codex'
const PROVIDER_NAME = 'Codex CLI'

// ponytail: session_meta 缓存 — key 为 filePath，value 为 { mtime, cwd, sessionId, parentThreadId }
const metaCache = new Map()

function getRoot() {
  return path.join(os.homedir(), '.codex', 'sessions')
}

function isAvailable() {
  return fs.existsSync(path.join(os.homedir(), '.codex'))
}

function scanProjects() {
  const root = getRoot()
  if (!fs.existsSync(root)) return []

  const sessionFiles = []
  walkDateDirs(root, sessionFiles)

  // 按 cwd 分组
  const byProject = {}
  for (const sf of sessionFiles) {
    const key = sf.cwd || '__unknown__'
    if (!byProject[key]) byProject[key] = { cwd: sf.cwd, files: [], latestMtime: new Date(0) }
    byProject[key].files.push(sf)
    if (sf.mtime > byProject[key].latestMtime) byProject[key].latestMtime = sf.mtime
  }

  return Object.entries(byProject).map(([cwd, group]) => {
    const displayName = cwd === '__unknown__' ? 'Codex (unknown)' : cwd
    // ponytail: 用 cwd 的路径编码作 name，保证唯一性
    const name = 'codex::' + cwd.replace(/[/\\:]/g, '-')
    return {
      provider: PROVIDER_ID,
      name,
      displayName,
      cwd: cwd === '__unknown__' ? '' : cwd,
      path: root,
      sessionCount: group.files.length,
      sessions: [],
      sessionsLoaded: false,
      sessionsLoading: false,
      latestMtime: group.latestMtime,
      hasMemory: false,
      memorySize: 0,
      memoryFileCount: 0,
      _codexFiles: group.files // 内部用，loadProjectSessions 时取
    }
  }).sort((a, b) => b.latestMtime - a.latestMtime)
}

function walkDateDirs(root, results) {
  try {
    for (const year of fs.readdirSync(root)) {
      const yearPath = path.join(root, year)
      if (!fs.statSync(yearPath).isDirectory()) continue
      for (const month of fs.readdirSync(yearPath)) {
        const monthPath = path.join(yearPath, month)
        if (!fs.statSync(monthPath).isDirectory()) continue
        for (const day of fs.readdirSync(monthPath)) {
          const dayPath = path.join(monthPath, day)
          if (!fs.statSync(dayPath).isDirectory()) continue
          for (const file of fs.readdirSync(dayPath)) {
            if (!file.endsWith('.jsonl')) continue
            const filePath = path.join(dayPath, file)
            const stat = fs.statSync(filePath)
            const mtimeMs = stat.mtime.getTime()

            // ponytail: 缓存命中 — 文件未修改则跳过 readFirstLine
            const cached = metaCache.get(filePath)
            if (cached && cached.mtimeMs === mtimeMs) {
              if (!cached.parentThreadId) {
                results.push({ filePath, mtime: stat.mtime, size: stat.size, cwd: cached.cwd, sessionId: cached.sessionId })
              }
              continue
            }

            let cwd = '', sessionId = '', parentThreadId = null
            try {
              const firstLine = readFirstLine(filePath)
              if (firstLine) {
                const meta = JSON.parse(firstLine)
                if (meta.type === 'session_meta' && meta.payload) {
                  cwd = meta.payload.cwd || ''
                  sessionId = meta.payload.id || ''
                  if (meta.payload.parent_thread_id) parentThreadId = meta.payload.parent_thread_id
                  if (meta.payload.source && typeof meta.payload.source === 'object') parentThreadId = meta.payload.parent_thread_id
                }
              }
            } catch (e) {}
            metaCache.set(filePath, { mtimeMs, cwd, sessionId, parentThreadId })
            if (parentThreadId) continue
            results.push({ filePath, mtime: stat.mtime, size: stat.size, cwd, sessionId })
          }
        }
      }
    }
  } catch (e) {}
}

// ponytail: 会话名缓存 key=filePath value={mtimeMs,name}，重载未修改文件直接命中
const nameCache = new Map()

function loadProjectSessions(projectPath, _project) {
  let files = _project?._codexFiles
  if (!files || files.length === 0) {
    const all = []
    walkDateDirs(getRoot(), all)
    const cwd = _project?.cwd || projectPath || ''
    files = cwd ? all.filter(f => f.cwd === cwd) : all
  }

  const sessions = files.map(sf => {
    const fallback = sf.sessionId || path.basename(sf.filePath, '.jsonl')
    let name = fallback
    const mtimeMs = sf.mtime.getTime()
    const cached = nameCache.get(sf.filePath)
    if (cached && cached.mtimeMs === mtimeMs) {
      name = cached.name
    } else try {
      const fd = fs.openSync(sf.filePath, 'r')
      const fileSize = fs.fstatSync(fd).size
      const readTail = (size) => {
        const tailSize = Math.min(fileSize, size)
        const buf = Buffer.alloc(tailSize)
        fs.readSync(fd, buf, 0, tailSize, fileSize - tailSize)
        let text = buf.toString('utf-8')
        if (fileSize > tailSize) { const nl = text.indexOf('\n'); if (nl >= 0) text = text.slice(nl + 1) }
        return parseJsonl(text)
      }
      try {
        // 512KB 找不到会话名再扩读 4MB
        name = extractSessionName(readTail(512 * 1024), '')
        if (!name && fileSize > 512 * 1024) name = extractSessionName(readTail(4 * 1024 * 1024), '')
      } finally { fs.closeSync(fd) }
      if (!name) name = fallback
      nameCache.set(sf.filePath, { mtimeMs, name })
    } catch (e) {}
    return {
      name,
      path: sf.filePath,
      sessionId: sf.sessionId,
      timestamp: sf.mtime.toISOString(),
      cwd: sf.cwd,
      isFavorite: false,
      size: sf.size,
      modifiedTime: sf.mtime,
      subagents: [],
      provider: PROVIDER_ID
    }
  }).sort((a, b) => new Date(b.modifiedTime) - new Date(a.modifiedTime))

  return { success: true, sessions }
}

function isSystemContent(text) {
  if (!text) return true
  const t = text.trimStart()
  if (t.startsWith('<')) return true
  if (t.startsWith('[') && /^\[(Request |Error|System|tool_|WARNING)/.test(t)) return true
  if (t.startsWith('#') && /^#\s*(AGENTS|CLAUDE|README|GEMINI)/.test(t)) return true
  // 剥离 XML 标签后无有效文本也视为系统内容
  const stripped = t.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
  if (!stripped) return true
  return false
}

// ponytail: 从尾部往头部找最后一条有效用户消息
function extractSessionName(items, fallback) {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]
    // response_item role=user
    if (item.type === 'response_item' && item.payload?.role === 'user') {
      const content = item.payload.content
      if (!Array.isArray(content)) continue
      for (const block of content) {
        if (block.type === 'input_text' && block.text && !isSystemContent(block.text)) {
          const text = block.text.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
          if (text) return text.length > 50 ? text.slice(0, 50) + '...' : text
        }
      }
    }
    // event_msg type=user_message — payload.message 是用户文本
    if (item.type === 'event_msg' && item.payload?.type === 'user_message' && item.payload.message) {
      const msg = item.payload.message
      if (!isSystemContent(msg)) {
        const text = msg.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
        if (text) return text.length > 50 ? text.slice(0, 50) + '...' : text
      }
    }
  }
  return fallback
}

// Codex JSONL → 归一化为 Claude 兼容格式
function readSessionFile(filePath) {
  try {
    const { items: rawItems } = readSessionFileSmart(filePath)
    return normalizeCodexItems(rawItems)
  } catch (error) {
    console.error('Error reading Codex session:', error)
    return []
  }
}

function normalizeCodexItems(rawItems) {
  const normalized = []
  let sessionId = '', cwd = ''

  for (const item of rawItems) {
    if (item.type === 'session_meta' && item.payload) {
      sessionId = item.payload.id || ''
      cwd = item.payload.cwd || ''
      continue
    }

    const ts = item.timestamp || ''

    if (item.type === 'event_msg' && item.payload) {
      const p = item.payload
      if (p.type === 'user_message' && p.message) {
        normalized.push({
          type: 'user',
          message: { role: 'user', content: [{ type: 'text', text: p.message }] },
          sessionId, cwd, timestamp: ts, uuid: p.client_id || ts + '-user-' + normalized.length
        })
      }
      if (p.type === 'agent_message' && p.message) {
        normalized.push({
          type: 'assistant',
          message: { role: 'assistant', content: [{ type: 'text', text: p.message }] },
          sessionId, cwd, timestamp: ts, uuid: ts + '-agent-' + normalized.length
        })
      }
      continue
    }

    if (item.type === 'response_item' && item.payload) {
      const p = item.payload
      const role = p.role === 'assistant' ? 'assistant' : (p.role === 'developer' ? 'user' : p.role || 'assistant')
      const content = []

      if (Array.isArray(p.content)) {
        for (const block of p.content) {
          if (block.type === 'output_text' || block.type === 'input_text') {
            content.push({ type: 'text', text: block.text || '' })
          } else if (block.type === 'reasoning') {
            content.push({ type: 'thinking', thinking: block.text || block.summary || '' })
          } else if (block.type === 'function_call') {
            const mappedName = mapToolName(block.name)
            const input = parseToolInput(block.arguments)
            // exec_command → Bash: 映射 cmd_string → command
            if (mappedName === 'Bash' && input.cmd_string && !input.command) input.command = input.cmd_string
            content.push({
              type: 'tool_use', name: mappedName,
              id: block.call_id || block.id || '', input
            })
          } else if (block.type === 'function_call_output') {
            content.push({
              type: 'tool_result', tool_use_id: block.call_id || '',
              content: block.output || '', is_error: block.status === 'error'
            })
          } else {
            content.push({ type: 'text', text: JSON.stringify(block) })
          }
        }
      } else if (typeof p.content === 'string') {
        content.push({ type: 'text', text: p.content })
      }

      if (content.length > 0) {
        const mappedType = role === 'assistant' ? 'assistant' : 'user'
        // developer role 消息在 Codex 中是系统指令，标记为 isMeta
        const isMeta = p.role === 'developer'
        normalized.push({
          type: mappedType,
          message: { role: mappedType, content },
          sessionId, cwd, timestamp: ts,
          uuid: (p.id || ts + '-' + normalized.length),
          isMeta,
          _raw: item
        })
      }
      continue
    }

    // function_call / function_call_output 独立事件
    if (item.type === 'function_call' || item.type === 'function_call_output') {
      const content = item.type === 'function_call'
        ? [{ type: 'tool_use', name: item.name || '', id: item.call_id || '', input: parseToolInput(item.arguments) }]
        : [{ type: 'tool_result', tool_use_id: item.call_id || '', content: item.output || '', is_error: item.status === 'error' }]
      normalized.push({
        type: 'assistant',
        message: { role: 'assistant', content },
        sessionId, cwd, timestamp: ts,
        uuid: item.id || ts + '-fc-' + normalized.length,
        _raw: item
      })
    }
  }
  return normalized
}

// ponytail: Codex 工具名映射到 Claude 等效名，让 SessionView 正确渲染
const TOOL_NAME_MAP = {
  exec_command: 'Bash', shell: 'Bash',
  apply_patch: 'Edit', apply_diff: 'Edit',
  read_file: 'Read', write_file: 'Write',
  list_directory: 'Glob', search_files: 'Grep',
  spawn_agent: 'Agent',
}
function mapToolName(name) { return TOOL_NAME_MAP[name] || name }

function parseToolInput(args) {
  if (!args) return {}
  if (typeof args === 'object') return args
  try { return JSON.parse(args) } catch (e) { return { command: args } }
}

function deleteSession(filePath) {
  try {
    if (!fs.existsSync(filePath)) return { success: false, error: 'File not found' }
    fs.unlinkSync(filePath)
    return { success: true }
  } catch (error) {
    return { success: false, error: error.message }
  }
}

function getResumeCommand(sessionId, command) {
  return `${command || 'codex'} resume ${sessionId}`
}

function resumeSession(sessionId, cwd, command, terminalApp) {
  return launchInTerminal(getResumeCommand(sessionId, command), cwd, terminalApp)
}

function newSession(cwd, command, terminalApp) {
  return launchInTerminal(command || 'codex', cwd, terminalApp)
}

function deleteProjectSessions(projectPath, _project) {
  let files = _project?._codexFiles
  if (!files || files.length === 0) {
    const all = []
    walkDateDirs(getRoot(), all)
    files = all.filter(f => f.cwd === projectPath || f.cwd === _project?.cwd)
  }
  let deleted = 0
  const errors = []
  for (const sf of files) {
    try { fs.unlinkSync(sf.filePath); deleted++ }
    catch (e) { errors.push(sf.filePath + ': ' + e.message) }
  }
  return { success: errors.length === 0, deleted, errors }
}

function toggleFavorite() { return { success: false, error: 'Not supported for Codex' } }

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
  toggleFavorite,
  supportsRename: false,
  supportsFork: false,
  supportsMemory: false,
  supportsSnapshot: false
}
