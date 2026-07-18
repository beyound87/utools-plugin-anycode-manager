export function formatTime(timestamp) {
  if (!timestamp) return ''
  return new Date(timestamp).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
  })
}

export function formatSize(bytes) {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let i = 0
  while (bytes >= 1024 && i < units.length - 1) { bytes /= 1024; i++ }
  return `${bytes.toFixed(1)} ${units[i]}`
}

export function formatTokens(n) {
  if (n == null) return '0'
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B'
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'
  return String(n)
}

export function formatDuration(ms) {
  if (!ms) return ''
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (h > 0) return `${h}h${m}m${s}s`
  if (m > 0) return `${m}m${s}s`
  return `${s}s`
}

export function shortenPath(p) {
  if (!p) return p
  const sep = p.includes('/') ? '/' : '\\'
  const parts = p.split(sep).filter(Boolean)
  if (parts.length <= 3) return p
  return parts[0] + sep + '...' + sep + parts.slice(-2).join(sep)
}

export function shortenFilePath(p) {
  if (!p || p.length <= 40) return p
  const sep = p.includes('/') ? '/' : '\\'
  const parts = p.split(sep)
  if (parts.length <= 2) return p
  return '...' + sep + parts.slice(-2).join(sep)
}
