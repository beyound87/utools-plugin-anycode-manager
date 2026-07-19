const { fs, path, os, launchInTerminal } = require('./common')

const PROVIDER_ID = 'opencode'
const PROVIDER_NAME = 'OpenCode'

function getRoot() {
  if (process.platform === 'win32') {
    return path.join(os.homedir(), '.local', 'share', 'opencode')
  }
  return path.join(os.homedir(), '.local', 'share', 'opencode')
}

function getDbPath() {
  return path.join(getRoot(), 'opencode.db')
}

function isAvailable() {
  return fs.existsSync(getDbPath())
}

// ponytail: 延迟加载 better-sqlite3，不存在则降级为不可用
let Database = null
function getDb() {
  if (!Database) {
    try { Database = require('better-sqlite3') } catch (e) {
      console.error('better-sqlite3 not available, OpenCode provider disabled')
      return null
    }
  }
  const dbPath = getDbPath()
  if (!fs.existsSync(dbPath)) return null
  try { return new Database(dbPath, { readonly: true }) } catch (e) {
    console.error('Failed to open OpenCode DB:', e)
    return null
  }
}

function scanProjects() {
  const db = getDb()
  if (!db) return []
  try {
    // 按 directory 分组查询项目
    const rows = db.prepare(`
      SELECT s.directory, s.project_id,
        COUNT(*) as session_count,
        MAX(s.time_updated) as latest_time
      FROM session s
      WHERE s.parent_id IS NULL
      GROUP BY s.directory
      ORDER BY latest_time DESC
    `).all()

    return rows.map(row => ({
      provider: PROVIDER_ID,
      name: 'opencode::' + (row.project_id || row.directory.replace(/[/\\:]/g, '-')),
      displayName: row.directory,
      cwd: row.directory,
      path: row.directory, // 用 directory 作为 projectPath 标识
      sessionCount: row.session_count,
      sessions: [],
      sessionsLoaded: false,
      sessionsLoading: false,
      latestMtime: new Date(row.latest_time),
      hasMemory: false,
      memorySize: 0,
      memoryFileCount: 0,
      _opencodeProjectId: row.project_id
    }))
  } catch (e) {
    console.error('OpenCode scanProjects failed:', e)
    return []
  } finally {
    db.close()
  }
}

function loadProjectSessions(projectPath, _project) {
  const db = getDb()
  if (!db) return { success: false, error: 'DB not available', sessions: [] }
  try {
    const directory = projectPath
    const rows = db.prepare(`
      SELECT id, title, slug, directory, parent_id,
        time_created, time_updated, model, agent, cost,
        tokens_input, tokens_output, tokens_reasoning,
        tokens_cache_read, tokens_cache_write
      FROM session
      WHERE directory = ? AND parent_id IS NULL
      ORDER BY time_updated DESC
    `).all(directory)

    const sessions = rows.map(row => ({
      name: row.title || row.slug || row.id,
      path: row.id, // OpenCode 用 session ID 标识，不是文件路径
      sessionId: row.id,
      timestamp: new Date(row.time_updated).toISOString(),
      cwd: row.directory,
      isFavorite: false,
      size: 0,
      modifiedTime: new Date(row.time_updated),
      subagents: [],
      provider: PROVIDER_ID,
      _opencodeModel: row.model,
      _opencodeAgent: row.agent,
      _opencodeCost: row.cost,
      _opencodeTokens: {
        input: row.tokens_input, output: row.tokens_output,
        reasoning: row.tokens_reasoning,
        cacheRead: row.tokens_cache_read, cacheWrite: row.tokens_cache_write
      }
    }))

    // 查子代理
    for (const session of sessions) {
      const subs = db.prepare(`
        SELECT id, title, slug, time_updated, model, agent
        FROM session WHERE parent_id = ? ORDER BY time_updated DESC
      `).all(session.sessionId)
      session.subagents = subs.map(sub => ({
        agentId: sub.id,
        name: sub.title || sub.agent || sub.slug || sub.id,
        path: sub.id,
        size: 0,
        modifiedTime: new Date(sub.time_updated),
        isSubagent: true,
        parentSessionPath: session.sessionId,
        provider: PROVIDER_ID
      }))
    }

    return { success: true, sessions }
  } catch (e) {
    console.error('OpenCode loadProjectSessions failed:', e)
    return { success: false, error: e.message, sessions: [] }
  } finally {
    db.close()
  }
}

function readSessionFile(sessionIdOrPath) {
  const db = getDb()
  if (!db) return []
  try {
    const sessionId = sessionIdOrPath
    // 读取 messages
    const messages = db.prepare(`
      SELECT id, data, time_created, time_updated
      FROM message WHERE session_id = ?
      ORDER BY time_created ASC
    `).all(sessionId)

    const normalized = []
    for (const msg of messages) {
      let msgData
      try { msgData = JSON.parse(msg.data) } catch (e) { continue }

      const role = msgData.role === 'assistant' ? 'assistant' : 'user'
      const content = []

      // 读取该消息的 parts
      const parts = db.prepare(`
        SELECT id, data, time_created FROM part
        WHERE message_id = ? ORDER BY time_created ASC
      `).all(msg.id)

      for (const part of parts) {
        let partData
        try { partData = JSON.parse(part.data) } catch (e) { continue }

        if (partData.type === 'text') {
          content.push({ type: 'text', text: partData.text || '' })
        } else if (partData.type === 'thinking' || partData.type === 'reasoning') {
          content.push({ type: 'thinking', thinking: partData.text || partData.reasoning || '' })
        } else if (partData.type === 'tool') {
          const state = partData.state || {}
          if (state.status === 'completed' || state.status === 'error') {
            content.push({
              type: 'tool_use', name: partData.tool || '',
              id: partData.callID || part.id,
              input: state.input || {}
            })
            content.push({
              type: 'tool_result', tool_use_id: partData.callID || part.id,
              content: typeof state.output === 'string' ? state.output : JSON.stringify(state.output || ''),
              is_error: state.status === 'error'
            })
          }
        } else if (partData.type === 'step-start' || partData.type === 'step-finish') {
          // 步骤元数据，附加 token 统计
          if (partData.tokens && content.length > 0) {
            // 在最近的 assistant 消息上记录 token stats
          }
        }
      }

      // 如果没有 parts 中的内容，fallback 到 message data 本身
      if (content.length === 0 && msgData.role) {
        content.push({ type: 'text', text: msgData.summary || '' })
      }

      if (content.length > 0) {
        const tokens = msgData.tokens || {}
        normalized.push({
          type: role,
          message: { role, content },
          sessionId,
          cwd: msgData.path?.cwd || '',
          timestamp: new Date(msg.time_created).toISOString(),
          uuid: msg.id,
          _stats: {
            input_tokens: tokens.input || 0,
            output_tokens: tokens.output || 0,
            model: msgData.modelID || '',
            durationMs: msgData.time?.completed && msgData.time?.created
              ? msgData.time.completed - msgData.time.created : 0
          },
          _raw: msgData
        })
      }
    }
    return normalized
  } catch (e) {
    console.error('OpenCode readSessionFile failed:', e)
    return []
  } finally {
    db.close()
  }
}

function deleteSession(sessionId) {
  // OpenCode 从 DB 删除需要写权限
  let db
  try {
    const Database = require('better-sqlite3')
    db = new Database(getDbPath())
    db.prepare('DELETE FROM session WHERE id = ?').run(sessionId)
    return { success: true }
  } catch (e) {
    return { success: false, error: e.message }
  } finally {
    if (db) db.close()
  }
}

function deleteProjectSessions(projectPath) {
  let db
  try {
    const Database = require('better-sqlite3')
    db = new Database(getDbPath())
    const result = db.prepare('DELETE FROM session WHERE directory = ?').run(projectPath)
    return { success: true, deleted: result.changes, errors: [] }
  } catch (e) {
    return { success: false, deleted: 0, errors: [e.message] }
  } finally {
    if (db) db.close()
  }
}

function extractSessionName(items, fallback) {
  for (const item of items) {
    if (item.type === 'user' && item.message?.content) {
      for (const block of item.message.content) {
        if (block.type === 'text' && block.text && block.text.length < 200) {
          const text = block.text.trim()
          if (text) return text.length > 50 ? text.slice(0, 50) + '...' : text
        }
      }
    }
  }
  return fallback
}

function getResumeCommand(sessionId, command) {
  return `${command || 'opencode'} -s ${sessionId}`
}

function resumeSession(sessionId, cwd, command, terminalApp) {
  return launchInTerminal(getResumeCommand(sessionId, command), cwd, terminalApp)
}

function newSession(cwd, command, terminalApp) {
  return launchInTerminal(command || 'opencode', cwd, terminalApp)
}

function toggleFavorite() { return { success: false, error: 'Not supported for OpenCode' } }

// 跨会话搜索：SQL LIKE 匹配 part.data（文本/工具内容都在里面），按会话聚合
function searchSessions(query, opts = {}) {
  const db = getDb()
  if (!db) return []
  try {
    const like = '%' + query.replace(/[%_]/g, '\\$&') + '%'
    // part.data 里含消息文本、工具输入输出等；join session 拿标题和目录
    const rows = db.prepare(`
      SELECT s.id, s.title, s.directory, s.time_updated,
        COUNT(*) as cnt,
        MAX(CASE WHEN p.data LIKE ? ESCAPE '\\' THEN p.data END) as sample
      FROM part p JOIN session s ON p.session_id = s.id
      WHERE p.data LIKE ? ESCAPE '\\'
      GROUP BY s.id
      ORDER BY s.time_updated DESC
      LIMIT ?
    `).all(like, like, opts.limit || 100)
    return rows.map(r => {
      let snippet = ''
      try {
        const d = JSON.parse(r.sample || '{}')
        snippet = (d.text || d.state?.output || d.state?.input?.command || JSON.stringify(d)).toString()
      } catch (e) { snippet = (r.sample || '').toString() }
      const qi = snippet.toLowerCase().indexOf(query.toLowerCase())
      if (qi >= 0) snippet = snippet.slice(Math.max(0, qi - 60), qi + query.length + 60)
      snippet = snippet.replace(/\s+/g, ' ').trim()
      return {
        provider: PROVIDER_ID, projectName: r.directory, projectPath: r.directory,
        sessionPath: r.id, sessionId: r.id, name: r.title || r.id,
        cwd: r.directory, modifiedTime: new Date(r.time_updated), count: r.cnt, snippet
      }
    })
  } catch (e) {
    console.error('OpenCode search failed:', e)
    return []
  } finally {
    db.close()
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
  searchSessions,
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
