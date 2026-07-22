const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { spawn } = require('node:child_process')

function isSystemText(text) {
  const t = (text || '').trimStart()
  if (t.startsWith('<')) return true
  // ponytail: [Request interrupted / [Error / [System 是系统注入，[Image 等是用户输入
  if (t.startsWith('[') && /^\[(Request |Error|System|tool_|WARNING)/.test(t)) return true
  return false
}

// ponytail: parseJsonl 兼容标准单行和美化多行两种格式
function parseJsonl(content) {
  const lines = content.split('\n')
  const results = []
  let hasParseError = false
  for (const line of lines) {
    if (!line.trim()) continue
    try {
      results.push(JSON.parse(line))
    } catch (e) {
      hasParseError = true
      break
    }
  }
  if (!hasParseError) return results
  const objects = []
  let depth = 0
  let start = -1
  for (let i = 0; i < content.length; i++) {
    const ch = content[i]
    if (ch === '{') {
      if (depth === 0) start = i
      depth++
    } else if (ch === '}') {
      depth--
      if (depth === 0 && start >= 0) {
        try { objects.push(JSON.parse(content.slice(start, i + 1))) } catch (e) {}
        start = -1
      }
    }
  }
  return objects
}

function spawnDetached(cmd, opts = {}) {
  return new Promise((resolve, reject) => {
    const isWin = process.platform === 'win32'
    const proc = isWin
      ? spawn('cmd', ['/u', '/d', '/s', '/c', `"${cmd}"`], { stdio: ['ignore', 'ignore', 'pipe'], windowsVerbatimArguments: true, windowsHide: true, ...opts })
      : spawn(cmd, [], { shell: true, stdio: ['ignore', 'ignore', 'pipe'], ...opts })
    proc.unref()

    let stderr = ''
    proc.stderr?.on('data', (d) => { stderr += d.toString(isWin ? 'utf16le' : 'utf8') })

    let settled = false
    const settle = (err) => {
      if (settled) return
      settled = true
      err ? reject(err) : resolve()
    }

    proc.on('error', (err) => settle(err))
    const timer = setTimeout(() => settle(null), 400)
    proc.on('exit', (code) => {
      clearTimeout(timer)
      if (code !== 0) settle(new Error(stderr.trim() || `进程退出码 ${code}`))
      else settle(null)
    })
  })
}

function launchInTerminal(cmd, cwd, terminalApp) {
  const workDir = cwd && fs.existsSync(cwd) ? cwd : os.homedir()
  const platform = process.platform
  const app = (terminalApp || 'auto').trim()
  const isAuto = app === '' || app.toLowerCase() === 'auto'

  if (!isAuto) {
    const finalCmd = app
      .replace(/\$\{cc_cmd\}/g, cmd)
      .replace(/\$\{cwd_raw\}/g, workDir)
      .replace(/\$\{cwd\}/g, workDir.replace(/\\/g, '/'))
    return spawnDetached(finalCmd, { cwd: workDir })
  }

  if (platform === 'win32') {
    // start "" /d "<dir>" 设定新窗口工作目录（会话按目录存储，必须在项目目录下恢复）
    // /k 保持窗口打开：claude 退出后 shell 仍在，出错也能看到信息
    return spawnDetached(`start "" /d "${workDir}" cmd /k "${cmd}"`, { cwd: workDir })
  } else if (platform === 'darwin') {
    // ponytail: 双引号包裹 osascript 参数，避免路径含单引号时断裂
    const escSh = s => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/'/g, "'\\''")
    return spawnDetached(`osascript -e "tell app \\"Terminal\\" to do script \\"cd '${escSh(workDir)}' && ${escSh(cmd)}\\"" `)
  } else {
    // ponytail: 用 bash -c "..." 双引号包裹，避免路径含单引号时断裂
    const escBash = s => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/`/g, '\\`').replace(/'/g, "'\\''")
    const terminals = ['x-terminal-emulator', 'gnome-terminal', 'konsole', 'xfce4-terminal', 'xterm']
    const tryNext = (i) => {
      if (i >= terminals.length) return Promise.reject(new Error('未找到可用终端'))
      const term = terminals[i]
      const termCmd = term === 'gnome-terminal'
        ? `${term} -- bash -c "cd '${escBash(workDir)}' && ${escBash(cmd)}; exec bash"`
        : `${term} -e bash -c "cd '${escBash(workDir)}' && ${escBash(cmd)}; exec bash"`
      return spawnDetached(termCmd).catch(() => tryNext(i + 1))
    }
    return tryNext(0)
  }
}

// ponytail: 大文件只读尾部，小文件全量读
const SMART_READ_THRESHOLD = 2 * 1024 * 1024 // 2MB 以下全量读
const SMART_READ_TAIL = 2 * 1024 * 1024      // 大文件只读最后 2MB（覆盖数百条消息，配合前端分页足够）

function readSessionFileSmart(filePath) {
  if (!fs.existsSync(filePath)) return { items: [], truncated: false }
  const stat = fs.statSync(filePath)
  if (stat.size <= SMART_READ_THRESHOLD) {
    return { items: parseJsonl(fs.readFileSync(filePath, 'utf-8')), truncated: false }
  }
  // 大文件：只读尾部
  const fd = fs.openSync(filePath, 'r')
  try {
    const tailSize = Math.min(stat.size, SMART_READ_TAIL)
    const buf = Buffer.alloc(tailSize)
    fs.readSync(fd, buf, 0, tailSize, stat.size - tailSize)
    let text = buf.toString('utf-8')
    // 跳过首行（可能是截断的不完整 JSON）
    if (stat.size > tailSize) {
      const nl = text.indexOf('\n')
      if (nl >= 0) text = text.slice(nl + 1)
    }
    return { items: parseJsonl(text), truncated: stat.size > tailSize }
  } finally {
    fs.closeSync(fd)
  }
}

// ponytail: 会话内容 grep — 大文件只读首尾各 1MB（覆盖多数会话全文，超大文件搜首尾）
// 直接在原始 JSONL 文本上 indexOf，返回匹配数 + 片段（清理成可读文本）
const SEARCH_CAP = 1 * 1024 * 1024
function grepSessionFile(filePath, query, caseSensitive) {
  try {
    const stat = fs.statSync(filePath)
    let text
    if (stat.size <= SEARCH_CAP * 2) {
      text = fs.readFileSync(filePath, 'utf-8')
    } else {
      const fd = fs.openSync(filePath, 'r')
      const head = Buffer.alloc(SEARCH_CAP), tail = Buffer.alloc(SEARCH_CAP)
      fs.readSync(fd, head, 0, SEARCH_CAP, 0)
      fs.readSync(fd, tail, 0, SEARCH_CAP, stat.size - SEARCH_CAP)
      fs.closeSync(fd)
      text = head.toString('utf-8') + '\n' + tail.toString('utf-8')
    }
    const hay = caseSensitive ? text : text.toLowerCase()
    const needle = caseSensitive ? query : query.toLowerCase()
    let idx = hay.indexOf(needle)
    if (idx < 0) return null
    let count = 0, from = idx
    while (from >= 0) { count++; from = hay.indexOf(needle, from + needle.length) }
    // 片段：原文匹配处 ±60 字符，去掉 JSON 转义噪声
    const start = Math.max(0, idx - 60)
    let snippet = text.slice(start, idx + needle.length + 60)
    snippet = snippet.replace(/\\n|\\t|\\r/g, ' ').replace(/\\"/g, '"').replace(/[{}\[\]"]/g, ' ').replace(/\s+/g, ' ').trim()
    return { count, snippet }
  } catch (e) { return null }
}

module.exports = { fs, path, os, isSystemText, parseJsonl, spawnDetached, launchInTerminal, readSessionFileSmart, grepSessionFile }
