const { fs, path, os, parseJsonl, launchInTerminal, readSessionFileSmart } = require('./common')

const PROVIDER_ID = 'gemini'
const PROVIDER_NAME = 'Gemini CLI'

function getRoot() {
  return path.join(os.homedir(), '.gemini', 'tmp')
}

function isAvailable() {
  // ~/.gemini/ 存在即认为已安装（即使还没有会话数据）
  return fs.existsSync(path.join(os.homedir(), '.gemini'))
}

function scanProjects() {
  const root = getRoot()
  if (!fs.existsSync(root)) return []
  const projects = []

  for (const projectHash of fs.readdirSync(root)) {
    const projectDir = path.join(root, projectHash)
    if (!fs.statSync(projectDir).isDirectory()) continue
    const chatsDir = path.join(projectDir, 'chats')
    if (!fs.existsSync(chatsDir)) continue

    const sessionFiles = fs.readdirSync(chatsDir).filter(f => f.endsWith('.jsonl') || f.endsWith('.json'))
    if (sessionFiles.length === 0) continue

    let latestMtime = new Date(0)
    let cwd = ''
    for (const file of sessionFiles) {
      const m = fs.statSync(path.join(chatsDir, file)).mtime
      if (m > latestMtime) latestMtime = m
    }

    // 读首个 session 文件取 cwd（projectHash 本身无意义）
    if (sessionFiles.length > 0) {
      try {
        const firstFile = path.join(chatsDir, sessionFiles[0])
        const content = fs.readFileSync(firstFile, 'utf-8')
        const items = firstFile.endsWith('.jsonl') ? parseJsonl(content) : [JSON.parse(content)]
        for (const item of items.slice(0, 5)) {
          // JSONL 格式: session_metadata 首行有 projectPath/cwd
          if (item.type === 'session_metadata' && item.projectPath) { cwd = item.projectPath; break }
          // JSON 格式: ConversationRecord 有 directories 数组或通过其他方式
          if (item.projectHash && item.messages) {
            // 旧格式没有直接的 cwd，用 projectHash 目录上级猜
            break
          }
        }
      } catch (e) {}
    }

    projects.push({
      provider: PROVIDER_ID,
      name: 'gemini::' + projectHash,
      displayName: cwd || 'Gemini (' + projectHash.slice(0, 8) + ')',
      cwd,
      path: chatsDir,
      sessionCount: sessionFiles.length,
      sessions: [],
      sessionsLoaded: false,
      sessionsLoading: false,
      latestMtime,
      hasMemory: false,
      memorySize: 0,
      memoryFileCount: 0
    })
  }

  return projects.sort((a, b) => b.latestMtime - a.latestMtime)
}

function loadProjectSessions(projectPath) {
  try {
    const files = fs.readdirSync(projectPath).filter(f => f.endsWith('.jsonl') || f.endsWith('.json'))
    const sessions = files.map(file => {
      const filePath = path.join(projectPath, file)
      const fileStat = fs.statSync(filePath)
      let sessionId = file.replace(/\.(jsonl|json)$/, '')
      let name = sessionId
      let timestamp = fileStat.mtime.toISOString()
      let cwd = ''

      try {
        const content = fs.readFileSync(filePath, 'utf-8')
        if (file.endsWith('.jsonl')) {
          const items = parseJsonl(content)
          // 从 session_metadata 取信息
          for (const item of items.slice(0, 5)) {
            if (item.type === 'session_metadata') {
              sessionId = item.sessionId || sessionId
              if (item.summary) name = item.summary
              if (item.startTime) timestamp = item.startTime
              if (item.lastUpdated) timestamp = item.lastUpdated
              if (item.projectPath) cwd = item.projectPath
              break
            }
          }
          if (name === sessionId) name = extractSessionName(items, name)
        } else {
          // 旧 JSON 格式
          const record = JSON.parse(content)
          sessionId = record.sessionId || sessionId
          if (record.summary) name = record.summary
          if (record.lastUpdated) timestamp = record.lastUpdated
          else if (record.startTime) timestamp = record.startTime
        }
      } catch (e) {}

      return {
        name, path: filePath, sessionId, timestamp, cwd,
        isFavorite: false, size: fileStat.size, modifiedTime: fileStat.mtime,
        subagents: [], provider: PROVIDER_ID
      }
    }).sort((a, b) => new Date(b.modifiedTime) - new Date(a.modifiedTime))

    return { success: true, sessions }
  } catch (error) {
    return { success: false, error: error.message, sessions: [] }
  }
}

function extractSessionName(items, fallback) {
  // Gemini JSONL: 找第一条 role=user 的消息
  for (const item of items) {
    if (item.type === 'session_metadata') continue
    if (item.type === 'message_update') continue
    // MessageRecord 格式
    if (item.role === 'user' && item.parts) {
      for (const part of item.parts) {
        if (part.text && part.text.length < 200) {
          const text = part.text.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
          if (text) return text.length > 50 ? text.slice(0, 50) + '...' : text
        }
      }
    }
    // 也可能是 { type: 'message', role: 'user', content: [...] }
    if (item.type === 'message' && item.role === 'user') {
      const content = item.content || item.parts
      if (Array.isArray(content)) {
        for (const block of content) {
          const text = block.text || (typeof block === 'string' ? block : '')
          if (text && text.length < 200) {
            const clean = text.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
            if (clean) return clean.length > 50 ? clean.slice(0, 50) + '...' : clean
          }
        }
      }
    }
  }
  return fallback
}

function readSessionFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return []
    if (filePath.endsWith('.json')) {
      const content = fs.readFileSync(filePath, 'utf-8')
      return normalizeGeminiJsonRecord(JSON.parse(content))
    }
    const { items: rawItems } = readSessionFileSmart(filePath)
    return normalizeGeminiJsonlItems(rawItems)
  } catch (error) {
    console.error('Error reading Gemini session:', error)
    return []
  }
}

function normalizeGeminiJsonlItems(rawItems) {
  const normalized = []
  let sessionId = '', cwd = ''

  for (const item of rawItems) {
    if (item.type === 'session_metadata') {
      sessionId = item.sessionId || ''
      cwd = item.projectPath || ''
      continue
    }
    if (item.type === 'message_update') continue

    const role = item.role === 'model' ? 'assistant' : (item.role || 'user')
    const mappedType = role === 'assistant' ? 'assistant' : 'user'
    const content = []
    const parts = item.parts || item.content || []

    if (Array.isArray(parts)) {
      for (const part of parts) {
        if (part.text) {
          content.push({ type: 'text', text: part.text })
        } else if (part.thought) {
          content.push({ type: 'thinking', thinking: part.thought })
        } else if (part.functionCall) {
          content.push({
            type: 'tool_use', name: part.functionCall.name || '',
            id: part.functionCall.id || 'fc-' + normalized.length,
            input: part.functionCall.args || {}
          })
        } else if (part.functionResponse) {
          content.push({
            type: 'tool_result', tool_use_id: part.functionResponse.id || '',
            content: typeof part.functionResponse.response === 'string'
              ? part.functionResponse.response
              : JSON.stringify(part.functionResponse.response || ''),
            is_error: false
          })
        } else if (part.executableCode) {
          content.push({ type: 'tool_use', name: 'code_execution', id: 'exec-' + normalized.length, input: { code: part.executableCode.code || '' } })
        } else if (part.codeExecutionResult) {
          content.push({ type: 'tool_result', tool_use_id: 'exec-' + (normalized.length - 1), content: part.codeExecutionResult.output || '', is_error: part.codeExecutionResult.outcome === 'ERROR' })
        }
      }
    }

    if (content.length > 0) {
      const ts = item.timestamp || item.createTime || ''
      normalized.push({
        type: mappedType,
        message: { role: mappedType, content },
        sessionId, cwd, timestamp: ts,
        uuid: item.id || ts + '-' + normalized.length,
        _raw: item
      })
    }
  }
  return normalized
}

function normalizeGeminiJsonRecord(record) {
  // 旧 JSON 格式: ConversationRecord { messages: MessageRecord[] }
  const normalized = []
  const sessionId = record.sessionId || ''
  if (!record.messages) return normalized

  for (let i = 0; i < record.messages.length; i++) {
    const msg = record.messages[i]
    const role = msg.role === 'model' ? 'assistant' : (msg.role || 'user')
    const mappedType = role === 'assistant' ? 'assistant' : 'user'
    const content = []

    if (Array.isArray(msg.parts)) {
      for (const part of msg.parts) {
        if (part.text) content.push({ type: 'text', text: part.text })
        else if (part.functionCall) {
          content.push({ type: 'tool_use', name: part.functionCall.name || '', id: 'fc-' + i, input: part.functionCall.args || {} })
        } else if (part.functionResponse) {
          content.push({ type: 'tool_result', tool_use_id: 'fc-' + i, content: JSON.stringify(part.functionResponse.response || ''), is_error: false })
        }
      }
    }

    if (content.length > 0) {
      normalized.push({
        type: mappedType,
        message: { role: mappedType, content },
        sessionId, cwd: '', timestamp: msg.createTime || '',
        uuid: msg.id || 'msg-' + i
      })
    }
  }
  return normalized
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

function deleteProjectSessions(projectPath) {
  try {
    const files = fs.readdirSync(projectPath).filter(f => f.endsWith('.jsonl') || f.endsWith('.json'))
    let deleted = 0
    const errors = []
    for (const file of files) {
      try { fs.unlinkSync(path.join(projectPath, file)); deleted++ }
      catch (e) { errors.push(file + ': ' + e.message) }
    }
    return { success: errors.length === 0, deleted, errors }
  } catch (error) {
    return { success: false, deleted: 0, errors: [error.message] }
  }
}

function getResumeCommand(sessionId, command, sessionPath) {
  // Gemini 无法按 UUID 恢复；有会话文件路径时用 --session-file 精确加载，否则退回 --resume latest
  const bin = command || 'gemini'
  if (sessionPath) return `${bin} --session-file "${sessionPath}"`
  return `${bin} --resume latest`
}

function resumeSession(sessionId, cwd, command, terminalApp, sessionPath) {
  return launchInTerminal(getResumeCommand(sessionId, command, sessionPath), cwd, terminalApp)
}

function newSession(cwd, command, terminalApp) {
  return launchInTerminal(command || 'gemini', cwd, terminalApp)
}

function toggleFavorite() { return { success: false, error: 'Not supported for Gemini' } }

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
