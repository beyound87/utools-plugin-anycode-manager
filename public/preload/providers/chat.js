// 对话引擎：驱动 CLI 非交互模式，流式回调事件给渲染层
// Phase 1: Claude 续接对话（持久进程 stream-json）。其他 provider 后续接入。
const { fs, os } = require('./common')
const { spawn } = require('node:child_process')

// 模块级单例：同一时刻只维护一个对话进程
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

// 启动 Claude 持久对话进程（stream-json 双向）
// opts: { sessionId, cwd, command, permissionMode, model }
// onEvent(ev): 逐条回调 stdout 的 NDJSON 事件（已 JSON.parse），外加 { type:'_stderr'|'_exit' }
function startClaudeChat(opts, onEvent) {
  stopChat()
  onEventCb = onEvent
  currentProvider = 'claude'
  const bin = opts.command || 'claude'
  const args = ['-p', '--output-format', 'stream-json', '--input-format', 'stream-json', '--verbose', '--include-partial-messages']
  if (opts.sessionId) args.push('--resume', opts.sessionId)
  args.push('--permission-mode', opts.permissionMode || 'plan') // 默认 plan 只读，安全
  if (opts.model) args.push('--model', opts.model)

  const isWin = process.platform === 'win32'
  const workDir = opts.cwd && fs.existsSync(opts.cwd) ? opts.cwd : os.homedir()
  try {
    currentProc = spawn(isWin ? bin + '.cmd' : bin, args, {
      cwd: workDir, stdio: ['pipe', 'pipe', 'pipe'], shell: isWin, windowsHide: true
    })
  } catch (e) {
    onEventCb && onEventCb({ type: '_error', error: e.message })
    currentProc = null
    return { success: false, error: e.message }
  }

  let buf = ''
  currentProc.stdout.on('data', (d) => {
    buf += d.toString('utf-8')
    let nl
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl); buf = buf.slice(nl + 1)
      if (!line.trim()) continue
      let ev
      try { ev = JSON.parse(line) } catch (e) { continue }
      try { onEventCb && onEventCb(ev) } catch (e) {}
    }
  })
  currentProc.stderr.on('data', (d) => {
    try { onEventCb && onEventCb({ type: '_stderr', text: d.toString('utf-8') }) } catch (e) {}
  })
  currentProc.on('exit', (code) => {
    try { onEventCb && onEventCb({ type: '_exit', code }) } catch (e) {}
    currentProc = null
  })
  currentProc.on('error', (err) => {
    try { onEventCb && onEventCb({ type: '_error', error: err.message }) } catch (e) {}
  })
  return { success: true }
}

// 发送一条用户消息（文本 + 图片）到持久进程
// msg: { text, images:[{ mediaType, data(base64) }] }
function sendChatMessage(msg) {
  if (!currentProc) return { success: false, error: '对话进程未启动' }
  const content = []
  if (msg.text) content.push({ type: 'text', text: msg.text })
  for (const img of (msg.images || [])) {
    content.push({ type: 'image', source: { type: 'base64', media_type: img.mediaType || 'image/png', data: img.data } })
  }
  if (content.length === 0) return { success: false, error: '空消息' }
  const payload = { type: 'user', message: { role: 'user', content } }
  try {
    currentProc.stdin.write(JSON.stringify(payload) + '\n')
    return { success: true }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

module.exports = { startClaudeChat, sendChatMessage, stopChat, isRunning }
