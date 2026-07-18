<script setup>
import { ref, reactive, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { useSnackbar } from '../composables/useSnackbar'
import { sideBySideDiff } from '../composables/useDiff'
import { renderMarkdown } from '../composables/useMarkdown'
import { IconMemory, IconDelete, IconCopy, IconChevronUp, IconSettings } from './icons'

function escHtml(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function renderMemoryContent(text, isIndex = false) {
  if (!text) return ''
  const fmMatch = text.match(/^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/)
  let frontmatterHtml = ''
  let body = text
  if (fmMatch) {
    const rows = fmMatch[1].split('\n').map(line => {
      const m = line.match(/^([^:]+):([\s\S]*)$/)
      if (m) return `<div class="fm-row"><span class="fm-key">${escHtml(m[1].trim())}</span><span class="fm-colon">: </span><span class="fm-val">${escHtml(m[2].trim())}</span></div>`
      return `<div class="fm-row fm-plain">${escHtml(line)}</div>`
    }).join('')
    frontmatterHtml = `<div class="frontmatter-block">${rows}</div>`
    body = text.slice(fmMatch[0].length)
  }
  let bodyHtml = body ? renderMarkdown(body) : ''
  if (isIndex) {
    // 在含有相对 .md 链接的列表项前注入管理按钮
    bodyHtml = bodyHtml.replace(
      /(<li>)(<a href="([^"#][^"]*\.md)")/g,
      (_, openLi, aTag, filename) =>
        `${openLi}<button class="mem-manage-btn" data-file="${escHtml(filename)}" title="管理此记忆"><span class="mgr-bullet">•</span><svg class="mgr-gear" viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M19.14 12.94c.04-.3.06-.61.06-.94s-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg></button>${aTag}`
    )
  }
  return frontmatterHtml + bodyHtml
}

const props = defineProps({
  project: Object,
  files: Array,
  loading: Boolean
})

const emit = defineEmits(['reload', 'cleared'])

const { showSnackbar } = useSnackbar()

const edits = reactive({})
const saving = reactive({})
const editing = reactive({})
const textareaRefs = {}
const fileCardRefs = {}
const highlightFile = ref(null)
const memoryFilesRef = ref(null)
const showBackToTop = ref(false)
const deleteConfirm = ref(null)
const manageMenu = ref({ filename: null, style: {} })
const deleteMemoryConfirm = ref(null) // filename string

// 解析 MEMORY.md 中引用的文件名集合
const referencedFiles = computed(() => {
  const memMd = (props.files || []).find(f => f.name === 'MEMORY.md')
  if (!memMd) return new Set()
  const s = new Set()
  const re = /\[.*?\]\(([^)#][^)]*\.md)\)/g
  let m
  while ((m = re.exec(edits[memMd.path] || '')) !== null) s.add(m[1])
  return s
})

function isReferencedByMemoryMd(filename) {
  return referencedFiles.value.has(filename)
}

function onMemoryScroll(e) {
  showBackToTop.value = e.target.scrollTop > 200
}

function scrollToTop() {
  memoryFilesRef.value?.scrollTo({ top: 0, behavior: 'smooth' })
}

function triggerHighlight(name) {
  highlightFile.value = name
  setTimeout(() => { highlightFile.value = null }, 1400)
}

function closeManageMenu() {
  manageMenu.value.filename = null
}

function handlePreviewLinkClick(e) {
  // 管理按钮点击
  const manageBtn = e.target.closest('.mem-manage-btn')
  if (manageBtn) {
    e.preventDefault()
    e.stopPropagation()
    const filename = manageBtn.dataset.file
    if (manageMenu.value.filename === filename) { closeManageMenu(); return }
    const rect = manageBtn.getBoundingClientRect()
    manageMenu.value = { filename, style: { left: rect.left + 'px', top: (rect.bottom + 4) + 'px' } }
    return
  }
  // 关闭菜单
  closeManageMenu()
  // 相对链接导航
  const a = e.target.closest('a')
  if (!a) return
  const href = a.getAttribute('href')
  if (!href || href.startsWith('http') || href.startsWith('//') || href.startsWith('#')) return
  e.preventDefault()
  const targetName = href.split('/').pop()
  const el = fileCardRefs[targetName]
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  const container = memoryFilesRef.value
  if (!container) { triggerHighlight(targetName); return }
  let scrollTimer = null
  const onScroll = () => {
    clearTimeout(scrollTimer)
    scrollTimer = setTimeout(() => {
      container.removeEventListener('scroll', onScroll)
      triggerHighlight(targetName)
    }, 100)
  }
  container.addEventListener('scroll', onScroll)
  scrollTimer = setTimeout(() => {
    container.removeEventListener('scroll', onScroll)
    triggerHighlight(targetName)
  }, 150)
}

function openDeleteMemoryConfirm() {
  const filename = manageMenu.value.filename
  closeManageMenu()
  deleteMemoryConfirm.value = filename
}

function executeDeleteMemory() {
  const filename = deleteMemoryConfirm.value
  deleteMemoryConfirm.value = null
  const memMd = (props.files || []).find(f => f.name === 'MEMORY.md')
  if (memMd) {
    // 从 MEMORY.md 中移除引用该文件的行
    const escaped = filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const newContent = (edits[memMd.path] || '').replace(
      new RegExp(`^[^\n]*\\[.*?\\]\\(${escaped}\\)[^\n]*\n?`, 'm'), ''
    )
    const saveResult = window.services.saveMemoryFile(memMd.path, newContent)
    if (!saveResult.success) { showSnackbar('更新 MEMORY.md 失败', 'error'); return }
    memMd.content = newContent
    edits[memMd.path] = newContent
  }
  const target = (props.files || []).find(f => f.name === filename)
  if (target) {
    const result = window.services.deleteMemoryFile(target.path)
    if (!result.success) { showSnackbar('删除文件失败', 'error'); return }
  }
  showSnackbar('已删除')
  emit('reload')
}

function autoResize(el) {
  if (!el) return
  el.style.height = 'auto'
  el.style.height = el.scrollHeight + 'px'
}
const clearConfirm = ref(false)

watch(() => props.files, (files) => {
  if (!files) return
  const paths = new Set(files.map(f => f.path))
  for (const f of files) {
    if (!(f.path in edits)) edits[f.path] = f.content
  }
  for (const key of Object.keys(edits)) {
    if (!paths.has(key)) delete edits[key]
  }
  nextTick(() => {
    for (const el of Object.values(textareaRefs)) autoResize(el)
  })
}, { immediate: true })

function isDirty(file) {
  return edits[file.path] !== file.content
}

function startEdit(file) {
  editing[file.path] = true
  nextTick(() => {
    const el = textareaRefs[file.path]
    if (el) { autoResize(el); el.focus() }
  })
}

function cancelEdit(file) {
  edits[file.path] = file.content
  editing[file.path] = false
}

let savingInternally = false

function saveFile(file) {
  savingInternally = true
  saving[file.path] = true
  const result = window.services.saveMemoryFile(file.path, edits[file.path])
  saving[file.path] = false
  if (result.success) {
    file.content = edits[file.path]
    editing[file.path] = false
    showSnackbar('已保存')
  } else {
    showSnackbar('保存失败：' + result.error, 'error')
  }
  setTimeout(() => { savingInternally = false }, 500)
}

function confirmDelete() {
  const file = deleteConfirm.value
  deleteConfirm.value = null
  const result = window.services.deleteMemoryFile(file.path)
  if (result.success) {
    showSnackbar('已删除')
    emit('reload')
  } else {
    showSnackbar('删除失败：' + result.error, 'error')
  }
}

function doClearMemory() {
  clearConfirm.value = false
  const result = window.services.clearMemory(props.project.path)
  if (result.success) {
    showSnackbar('已清空所有记忆')
    emit('cleared')
  } else {
    showSnackbar('清空失败：' + result.error, 'error')
  }
}

// ── 冲突队列 ──────────────────────────────────────────────────
const conflictQueue = ref([])
const currentConflict = ref(null)

const sideDiff = computed(() =>
  currentConflict.value
    ? sideBySideDiff(currentConflict.value.userEdit, currentConflict.value.diskContent)
    : []
)

function resolveConflict(useMyEdit) {
  const c = currentConflict.value
  if (!c) return
  if (!useMyEdit) {
    edits[c.file.path] = c.diskContent
    c.file.content = c.diskContent
    editing[c.file.path] = false
  } else {
    c.file.content = c.diskContent
  }
  conflictQueue.value.shift()
  currentConflict.value = conflictQueue.value[0] || null
}

// ── 文件变更监听 ──────────────────────────────────────────────
function handleExternalChange() {
  if (savingInternally) return
  const result = window.services.getMemoryFiles(props.project.path)
  if (!result.success) return

  const newFiles = result.files
  const oldByPath = {}
  for (const f of (props.files || [])) oldByPath[f.path] = f

  for (const nf of newFiles) {
    const old = oldByPath[nf.path]
    if (!old) continue
    if (nf.content === old.content) continue

    const userEdit = edits[nf.path]
    const dirty = userEdit !== undefined && userEdit !== old.content

    if (dirty) {
      const alreadyQueued = conflictQueue.value.some(c => c.file.path === nf.path)
      if (!alreadyQueued) {
        conflictQueue.value.push({ file: old, diskContent: nf.content, userEdit })
        if (!currentConflict.value) currentConflict.value = conflictQueue.value[0]
      }
    } else {
      old.content = nf.content
      edits[nf.path] = nf.content
    }
  }

  const newPaths = new Set(newFiles.map(f => f.path))
  const oldPaths = new Set((props.files || []).map(f => f.path))
  const hasStructureChange = [...newPaths].some(p => !oldPaths.has(p)) || [...oldPaths].some(p => !newPaths.has(p))
  if (hasStructureChange) emit('reload')
}

function onKeyDown(e) {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault()
    for (const file of (props.files || [])) {
      if (editing[file.path] && isDirty(file) && !saving[file.path]) saveFile(file)
    }
  }
}

function copyText(text) {
  navigator.clipboard.writeText(text || '').then(() => showSnackbar('已复制'))
}

onMounted(() => {
  if (props.project) window.services.watchMemoryDir(props.project.path, handleExternalChange)
  document.addEventListener('keydown', onKeyDown)
  document.addEventListener('click', closeManageMenu)
})
onUnmounted(() => {
  window.services.unwatchMemoryDir()
  document.removeEventListener('keydown', onKeyDown)
  document.removeEventListener('click', closeManageMenu)
})
</script>

<template>
  <div class="memory-view">
    <!-- 头部 -->
    <div class="memory-header">
      <div class="memory-header-left">
        <IconMemory :size="18" class="memory-header-icon" />
        <div>
          <div class="memory-title">记忆管理</div>
          <div class="memory-subtitle">{{ project?.displayName }}</div>
        </div>
      </div>
      <button class="clear-btn" @click="clearConfirm = true" title="删除 memory 目录">
        清空所有记忆
      </button>
    </div>
    <div class="memory-header-divider"></div>

    <!-- 加载中 -->
    <div v-if="loading" class="memory-loading">
      <div class="memory-spinner"></div>
    </div>

    <!-- 文件列表 -->
    <div v-else-if="files && files.length" ref="memoryFilesRef" class="memory-files" @scroll="onMemoryScroll">
      <div
        v-for="file in files" :key="file.path"
        :ref="el => { if (el) fileCardRefs[file.name] = el; else delete fileCardRefs[file.name] }"
        class="memory-file-card"
        :class="{ 'card-highlight': highlightFile === file.name }"
      >
        <div class="file-card-header">
          <span class="file-name">{{ file.name }}</span>
          <div class="file-actions">
            <template v-if="editing[file.path]">
              <button class="file-cancel-btn" @click="cancelEdit(file)">取消</button>
              <button
                class="file-save-btn"
                :class="{ dirty: isDirty(file) }"
                :disabled="!isDirty(file) || saving[file.path]"
                @click="saveFile(file)"
              >{{ saving[file.path] ? '保存中…' : '保存' }}</button>
            </template>
            <template v-else>
              <span
                v-if="file.name !== 'MEMORY.md' && file.name.endsWith('.md') && !isReferencedByMemoryMd(file.name)"
                class="unreferenced-badge"
              >无效记忆</span>
              <button class="file-edit-btn" @click="startEdit(file)">修改</button>
              <button
                v-if="file.name !== 'MEMORY.md' && !isReferencedByMemoryMd(file.name)"
                class="file-delete-btn"
                @click="deleteConfirm = file"
                title="删除文件"
              >
                <IconDelete :size="13" />
              </button>
            </template>
          </div>
        </div>
        <div
          v-if="!editing[file.path]"
          class="file-preview md-content"
          v-html="renderMemoryContent(edits[file.path], file.name === 'MEMORY.md')"
          @click="handlePreviewLinkClick"
        ></div>
        <textarea
          v-else
          :ref="el => { if (el) textareaRefs[file.path] = el; else delete textareaRefs[file.path] }"
          class="file-editor"
          v-model="edits[file.path]"
          spellcheck="false"
          @input="autoResize($event.target)"
        ></textarea>
      </div>
    </div>

    <div v-else class="memory-empty">记忆目录为空</div>

    <!-- 返回顶部 -->
    <Transition name="back-top-fade">
      <button v-if="showBackToTop" class="scroll-btn back-to-top-btn" @click="scrollToTop" title="返回顶部">
        <IconChevronUp />
      </button>
    </Transition>

    <!-- 删除无效记忆文件确认 -->
    <div v-if="deleteConfirm" class="confirm-overlay" @click.self="deleteConfirm = null">
      <div class="confirm-dialog">
        <p>确认删除 <strong>{{ deleteConfirm.name }}</strong>？</p>
        <div class="confirm-actions">
          <button class="confirm-cancel" @click="deleteConfirm = null">取消</button>
          <button class="confirm-ok danger" @click="confirmDelete">删除</button>
        </div>
      </div>
    </div>

    <!-- 从 MEMORY.md 管理删除的确认 -->
    <div v-if="deleteMemoryConfirm" class="confirm-overlay" @click.self="deleteMemoryConfirm = null">
      <div class="confirm-dialog">
        <p>确认删除记忆 <strong>{{ deleteMemoryConfirm }}</strong>？<br><small>将同时从 MEMORY.md 中移除引用并删除对应文件。</small></p>
        <div class="confirm-actions">
          <button class="confirm-cancel" @click="deleteMemoryConfirm = null">取消</button>
          <button class="confirm-ok danger" @click="executeDeleteMemory">删除</button>
        </div>
      </div>
    </div>

    <!-- 清空确认 -->
    <div v-if="clearConfirm" class="confirm-overlay" @click.self="clearConfirm = false">
      <div class="confirm-dialog">
        <p>确定要清空所有记忆吗？此操作不可恢复！</p>
        <div class="confirm-actions">
          <button class="confirm-cancel" @click="clearConfirm = false">取消</button>
          <button class="confirm-ok danger" @click="doClearMemory">清空</button>
        </div>
      </div>
    </div>
  </div>

  <!-- MEMORY.md 管理下拉菜单（fixed 定位） -->
  <Transition name="menu-fade">
    <div v-if="manageMenu.filename" class="mem-manage-menu" :style="manageMenu.style" @click.stop>
      <button class="mem-manage-menu-item danger" @click="openDeleteMemoryConfirm">
        <IconDelete :size="13" />
        <span>删除该记忆</span>
      </button>
    </div>
  </Transition>

  <!-- 冲突对话框（fixed，居中于整个视口）-->
  <div v-if="currentConflict" class="conflict-overlay">
    <div class="conflict-dialog">
      <div class="conflict-title">
        <span class="conflict-badge">冲突</span>
        <strong>{{ currentConflict.file.name }}</strong> 已在外部被修改
        <span v-if="conflictQueue.length > 1" class="conflict-count">（{{ conflictQueue.length }} 个文件冲突）</span>
      </div>
      <!-- 列标题行 -->
      <div class="sdiff-headers">
        <div class="sdiff-col-label mine">
          你的修改
          <button class="sdiff-copy-btn" @click="copyText(currentConflict.userEdit)" title="复制">
            <IconCopy :size="12" />
          </button>
        </div>
        <div class="sdiff-sep-hd"></div>
        <div class="sdiff-col-label disk">
          磁盘版本
          <button class="sdiff-copy-btn" @click="copyText(currentConflict.diskContent)" title="复制">
            <IconCopy :size="12" />
          </button>
        </div>
      </div>
      <!-- side-by-side diff 主体 -->
      <div class="sdiff-body">
        <template v-for="(row, i) in sideDiff" :key="i">
          <div class="sdiff-cell" :class="row.left.type">
            <span class="sdiff-marker">{{ row.left.type === 'del' ? '-' : row.left.type === 'same' ? ' ' : '' }}</span>
            <span class="sdiff-text">
              <template v-if="row.left.parts">
                <span v-for="(p, pi) in row.left.parts" :key="pi" :class="{ 'hl': p.hl }">{{ p.text }}</span>
              </template>
              <template v-else>{{ row.left.text }}</template>
            </span>
          </div>
          <div class="sdiff-sep"></div>
          <div class="sdiff-cell" :class="row.right.type">
            <span class="sdiff-marker">{{ row.right.type === 'add' ? '+' : row.right.type === 'same' ? ' ' : '' }}</span>
            <span class="sdiff-text">
              <template v-if="row.right.parts">
                <span v-for="(p, pi) in row.right.parts" :key="pi" :class="{ 'hl': p.hl }">{{ p.text }}</span>
              </template>
              <template v-else>{{ row.right.text }}</template>
            </span>
          </div>
        </template>
      </div>
      <div class="conflict-actions">
        <button class="conflict-btn keep" @click="resolveConflict(true)">保留我的修改</button>
        <button class="conflict-btn use-disk" @click="resolveConflict(false)">使用磁盘版本</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.memory-view {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  position: relative;
}

.memory-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 20px;
  min-height: 52px;
  box-sizing: border-box;
  flex-shrink: 0;
}
.memory-header-left {
  display: flex;
  align-items: center;
  gap: 10px;
}
.memory-header-icon { opacity: 0.7; flex-shrink: 0; }
.memory-title { font-size: 16px; font-weight: 600; }
.memory-subtitle { font-size: 12px; opacity: 0.5; margin-top: 1px; }
.memory-header-divider { height: 1px; background: #e0e0e0; flex-shrink: 0; }
:global(.dark .memory-header-divider) { background: #333; }

.clear-btn {
  padding: 5px 12px;
  border: 1px solid #d32f2f;
  background: transparent;
  color: #d32f2f;
  border-radius: 6px;
  font-size: 12px;
  cursor: pointer;
  font-family: inherit;
  white-space: nowrap;
}
.clear-btn:hover { background: rgba(211,47,47,0.06); }
:global(.dark .clear-btn) { border-color: #ef9a9a; color: #ef9a9a; }
:global(.dark .clear-btn:hover) { background: rgba(239,154,154,0.08); }

.memory-loading { display: flex; justify-content: center; padding: 40px; }
.memory-spinner {
  width: 28px; height: 28px;
  border: 3px solid rgba(0,0,0,0.1);
  border-top-color: #1976d2;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
:global(.dark .memory-spinner) { border-color: rgba(255,255,255,0.1); border-top-color: #90caf9; }
@keyframes spin { to { transform: rotate(360deg); } }

.memory-files {
  flex: 1; overflow: auto; padding: 16px 20px;
  display: flex; flex-direction: column; gap: 16px;
}
.memory-empty { padding: 40px; text-align: center; opacity: 0.4; }

.memory-file-card { border: 1px solid #e0e0e0; border-radius: 8px; }
:global(.dark .memory-file-card) { border-color: #333; }

@keyframes card-flash {
  0%, 100% { border-color: #e0e0e0; box-shadow: none; }
  25%, 75% { border-color: #ff9800; box-shadow: 0 0 0 2px rgba(255,152,0,0.25); }
}
@keyframes card-flash-dark {
  0%, 100% { border-color: #333; box-shadow: none; }
  25%, 75% { border-color: #ff9800; box-shadow: 0 0 0 2px rgba(255,152,0,0.3); }
}
.memory-file-card.card-highlight {
  animation: card-flash 1.4s ease;
}
:global(.dark .memory-file-card.card-highlight) {
  animation: card-flash-dark 1.4s ease;
}

.file-card-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 12px;
  background: rgba(0,0,0,0.03);
  border-bottom: 1px solid #e0e0e0;
  border-radius: 8px 8px 0 0;
}
:global(.dark .file-card-header) { background: rgba(255,255,255,0.04); border-bottom-color: #333; }

.file-name { font-size: 13px; font-weight: 600; font-family: monospace; opacity: 0.8; }
.file-actions { display: flex; align-items: center; gap: 6px; }

.file-edit-btn {
  padding: 3px 10px;
  border: 1px solid #bbb;
  background: transparent; color: inherit;
  border-radius: 4px; font-size: 12px; cursor: pointer; font-family: inherit; opacity: 0.6;
}
.file-edit-btn:hover { opacity: 1; background: rgba(0,0,0,0.04); }
:global(.dark .file-edit-btn:hover) { background: rgba(255,255,255,0.07); }

.file-cancel-btn {
  padding: 3px 10px;
  border: 1px solid #bbb;
  background: transparent; color: inherit;
  border-radius: 4px; font-size: 12px; cursor: pointer; font-family: inherit; opacity: 0.6;
}
.file-cancel-btn:hover { opacity: 1; background: rgba(0,0,0,0.04); }
:global(.dark .file-cancel-btn:hover) { background: rgba(255,255,255,0.07); }

.file-save-btn {
  padding: 3px 10px;
  border: 1px solid #bbb;
  background: transparent; color: inherit;
  border-radius: 4px; font-size: 12px; cursor: pointer; font-family: inherit; opacity: 0.5;
}
.file-save-btn.dirty { border-color: #1976d2; color: #1976d2; opacity: 1; }
.file-save-btn:disabled { cursor: default; }
.file-save-btn.dirty:hover { background: rgba(25,118,210,0.06); }
:global(.dark .file-save-btn.dirty) { border-color: #90caf9; color: #90caf9; }
:global(.dark .file-save-btn.dirty:hover) { background: rgba(144,202,249,0.08); }

.unreferenced-badge {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 3px;
  background: rgba(211,47,47,0.1);
  color: #d32f2f;
  white-space: nowrap;
}
:global(.dark .unreferenced-badge) {
  background: rgba(239,154,154,0.12);
  color: #ef9a9a;
}

.file-delete-btn {
  display: flex; align-items: center; justify-content: center;
  width: 26px; height: 26px; border: none; background: transparent;
  color: inherit; border-radius: 4px; cursor: pointer; opacity: 0.4;
}
.file-delete-btn:hover { opacity: 1; color: #d32f2f; background: rgba(211,47,47,0.08); }
:global(.dark .file-delete-btn:hover) { color: #ef9a9a; background: rgba(239,154,154,0.1); }

.file-preview {
  padding: 12px 16px;
  font-size: 13px; line-height: 1.6;
  background: rgba(0,0,0,0.015);
  min-height: 60px;
  max-height: 500px;
  overflow-y: auto;
}
:global(.dark .file-preview) { background: rgba(255,255,255,0.02); }

:global(.file-preview .frontmatter-block) {
  display: block;
  margin-bottom: 12px;
  padding: 8px 12px;
  background: rgba(0,0,0,0.04);
  border-left: 3px solid rgba(0,0,0,0.15);
  border-radius: 0 4px 4px 0;
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 12px;
  line-height: 1.7;
}
:global(.dark .file-preview .frontmatter-block) {
  background: rgba(255,255,255,0.05);
  border-left-color: rgba(255,255,255,0.2);
}
:global(.file-preview .fm-row) { display: flex; gap: 0; }
:global(.file-preview .fm-key) { color: #6a3f9c; font-weight: 600; white-space: nowrap; }
:global(.dark .file-preview .fm-key) { color: #ce93d8; }
:global(.file-preview .fm-colon) { opacity: 0.5; }
:global(.file-preview .fm-val) { opacity: 0.85; word-break: break-all; }
:global(.file-preview .fm-plain) { opacity: 0.4; }

.file-editor {
  width: 100%; min-height: 80px; padding: 12px;
  border: none; outline: none;
  font-size: 13px; font-family: 'Consolas', 'Monaco', monospace; line-height: 1.6;
  resize: vertical; background: transparent; color: inherit;
  box-sizing: border-box; display: block;
  transition: background 0.15s;
  overflow: hidden;
}
:global(.dark .file-editor) { color: #e0e0e0; }

.back-to-top-btn {
  position: absolute;
  right: 24px;
  bottom: 24px;
  z-index: 10;
}
.back-top-fade-enter-active, .back-top-fade-leave-active { transition: opacity 0.2s, transform 0.2s; }
.back-top-fade-enter-from, .back-top-fade-leave-to { opacity: 0; transform: translateY(8px); }

/* MEMORY.md 列表项内联管理按钮 */
:global(.file-preview li:has(.mem-manage-btn)) { list-style: none; }
:global(.file-preview ul:has(.mem-manage-btn)) { padding-left: 4px; }
:global(.file-preview .mem-manage-btn) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  border: none;
  background: transparent;
  border-radius: 3px;
  cursor: pointer;
  color: inherit;
  vertical-align: middle;
  margin-left: -2px;
  margin-right: 4px;
  padding: 0;
  transition: background 0.15s;
}
/* 默认显示小点，隐藏齿轮 */
:global(.file-preview .mgr-bullet) { opacity: 0.5; font-size: 14px; line-height: 1; }
:global(.file-preview .mgr-gear) { display: none; }
/* 悬浮时切换为齿轮 */
:global(.file-preview li:hover .mgr-bullet) { display: none; }
:global(.file-preview li:hover .mgr-gear) { display: inline-flex; opacity: 0.6; }
:global(.file-preview .mem-manage-btn:hover .mgr-gear) { opacity: 1; }
:global(.file-preview .mem-manage-btn:hover) { background: rgba(0,0,0,0.07); }
:global(.dark .file-preview .mem-manage-btn:hover) { background: rgba(255,255,255,0.1); }

.mem-manage-menu {
  position: fixed;
  z-index: 9999;
  background: #fff;
  border: 1px solid rgba(0,0,0,0.12);
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.12);
  min-width: 130px;
  padding: 4px 0;
}
:global(.dark .mem-manage-menu) {
  background: #2a2a2a;
  border-color: #444;
  box-shadow: 0 4px 16px rgba(0,0,0,0.4);
}
.mem-manage-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 14px;
  border: none;
  background: transparent;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  font-family: inherit;
  color: inherit;
}
.mem-manage-menu-item:hover { background: rgba(0,0,0,0.05); }
:global(.dark .mem-manage-menu-item:hover) { background: rgba(255,255,255,0.07); }
.mem-manage-menu-item.danger { color: #d32f2f; }
:global(.dark .mem-manage-menu-item.danger) { color: #ef9a9a; }
.menu-fade-enter-active, .menu-fade-leave-active { transition: opacity 0.12s, transform 0.12s; }
.menu-fade-enter-from, .menu-fade-leave-to { opacity: 0; transform: scale(0.95); }

/* 通用确认弹窗（相对 memory-view 定位） */
.confirm-overlay {
  position: absolute; inset: 0;
  background: rgba(0,0,0,0.3);
  display: flex; align-items: center; justify-content: center;
  z-index: 100;
}
:global(.dark .confirm-overlay) { background: rgba(0,0,0,0.5); }
.confirm-dialog {
  background: #fff; border-radius: 10px; padding: 20px 24px;
  max-width: 320px; width: 90%;
  box-shadow: 0 8px 32px rgba(0,0,0,0.15);
}
:global(.dark .confirm-dialog) { background: #2a2a2a; box-shadow: 0 8px 32px rgba(0,0,0,0.5); }
.confirm-dialog p { margin: 0 0 16px; font-size: 14px; line-height: 1.5; }
.confirm-actions { display: flex; justify-content: flex-end; gap: 8px; }
.confirm-cancel {
  padding: 6px 14px; border: 1px solid #bbb;
  background: transparent; color: inherit;
  border-radius: 6px; font-size: 13px; cursor: pointer; font-family: inherit;
}
.confirm-cancel:hover { background: rgba(0,0,0,0.05); }
:global(.dark .confirm-cancel:hover) { background: rgba(255,255,255,0.08); }
.confirm-ok {
  padding: 6px 14px; border: none; border-radius: 6px;
  font-size: 13px; cursor: pointer; font-family: inherit;
  background: #1976d2; color: #fff;
}
.confirm-ok.danger { background: #d32f2f; }
.confirm-ok:hover { filter: brightness(1.1); }

/* 冲突对话框（fixed，覆盖整个视口） */
.conflict-overlay {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.4);
  display: flex; align-items: center; justify-content: center;
  z-index: 1000;
}
:global(.dark .conflict-overlay) { background: rgba(0,0,0,0.65); }

.conflict-dialog {
  background: #fff; border-radius: 12px;
  width: min(920px, 96vw);
  height: min(78vh, 680px);
  display: flex; flex-direction: column;
  box-shadow: 0 12px 48px rgba(0,0,0,0.22);
  overflow: hidden;
}
:global(.dark .conflict-dialog) { background: #252525; box-shadow: 0 12px 48px rgba(0,0,0,0.65); }

.conflict-title {
  display: flex; align-items: center; gap: 8px;
  padding: 12px 18px;
  font-size: 14px;
  border-bottom: 1px solid #e0e0e0;
  flex-shrink: 0;
}
:global(.dark .conflict-title) { border-bottom-color: #333; }
.conflict-badge {
  background: #ff9800; color: #fff;
  font-size: 11px; font-weight: 700;
  padding: 2px 7px; border-radius: 4px;
  flex-shrink: 0;
}
.conflict-count { font-size: 12px; opacity: 0.5; margin-left: 4px; }

/* side-by-side diff */
.sdiff-headers {
  display: grid;
  grid-template-columns: 1fr 1px 1fr;
  border-bottom: 1px solid #e0e0e0;
  flex-shrink: 0;
}
:global(.dark .sdiff-headers) { border-bottom-color: #333; }

.sdiff-sep-hd { background: #e0e0e0; }
:global(.dark .sdiff-sep-hd) { background: #333; }

.sdiff-col-label {
  display: flex; align-items: center; gap: 6px;
  font-size: 11px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase;
  padding: 5px 8px 5px 12px;
}
.sdiff-col-label.mine { color: #1565c0; background: rgba(25,118,210,0.07); }
.sdiff-col-label.disk { color: #6a1b9a; background: rgba(123,31,162,0.07); }
:global(.dark .sdiff-col-label.mine) { color: #90caf9; background: rgba(144,202,249,0.09); }
:global(.dark .sdiff-col-label.disk) { color: #ce93d8; background: rgba(206,147,216,0.09); }

.sdiff-copy-btn {
  display: flex; align-items: center; justify-content: center;
  width: 20px; height: 20px; padding: 0;
  border: none; background: transparent; cursor: pointer;
  color: inherit; border-radius: 3px; opacity: 0.55; margin-left: auto;
}
.sdiff-copy-btn:hover { opacity: 1; background: rgba(0,0,0,0.08); }
:global(.dark .sdiff-copy-btn:hover) { background: rgba(255,255,255,0.1); }

.sdiff-body {
  flex: 1; overflow: auto; min-height: 0;
  display: grid;
  grid-template-columns: 1fr 1px 1fr;
  align-content: start;
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 12px; line-height: 1.55;
}

.sdiff-sep { background: #e0e0e0; }
:global(.dark .sdiff-sep) { background: #333; }

.sdiff-cell {
  display: flex; white-space: pre-wrap; word-break: break-all;
}
.sdiff-cell.same { opacity: 0.7; }
.sdiff-cell.del { background: rgba(248,81,73,0.13); color: #b91c1c; }
.sdiff-cell.add { background: rgba(46,160,67,0.13); color: #1a6e2e; }
.sdiff-cell.empty {
  background: repeating-linear-gradient(
    135deg,
    rgba(0,0,0,0.04) 0px, rgba(0,0,0,0.04) 3px,
    transparent 3px, transparent 9px
  );
}
:global(.dark .sdiff-cell.del) { background: rgba(248,81,73,0.2); color: #ffa198; }
:global(.dark .sdiff-cell.add) { background: rgba(46,160,67,0.2); color: #7ee787; }
:global(.dark .sdiff-cell.empty) {
  background: repeating-linear-gradient(
    135deg,
    rgba(255,255,255,0.04) 0px, rgba(255,255,255,0.04) 3px,
    transparent 3px, transparent 9px
  );
}

.sdiff-marker { width: 16px; flex-shrink: 0; padding: 0 3px; opacity: 0.65; text-align: center; }
.sdiff-text { flex: 1; padding: 0 8px; }

/* 字符级高亮 */
.sdiff-cell.del .hl { background: rgba(248,81,73,0.35); border-radius: 2px; }
.sdiff-cell.add .hl { background: rgba(46,160,67,0.35); border-radius: 2px; }
:global(.dark .sdiff-cell.del .hl) { background: rgba(248,81,73,0.45); }
:global(.dark .sdiff-cell.add .hl) { background: rgba(46,160,67,0.45); }

.conflict-actions {
  display: flex; gap: 10px; justify-content: flex-end;
  padding: 11px 18px;
  border-top: 1px solid #e0e0e0;
  flex-shrink: 0;
}
:global(.dark .conflict-actions) { border-top-color: #333; }
.conflict-btn {
  padding: 7px 18px; border-radius: 6px;
  font-size: 13px; font-family: inherit;
  cursor: pointer; border: none;
}
.conflict-btn.keep { background: rgba(25,118,210,0.12); color: #1565c0; }
.conflict-btn.keep:hover { background: rgba(25,118,210,0.2); }
.conflict-btn.use-disk { background: #7b1fa2; color: #fff; }
.conflict-btn.use-disk:hover { filter: brightness(1.1); }
:global(.dark .conflict-btn.keep) { background: rgba(144,202,249,0.15); color: #90caf9; }
:global(.dark .conflict-btn.keep:hover) { background: rgba(144,202,249,0.25); }
:global(.dark .conflict-btn.use-disk) { background: #8e24aa; }
</style>
