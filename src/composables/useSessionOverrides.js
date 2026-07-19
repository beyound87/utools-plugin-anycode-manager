import { ref } from 'vue'

// 跨平台会话别名 / 收藏，存在 utools.dbStorage
// Claude 原本写回 JSONL 的 custom-title/custom-favorite 仍会被 preload 读出（作为 name/isFavorite），
// dbStorage 覆盖层叠加在其上：有别名用别名，收藏取并集。新的重命名/收藏一律走 dbStorage，不再改文件。

const STORAGE_KEY = 'anycode:overrides'

function loadStore() {
  try {
    const raw = window.utools?.dbStorage?.getItem(STORAGE_KEY)
    if (raw && typeof raw === 'object') return raw
    if (typeof raw === 'string') return JSON.parse(raw)
  } catch (e) {}
  return {}
}

// 模块级单例，跨组件共享
const store = ref(loadStore())

function persist() {
  try { window.utools?.dbStorage?.setItem(STORAGE_KEY, JSON.parse(JSON.stringify(store.value))) } catch (e) {}
}

function keyOf(session) {
  if (!session) return ''
  return `${session.provider || 'claude'}:${session.sessionId || session.path || ''}`
}

// 把 dbStorage 覆盖应用到会话对象上（就地返回带覆盖的浅拷贝）
function applyOverride(session) {
  if (!session) return session
  const o = store.value[keyOf(session)]
  if (!o) return session
  return {
    ...session,
    name: o.alias || session.name,
    isFavorite: o.favorite || session.isFavorite,
    _hasAlias: !!o.alias
  }
}

function setAlias(session, alias) {
  const k = keyOf(session)
  if (!k) return
  const o = store.value[k] || {}
  const next = { ...store.value }
  const trimmed = (alias || '').trim()
  if (trimmed) next[k] = { ...o, alias: trimmed }
  else { const copy = { ...o }; delete copy.alias; if (Object.keys(copy).length) next[k] = copy; else delete next[k] }
  store.value = next
  persist()
}

// 切换收藏，返回切换后的状态
function toggleFavorite(session) {
  const k = keyOf(session)
  if (!k) return false
  const o = store.value[k] || {}
  // 当前收藏状态：dbStorage 覆盖优先，否则看会话自身（Claude 老数据）
  const cur = o.favorite !== undefined ? o.favorite : !!session.isFavorite
  const nextFav = !cur
  const next = { ...store.value }
  if (nextFav) next[k] = { ...o, favorite: true }
  else { const copy = { ...o }; delete copy.favorite; if (Object.keys(copy).length) next[k] = copy; else delete next[k] }
  store.value = next
  persist()
  return nextFav
}

export function useSessionOverrides() {
  return { applyOverride, setAlias, toggleFavorite, keyOf }
}
