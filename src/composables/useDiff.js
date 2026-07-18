// 共享 diff 工具：LCS 核心 + 多种高级 API

// 返回最长公共子序列的匹配对 [{ ai, bi }, ...]
export function lcs(a, b) {
  const m = a.length, n = b.length
  const dp = Array.from({ length: m + 1 }, () => new Uint32Array(n + 1))
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1])
  const result = []
  let i = m, j = n
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) { result.unshift({ ai: i - 1, bi: j - 1 }); i--; j-- }
    else if (dp[i - 1][j] >= dp[i][j - 1]) i--
    else j--
  }
  return result
}

// 单行字符级 diff，返回 { oldParts, newParts }，每部分为 [{text, hl}]
export function inlineDiff(oldLine, newLine) {
  if (!oldLine && !newLine) return { oldParts: [{ text: '', hl: false }], newParts: [{ text: '', hl: false }] }
  let pre = 0
  while (pre < oldLine.length && pre < newLine.length && oldLine[pre] === newLine[pre]) pre++
  let suf = 0
  while (suf < oldLine.length - pre && suf < newLine.length - pre &&
         oldLine[oldLine.length - 1 - suf] === newLine[newLine.length - 1 - suf]) suf++
  const oldMid = oldLine.slice(pre, oldLine.length - suf)
  const newMid = newLine.slice(pre, newLine.length - suf)
  const prefix = oldLine.slice(0, pre)
  const suffix = oldLine.slice(oldLine.length - suf)
  return {
    oldParts: [
      ...(prefix ? [{ text: prefix, hl: false }] : []),
      ...(oldMid ? [{ text: oldMid, hl: true }] : []),
      ...(suffix ? [{ text: suffix, hl: false }] : [])
    ],
    newParts: [
      ...(prefix ? [{ text: prefix, hl: false }] : []),
      ...(newMid ? [{ text: newMid, hl: true }] : []),
      ...(suffix ? [{ text: suffix, hl: false }] : [])
    ]
  }
}

// 行级 diff，返回 { type: 'same'|'add'|'del', text }[]
export function lineDiff(oldStr, newStr) {
  const a = (oldStr || '').split('\n')
  const b = (newStr || '').split('\n')
  const common = lcs(a, b)
  const result = []
  let ai = 0, bi = 0
  for (const { ai: ca, bi: cb } of common) {
    while (ai < ca) { result.push({ type: 'del', text: a[ai++] }) }
    while (bi < cb) { result.push({ type: 'add', text: b[bi++] }) }
    result.push({ type: 'same', text: a[ca] })
    ai = ca + 1; bi = cb + 1
  }
  while (ai < a.length) { result.push({ type: 'del', text: a[ai++] }) }
  while (bi < b.length) { result.push({ type: 'add', text: b[bi++] }) }
  return result
}

// 左右对齐 diff，返回 { left: {type,text}, right: {type,text} }[]
// left: 'del'|'same'|'empty'，right: 'add'|'same'|'empty'
export function sideBySideDiff(oldStr, newStr) {
  const a = (oldStr || '').split('\n')
  const b = (newStr || '').split('\n')
  const common = lcs(a, b)
  const rows = []
  let ai = 0, bi = 0

  function flush(toAi, toBi) {
    const dels = a.slice(ai, toAi)
    const adds = b.slice(bi, toBi)
    const paired = Math.min(dels.length, adds.length)
    for (let k = 0; k < paired; k++) {
      const { oldParts, newParts } = inlineDiff(dels[k], adds[k])
      rows.push({ left: { type: 'del', text: dels[k], parts: oldParts }, right: { type: 'add', text: adds[k], parts: newParts } })
    }
    for (let k = paired; k < dels.length; k++)
      rows.push({ left: { type: 'del', text: dels[k] }, right: { type: 'empty', text: '' } })
    for (let k = paired; k < adds.length; k++)
      rows.push({ left: { type: 'empty', text: '' }, right: { type: 'add', text: adds[k] } })
  }

  for (const { ai: ca, bi: cb } of common) {
    flush(ca, cb)
    rows.push({ left: { type: 'same', text: a[ca] }, right: { type: 'same', text: b[cb] } })
    ai = ca + 1; bi = cb + 1
  }
  flush(a.length, b.length)
  return rows
}
