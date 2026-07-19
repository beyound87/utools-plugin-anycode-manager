// 对话引擎：驱动各 CLI 非交互模式，流式回调事件给渲染层
// Claude: 持久进程 stream-json（多轮 stdin/stdout）
// Codex/Gemini/OpenCode: 每条消息一个进程（spawn → 收完整输出 → 回调）
const { fs, os, path } = require('./common')
const { spawn } = require('node:child_process')

let currentProc = null
let currentProvider = null
let onEventCb = null

function isRunning() { return !!currentProc }

function stopChat() {
  if (currentProc) {
    try { currentProc.stdin.end() } catch (e) {}
    try { currentProc.kill() } catch (e) {}
    currentProc = null
  }
  onEventCb = null
  currentProvider = null
}

const isWin = process.platform === 'win32'
function resolveWorkDir(cwd) { return cwd && fs.existsSync(cwd) ? cwd : os.homedir() }
function spawnBin(bin, args, cwd) {
  return spawn(isWin ? bin + '.cmd' : bin, args, {
    cwd, stdio: ['pipe', 'pipe', 'pipe'], shell: isWin, windowsHide: true
  })
}

// ============ Claude（持久进程 stream-json）============

function startClaudeChat(opts, onEvent) {
  stopChat()
  onEventCb = onEvent
  currentProvider = 'claude'
  const bin = opts.command || 'claude'
  const args = ['-p', '--output-format', 'stream-json', '--input-format', 'stream-json', '--verbose', '--include-partial-messages']
  if (opts.sessionId) args.push('--resume', opts.sessionId)
  args.push('--permission-mode', opts.permissionMode || 'plan')
  if (opts.model) args.push('--model', opts.model)
  if (opts.effort) args.push('--effort', opts.effort)
  const workDir = resolveWorkDir(opts.cwd)
  try { currentProc = spawnBin(bin, args, workDir) } catch (e) {
    onEventCb && onEventCb({ type: '_error', error: e.message })
    currentProc = null
    return { success: false, error: e.message }
  }
  pipeNdjson(currentProc)
  return { success: true }
}

function sendClaudeMessage(msg) {
  if (!currentProc) return { success: false, error: '对话进程未启动' }
  const content = []
  if (msg.text) content.push({ type: 'text', text: msg.text })
  for (const img of (msg.images || [])) {
    content.push({ type: 'image', source: { type: 'base64', media_type: img.mediaType || 'image/png', data: img.data } })
  }
  if (content.length === 0) return { success: false, error: '空消息' }
  try {
    currentProc.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content } }) + '\n')
    return { success: true }
  } catch (e) { return { success: false, error: e.message } }
}

// ============ 通用一次一进程模式（Codex/Gemini/OpenCode）============

function startOneShot(opts, onEvent) {
  stopChat()
  onEventCb = onEvent
  currentProvider = opts.provider
  // 一次一进程不需要 startChat 创建进程，sendChatMessage 时才起
  return { success: true }
}

function sendOneShotMessage(msg, opts) {
  if (currentProc) { try { currentProc.kill() } catch (e) {} }
  const p = opts.provider
  const bin = opts.command || p
  const workDir = resolveWorkDir(opts.cwd)
  let args = []
  let prompt = msg.text || ''

  // 图片：保存到临时文件，通过 -i/-f/@path 传
  const tmpImages = []
  let imgIdx = 0
  for (const img of (msg.images || [])) {
    const tmp = path.join(os.tmpdir(), 'anycode-img-' + Date.now() + '-' + (imgIdx++) + '.' + (img.mediaType || 'image/png').split('/')[1])
    try { fs.writeFileSync(tmp, Buffer.from(img.data, 'base64')); tmpImages.push(tmp) } catch (e) {}
  }

  if (p === 'codex') {
    args = ['exec', prompt]
    for (const f of tmpImages) args.push('-i', f)
    if (opts.sessionId) args.unshift('resume', opts.sessionId, '--')
    if (opts.model) args.push('-m', opts.model)
    if (opts.effort) args.push('-c', 'model_reasoning_effort="' + opts.effort + '"')
    if (opts.sandbox) args.push('-s', opts.sandbox)
  } else if (p === 'gemini') {
    args = ['-p', prompt]
    if (opts.approvalMode) args.push('--approval-mode', opts.approvalMode)
    // 图片和附件通过 @ 引用（引号防空格路径截断）
    for (const f of tmpImages) prompt = '@"' + f + '" ' + prompt
    args[1] = prompt
  } else if (p === 'opencode') {
    args = ['run', prompt]
    if (opts.sessionId) args.push('-s', opts.sessionId)
    for (const f of tmpImages) args.push('-f', f)
    if (opts.model) args.push('-m', opts.model)
    if (opts.effort) args.push('--variant', opts.effort)
    args.push('--format', 'json')
  }

  try { currentProc = spawnBin(bin, args, workDir) } catch (e) {
    onEventCb && onEventCb({ type: '_error', error: e.message })
    cleanTmpImages(tmpImages)
    return { success: false, error: e.message }
  }

  const myProc = currentProc
  let stdout = '', stderr = ''
  currentProc.stdout.on('data', d => { stdout += d.toString('utf-8') })
  currentProc.stderr.on('data', d => { stderr += d.toString('utf-8') })
  currentProc.on('exit', (code) => {
    if (currentProc === myProc) currentProc = null
    cleanTmpImages(tmpImages)
    // 解析输出
    const text = stdout.trim()
    if (text) {
      // 尝试 JSON 事件（OpenCode --format json）
      if (p === 'opencode') {
        parseOpenCodeJson(text, onEventCb)
      } else {
        // Codex/Gemini 纯文本 → 包装为 assistant 消息
        onEventCb && onEventCb({
          type: 'assistant',
          message: { role: 'assistant', content: [{ type: 'text', text }], model: opts.model || '' },
          uuid: 'chat-a-' + Date.now()
        })
      }
    }
    onEventCb && onEventCb({
      type: 'result', subtype: code === 0 ? 'success' : 'error_during_execution',
      is_error: code !== 0, result: text || stderr
    })
  })
  currentProc.on('error', err => {
    cleanTmpImages(tmpImages)
    onEventCb && onEventCb({ type: '_error', error: err.message })
  })
  return { success: true }
}

function parseOpenCodeJson(text, cb) {
  // OpenCode --format json 输出多行 JSON 事件
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      const ev = JSON.parse(line)
      // 归一化 OpenCode 事件为 assistant 消息
      if (ev.role === 'assistant' || ev.type === 'message') {
        cb && cb({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: ev.text || ev.content || JSON.stringify(ev) }] }, uuid: 'oc-' + Date.now() })
      }
    } catch (e) {}
  }
}

function cleanTmpImages(files) {
  for (const f of files) { try { fs.unlinkSync(f) } catch (e) {} }
}

// ============ 统一 API ============

function startChat(opts, onEvent) {
  if (opts.provider === 'claude' || !opts.provider) return startClaudeChat(opts, onEvent)
  return startOneShot(opts, onEvent)
}

function sendChatMessage(msg, opts) {
  if (currentProvider === 'claude') return sendClaudeMessage(msg)
  return sendOneShotMessage(msg, opts || {})
}

// stdout NDJSON 管道（Claude 持久进程用）
// #1 fix: 闭包捕获 proc 引用做身份校验，避免旧进程事件打入新进程回调
function pipeNdjson(proc) {
  const myProc = proc
  let buf = ''
  proc.stdout.on('data', (d) => {
    if (currentProc !== myProc) return
    buf += d.toString('utf-8')
    let nl
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl); buf = buf.slice(nl + 1)
      if (!line.trim()) continue
      try { onEventCb && onEventCb(JSON.parse(line)) } catch (e) {}
    }
  })
  proc.stderr.on('data', (d) => {
    if (currentProc !== myProc) return
    try { onEventCb && onEventCb({ type: '_stderr', text: d.toString('utf-8') }) } catch (e) {}
  })
  proc.on('exit', (code) => {
    if (currentProc !== myProc) return
    try { onEventCb && onEventCb({ type: '_exit', code }) } catch (e) {}
    currentProc = null
  })
  proc.on('error', (err) => {
    if (currentProc !== myProc) return
    try { onEventCb && onEventCb({ type: '_error', error: err.message }) } catch (e) {}
  })
}

// ============ 模型列表 ============

// ponytail: 优先从配置文件直接读已配模型（不依赖网络），补常见预设
function listModels(providerId, callback) {
  const models = new Set()
  try {
    if (providerId === 'claude') {
      const settings = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude', 'settings.json'), 'utf-8'))
      const env = settings.env || {}
      // 收集所有配置的模型名
      for (const k of Object.keys(env)) {
        if (/MODEL/i.test(k) && env[k] && typeof env[k] === 'string') {
          models.add(env[k].replace(/\[.*$/, '')) // 去掉 [1M] 等后缀
        }
      }
      if (settings.model) models.add(settings.model)
      // 常见补充
      for (const m of ['claude-sonnet-4-6', 'claude-opus-4-6', 'claude-haiku-4-5-20251001', 'claude-fable-5']) models.add(m)
    } else if (providerId === 'codex') {
      const toml = fs.readFileSync(path.join(os.homedir(), '.codex', 'config.toml'), 'utf-8')
      const m = toml.match(/^model\s*=\s*"([^"]+)"/m)
      if (m) models.add(m[1])
      for (const preset of ['gpt-4.1', 'o3', 'o4-mini', 'gpt-5.6-sol', 'codex-mini-latest']) models.add(preset)
    } else if (providerId === 'gemini') {
      for (const m of ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash']) models.add(m)
    } else if (providerId === 'opencode') {
      // OpenCode 模型在 provider 配置里，格式多样，先给常见的
      for (const m of ['anthropic/claude-sonnet-4-20250514', 'openai/gpt-4.1', 'google/gemini-2.5-pro']) models.add(m)
    }
  } catch (e) {}
  callback([...models].filter(Boolean))
}

// 新建会话（不续接任何已有会话）
function newChatSession(opts, onEvent) {
  const newOpts = { ...opts, sessionId: undefined }
  return startChat(newOpts, onEvent)
}

module.exports = { startChat, sendChatMessage, stopChat, isRunning, newChatSession, listModels }
