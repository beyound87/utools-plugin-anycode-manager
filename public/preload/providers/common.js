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
    return spawnDetached(`start cmd /c "${cmd}"`, { cwd: workDir })
  } else if (platform === 'darwin') {
    const escaped = cmd.replace(/"/g, '\\"')
    const escapedDir = workDir.replace(/"/g, '\\"')
    return spawnDetached(`osascript -e 'tell app "Terminal" to do script "cd ${escapedDir} && ${escaped}"'`)
  } else {
    const terminals = ['x-terminal-emulator', 'gnome-terminal', 'konsole', 'xfce4-terminal', 'xterm']
    const tryNext = (i) => {
      if (i >= terminals.length) return Promise.reject(new Error('未找到可用终端'))
      const term = terminals[i]
      const termCmd = term === 'gnome-terminal'
        ? `${term} -- bash -c 'cd "${workDir}" && ${cmd}; exec bash'`
        : `${term} -e 'bash -c "cd \\"${workDir}\\" && ${cmd}; exec bash"'`
      return spawnDetached(termCmd).catch(() => tryNext(i + 1))
    }
    return tryNext(0)
  }
}

// ponytail: 大文件优化 — 超过阈值时只读最后 N 行，首次打开快
const LARGE_FILE_THRESHOLD = 5 * 1024 * 1024 // 5MB
const TAIL_READ_SIZE = 2 * 1024 * 1024 // 读尾部 2MB

function readFileTail(filePath, tailSize) {
  const stat = fs.statSync(filePath)
  if (stat.size <= tailSize) return fs.readFileSync(filePath, 'utf-8')
  const fd = fs.openSync(filePath, 'r')
  const buf = Buffer.alloc(tailSize)
  fs.readSync(fd, buf, 0, tailSize, stat.size - tailSize)
  fs.closeSync(fd)
  const text = buf.toString('utf-8')
  // 跳过第一行（可能是截断的 JSON）
  const firstNewline = text.indexOf('\n')
  return firstNewline >= 0 ? text.slice(firstNewline + 1) : text
}

function readSessionFileSmart(filePath) {
  if (!fs.existsSync(filePath)) return { items: [], truncated: false }
  const stat = fs.statSync(filePath)
  if (stat.size <= LARGE_FILE_THRESHOLD) {
    return { items: parseJsonl(fs.readFileSync(filePath, 'utf-8')), truncated: false }
  }
  // 大文件：先读尾部
  const tailContent = readFileTail(filePath, TAIL_READ_SIZE)
  return { items: parseJsonl(tailContent), truncated: true, totalSize: stat.size }
}

module.exports = { fs, path, os, isSystemText, parseJsonl, spawnDetached, launchInTerminal, readSessionFileSmart, LARGE_FILE_THRESHOLD }
