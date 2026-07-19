<script setup>
import { ref, watch, nextTick, onMounted, onUnmounted, computed } from 'vue'
import { IconTerminal, IconCopy, IconFork, IconStop, IconChevronUp, IconChevronDown, IconChat, IconSearch, IconClose, IconExport, IconImage, IconFolder, IconMore, IconStar, IconStarOutline, IconEdit, IconDelete, IconList, IconOpenExternal, IconRestore, IconExpandAll, IconCollapseAll } from './icons'
import { formatTime, formatTokens, formatDuration } from '../composables/useFormat'
import { parseContentBlocks, mergeToolBlocks, getMessageRole, getRoleLabel, hasXmlTags, parseTextSegments } from '../composables/useMessageParser'
import { formatToolInput, getToolSummary, getDiff } from '../composables/useToolDisplay'
import { useCollapse } from '../composables/useToolDisplay'
import { useSnackbar } from '../composables/useSnackbar'
import { renderMarkdown } from '../composables/useMarkdown'
import { useSearch } from '../composables/useSearch'
import { exportAsMarkdown, serializeToHtml } from '../composables/useExport'
import { useTheme } from '../composables/useTheme'
import ExportOptionsDialog from './ExportOptionsDialog.vue'

const props = defineProps({
  session: Object,
  displayMessages: Array,
  loading: Boolean,
  agentToolUseMap: { type: Object, default: () => ({}) },
  standalone: { type: Boolean, default: false },
  pendingSearch: { type: String, default: '' }
})

const emit = defineEmits(['fork', 'fork-summary', 'resume', 'preview-image', 'rename', 'delete', 'toggle-favorite', 'select-session', 'open-session-window'])

const { showSnackbar } = useSnackbar()

const currentProvider = computed(() => {
  const p = props.session?.provider
  return p ? window.services.getProvider(p) : null
})

// assistant 标签按 provider 显示（Claude/Codex/Gemini/OpenCode），user 统一「用户」
const PROVIDER_ASSISTANT_LABEL = { claude: 'Claude', codex: 'Codex', gemini: 'Gemini', opencode: 'OpenCode' }
function displayRoleLabel(role) {
  if (role === 'assistant') return PROVIDER_ASSISTANT_LABEL[props.session?.provider] || getRoleLabel(role)
  return getRoleLabel(role)
}

// 复制/显示只给恢复命令本身；cd 进目录由「在终端中恢复」按钮处理（launchInTerminal）
function buildResumeCommand(s) {
  if (!s?.sessionId) return s?.cwd || ''
  const provider = s.provider ? window.services.getProvider(s.provider) : null
  return provider?.getResumeCommand
    ? provider.getResumeCommand(s.sessionId, undefined, s.path)
    : `${window.utools.dbStorage.getItem('terminalCommand') || 'claude'} --resume ${s.sessionId}`
}

const resumeCommandText = computed(() => buildResumeCommand(props.session))
const { toggleCollapse, isCollapsed, forceExpand, expandAll, collapseAll, allMode } = useCollapse()
const { isDark } = useTheme()
const { searchVisible, searchText, matchIndex, matchCount, caseSensitive, wholeWord, useRegex, openSearch, closeSearch, doSearch, nextMatch, prevMatch } = useSearch()
const searchInputRef = ref(null)

// Auto-focus search input when opened
watch(searchVisible, (v) => {
  if (v) nextTick(() => searchInputRef.value?.focus())
})

// 从全局搜索结果打开会话：内容渲染后自动打开会话内搜索并高亮
let pendingSearchDone = false
watch(() => props.session?.path, () => { pendingSearchDone = false })
watch(() => props.displayMessages, () => {
  if (props.pendingSearch && !pendingSearchDone && props.displayMessages?.length) {
    pendingSearchDone = true
    searchText.value = props.pendingSearch
    openSearch()
    nextTick(() => nextTick(() => doSearch()))
  }
}, { flush: 'post' })

// Global keyboard shortcuts
function onKeyDown(e) {
  if (!props.session) return
  if (e.ctrlKey && e.key === 'f') {
    e.preventDefault()
    openSearch()
  } else if (e.key === 'F3') {
    e.preventDefault()
    if (!searchVisible.value) openSearch()
    else if (e.shiftKey) prevMatch()
    else nextMatch()
  } else if (e.key === 'Escape' && searchVisible.value) {
    closeSearch()
  }
}
const contentBodyRef = ref(null)
const contentHeaderRef = ref(null)

// ponytail: 分页渲染 — 初始只渲染最后 PAGE_SIZE 条，上滚加载更多
const PAGE_SIZE = 50
const visibleCount = ref(PAGE_SIZE)
const loadingMore = ref(false)

const visibleMessages = computed(() => {
  const msgs = props.displayMessages || []
  if (searchVisible.value) return msgs
  if (visibleCount.value >= msgs.length) return msgs
  return msgs.slice(msgs.length - visibleCount.value)
})

const hasMoreMessages = computed(() => {
  if (searchVisible.value && searchText.value) return false
  return visibleCount.value < (props.displayMessages?.length || 0)
})

function loadMoreMessages() {
  if (loadingMore.value || !hasMoreMessages.value) return
  loadingMore.value = true
  const el = contentBodyRef.value
  const oldHeight = el ? el.scrollHeight : 0
  visibleCount.value = Math.min(visibleCount.value + PAGE_SIZE, props.displayMessages?.length || 0)
  nextTick(() => {
    if (el) el.scrollTop = el.scrollHeight - oldHeight + el.scrollTop
    loadingMore.value = false
  })
}

watch(() => props.session?.path, () => {
  visibleCount.value = PAGE_SIZE
})
const showMoreMenu = ref(false)
const showShareMenu = ref(false)
const exportDialog = ref({ show: false, format: '' })
const showOutline = ref(false)
// null=从未手动，true=手动开启，false=手动关闭
const outlineUserOverride = ref(null)
const OUTLINE_AUTO_WIDTH = 900

function toggleOutline() {
  showOutline.value = !showOutline.value
  outlineUserOverride.value = showOutline.value
}

function onContentResize(width) {
  if (width >= OUTLINE_AUTO_WIDTH) {
    if (outlineUserOverride.value !== false) showOutline.value = true
  } else {
    if (outlineUserOverride.value !== true) showOutline.value = false
  }
}

function onContentScroll() {
  const el = contentBodyRef.value
  if (el && el.scrollTop < 100 && hasMoreMessages.value) loadMoreMessages()
}

let outlineResizeObserver = null
onMounted(() => {
  document.addEventListener('keydown', onKeyDown)
  outlineResizeObserver = new ResizeObserver(entries => {
    onContentResize(entries[0].contentRect.width)
  })
})
onUnmounted(() => {
  document.removeEventListener('keydown', onKeyDown)
  outlineResizeObserver?.disconnect()
})

watch(contentHeaderRef, (el) => {
  outlineResizeObserver?.disconnect()
  if (el) {
    outlineResizeObserver.observe(el)
    onContentResize(el.offsetWidth)
  }
})
const snapshotDialog = ref({ show: false, item: null, restoring: false, selected: new Set(), step: 1, diffData: [], activeFile: 0 })

function openRestoreDialog(item) {
  const allFiles = Object.keys(item.snapshotData.trackedFileBackups)
  snapshotDialog.value = { show: true, item, restoring: false, selected: new Set(allFiles), step: 1, diffData: [], activeFile: 0 }
}

function toggleSnapshotFile(filePath) {
  const s = snapshotDialog.value.selected
  if (s.has(filePath)) s.delete(filePath)
  else s.add(filePath)
  snapshotDialog.value.selected = new Set(s)
}

// LCS 行级 diff：current → backup（- 表示当前有但快照没有，+ 表示快照有但当前没有）
function computeLineDiff(currentText, backupText) {
  const a = (currentText || '').split('\n')
  const b = (backupText || '').split('\n')
  if (a.join('\n') === b.join('\n')) return []
  const m = a.length, n = b.length
  if (m > 3000 || n > 3000) return [{ type: 'info', text: `文件过大（${m} / ${n} 行），无法预览 diff` }]
  const dp = Array.from({ length: m + 1 }, () => new Int32Array(n + 1))
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] + 1 : Math.max(dp[i-1][j], dp[i][j-1])
  const raw = []
  let i = m, j = n
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i-1] === b[j-1]) { raw.unshift({ type: 'ctx', text: a[i-1] }); i--; j-- }
    else if (j > 0 && (i === 0 || dp[i][j-1] >= dp[i-1][j])) { raw.unshift({ type: 'add', text: b[j-1] }); j-- }
    else { raw.unshift({ type: 'del', text: a[i-1] }); i-- }
  }
  // 折叠连续未变行，保留上下 3 行上下文
  const CTX = 3
  const keep = new Uint8Array(raw.length)
  for (let k = 0; k < raw.length; k++) {
    if (raw[k].type !== 'ctx') {
      for (let d = Math.max(0, k - CTX); d <= Math.min(raw.length - 1, k + CTX); d++) keep[d] = 1
    }
  }
  const out = []; let hidden = 0
  for (let k = 0; k < raw.length; k++) {
    if (keep[k]) {
      if (hidden) { out.push({ type: 'fold', count: hidden }); hidden = 0 }
      out.push(raw[k])
    } else hidden++
  }
  if (hidden) out.push({ type: 'fold', count: hidden })
  return out
}

function goToStep2() {
  const { item, selected } = snapshotDialog.value
  const filtered = Object.fromEntries(
    Object.entries(item.snapshotData.trackedFileBackups).filter(([k]) => selected.has(k))
  )
  const result = window.services.getSnapshotFileContents(props.session.path, filtered)
  if (!result.success) { showSnackbar(result.error || '读取文件失败', 'error'); return }
  const diffData = result.files.map(f => {
    const lines = computeLineDiff(f.currentContent || '', f.backupContent || '')
    const adds = lines.filter(l => l.type === 'add').length
    const dels = lines.filter(l => l.type === 'del').length
    return { filePath: f.filePath, fileName: f.filePath.replace(/.*[/\\]/, ''), lines, adds, dels, unchanged: lines.length === 0 }
  })
  snapshotDialog.value.step = 2
  snapshotDialog.value.diffData = diffData
  snapshotDialog.value.activeFile = 0
}

async function doRestoreSnapshot() {
  const { item, selected } = snapshotDialog.value
  if (!item || !props.session?.path || selected.size === 0) return
  snapshotDialog.value.restoring = true
  const filtered = Object.fromEntries(
    Object.entries(item.snapshotData.trackedFileBackups).filter(([k]) => selected.has(k))
  )
  try {
    const result = window.services.restoreSnapshot(props.session.path, filtered)
    snapshotDialog.value.show = false
    if (result.success) {
      showSnackbar(`已恢复 ${result.restoredFiles.length} 个文件`)
    } else if (result.errors?.length) {
      showSnackbar('部分文件恢复失败：' + result.errors.join('; '), 'error')
    } else {
      showSnackbar(result.error || '恢复失败', 'error')
    }
  } catch (e) {
    snapshotDialog.value.show = false
    showSnackbar('恢复失败：' + e.message, 'error')
  }
}

const isCompressedOnlySession = computed(() =>
  props.displayMessages?.length === 1 && props.displayMessages[0].isCompactSummary
)

function getOutlineItems() {
  if (!props.displayMessages) return []
  const items = []
  let userIndex = 0
  for (const item of props.displayMessages) {
    if (item.isCompactSummary) {
      items.push({ uuid: item.uuid, isCompactSummary: true, index: null })
    } else if (getMessageRole(item) === 'user' && !item.isSystemEvent) {
      const blocks = parseContentBlocks(item)
      const text = blocks.find(b => b.type === 'text')?.text?.trim() || ''
      if (text) { userIndex++; items.push({ uuid: item.uuid, text, index: userIndex }) }
    }
  }
  return items
}

function scrollToMessage(uuid) {
  const el = contentBodyRef.value?.querySelector(`[data-uuid="${uuid}"]`)
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

// Close menus on click outside
function onDocClick(e) {
  if (showMoreMenu.value && !e.target.closest('.more-wrapper')) {
    showMoreMenu.value = false
    showShareMenu.value = false
  }
}
onMounted(() => document.addEventListener('click', onDocClick))
onUnmounted(() => document.removeEventListener('click', onDocClick))

// Close search when session changes
watch(() => props.session, () => { if (searchVisible.value) closeSearch() })

function scrollToTop() {
  contentBodyRef.value?.scrollTo({ top: 0, behavior: 'smooth' })
}

function scrollToBottom() {
  const el = contentBodyRef.value
  if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
}

function isScrolledToBottom() {
  const el = contentBodyRef.value
  if (!el) return true
  return el.scrollHeight - el.scrollTop - el.clientHeight < 50
}

function scrollToEnd() {
  const el = contentBodyRef.value
  if (el) el.scrollTop = el.scrollHeight
}

function copyMessageText(item) {
  const blocks = parseContentBlocks(item)
  const text = blocks
    .filter(b => b.type === 'text')
    .map(b => (b.text || '').trim())
    .filter(Boolean)
    .join('\n\n')
  if (text) {
    window.utools.copyText(text)
    showSnackbar('已复制')
  } else {
    showSnackbar('无可复制的文本', 'error')
  }
}

function copyResumeCommand() {
  const cmd = buildResumeCommand(props.session)
  if (!cmd) return
  window.utools.copyText(cmd)
  showSnackbar('已复制恢复命令')
}

function openSessionDir() {
  showMoreMenu.value = false
  const session = props.session
  if (!session?.path) return
  window.utools.shellShowItemInFolder(session.path)
}

function confirmDelete() {
  showMoreMenu.value = false
  emit('delete', props.session)
}

// Export functions
function doExport(format) {
  showMoreMenu.value = false
  showShareMenu.value = false
  const session = props.session
  const msgs = props.displayMessages
  if (!session || !msgs.length) return
  if (format === 'md') {
    const content = exportAsMarkdown(msgs, session)
    const filePath = window.services.saveText(content, `${session.name || 'session'}.md`)
    if (filePath) { window.utools.shellShowItemInFolder(filePath); showSnackbar('已导出 Markdown') }
  } else if (format === 'html' || format === 'image') {
    exportDialog.value = { show: true, format }
    return
  }
}

/**
 * Shared: clone preview DOM, apply export options, wrap in offscreen container.
 * Used by both HTML and image export.
 */
async function prepareExportClone(session, opts) {
  const source = contentBodyRef.value
  if (!source) return null

  // For HTML export, always expand all blocks (user can toggle in the HTML file)
  // For image export, only expand if explicitly requested
  const isHtml = exportDialog.value.format === 'html'
  const needExpand = isHtml || opts.showToolDetail || opts.showThinking
  if (needExpand) {
    forceExpand.value = true
    await nextTick()
  }

  const clone = source.cloneNode(true)
  if (needExpand) forceExpand.value = false

  // Strip interactive-only elements
  clone.querySelectorAll('.message-actions').forEach(el => el.remove())
  clone.querySelectorAll('.scroll-buttons').forEach(el => el.remove())
  clone.querySelectorAll('.search-highlight').forEach(el => {
    el.replaceWith(document.createTextNode(el.textContent))
  })

  // Apply export options
  if (!opts.showStats) clone.querySelectorAll('.message-stats').forEach(el => el.remove())

  if (isHtml) {
    // HTML: keep all blocks, but default them to collapsed (user can click to expand)
    clone.querySelectorAll('.tool-card-body, .block-body').forEach(el => {
      el.style.display = 'none'
    })
    clone.querySelectorAll('.collapse-icon').forEach(el => {
      el.textContent = '▸'
    })
  } else {
    // Image: remove blocks based on options
    if (!opts.showThinking) clone.querySelectorAll('.block-thinking').forEach(el => el.remove())
    if (!opts.showToolDetail) clone.querySelectorAll('.tool-card-body').forEach(el => el.remove())
  }

  // Handle file path mode
  if (opts.filePathMode === 'hidden') {
    clone.querySelectorAll('.tool-summary').forEach(el => { el.textContent = '' })
  } else if (opts.filePathMode === 'full') {
    clone.querySelectorAll('.tool-summary').forEach(el => {
      const fullPath = el.getAttribute('data-full-path')
      if (fullPath) el.textContent = fullPath
    })
  }

  // Build offscreen container
  const container = document.createElement('div')
  container.style.cssText = 'position:fixed;left:-9999px;top:0;width:860px;z-index:-1;overflow:visible;'
  if (isDark.value) container.classList.add('dark')
  container.style.background = isDark.value ? '#1a1a1a' : '#f8f9fa'
  container.style.color = isDark.value ? '#e0e0e0' : '#1a1a1a'
  container.style.fontFamily = "system-ui, -apple-system, 'Segoe UI', sans-serif"
  container.style.padding = '16px'

  // Insert session title/meta at top
  const titleDiv = document.createElement('div')
  titleDiv.style.cssText = 'font-size:20px;font-weight:700;margin-bottom:4px;'
  titleDiv.textContent = session.name || 'Session'
  container.appendChild(titleDiv)
  const metaParts = []
  if (opts.showSessionId && session.sessionId) metaParts.push(session.sessionId)
  if (opts.showCwd && session.cwd) metaParts.push(session.cwd)
  if (metaParts.length) {
    const metaDiv = document.createElement('div')
    metaDiv.style.cssText = 'font-size:12px;opacity:0.5;margin-bottom:16px;'
    metaDiv.textContent = metaParts.join(' · ')
    container.appendChild(metaDiv)
  }

  // Reset clone styles
  clone.style.overflow = 'visible'
  clone.style.height = 'auto'
  clone.style.maxHeight = 'none'
  clone.style.flex = 'none'
  container.appendChild(clone)

  return container
}

function doExportWithOptions(opts) {
  const format = exportDialog.value.format
  exportDialog.value.show = false
  const session = props.session
  const msgs = props.displayMessages
  if (!session || !msgs.length) return

  if (format === 'html') {
    showSnackbar('正在生成 HTML...')
    nextTick(async () => {
      try {
        const container = await prepareExportClone(session, opts)
        if (!container) return
        document.body.appendChild(container)
        await new Promise(r => setTimeout(r, 100))
        const htmlContent = serializeToHtml(container, session.name || 'Session', isDark.value)
        document.body.removeChild(container)
        const filePath = window.services.saveText(htmlContent, `${session.name || 'session'}.html`)
        if (filePath) { window.utools.shellShowItemInFolder(filePath); showSnackbar('已导出 HTML') }
      } catch (e) {
        console.error('Export HTML failed:', e)
        showSnackbar('导出 HTML 失败: ' + e.message, 'error')
      }
    })
  } else if (format === 'image') {
    showSnackbar('正在生成长图...')
    nextTick(async () => {
      try {
        const container = await prepareExportClone(session, opts)
        if (!container) return
        document.body.appendChild(container)

        await new Promise(r => setTimeout(r, 200))

        const totalHeight = container.scrollHeight
        const width = 860

        const html2canvas = (await import('html2canvas')).default
        const MAX_SLICE = 8000
        const sliceCount = Math.ceil(totalHeight / MAX_SLICE)

        if (sliceCount <= 1) {
          const canvas = await html2canvas(container, { useCORS: true, scale: 2, logging: false, width, height: totalHeight, windowWidth: width, windowHeight: totalHeight })
          document.body.removeChild(container)
          saveCanvasAsImage(canvas)
        } else {
          const finalCanvas = document.createElement('canvas')
          finalCanvas.width = width * 2
          finalCanvas.height = totalHeight * 2
          const ctx = finalCanvas.getContext('2d')
          for (let i = 0; i < sliceCount; i++) {
            const y = i * MAX_SLICE
            const h = Math.min(MAX_SLICE, totalHeight - y)
            const sliceCanvas = await html2canvas(container, { useCORS: true, scale: 2, logging: false, width, height: h, windowWidth: width, windowHeight: h, x: 0, y })
            ctx.drawImage(sliceCanvas, 0, y * 2)
          }
          document.body.removeChild(container)
          saveCanvasAsImage(finalCanvas)
        }
      } catch (e) {
        console.error('Export image failed:', e)
        showSnackbar('导出长图失败: ' + e.message, 'error')
      }
    })
  }
}

function saveCanvasAsImage(canvas) {
  canvas.toBlob(blob => {
    if (!blob) { showSnackbar('生成长图失败', 'error'); return }
    const reader = new FileReader()
    reader.onload = () => {
      const base64 = reader.result.split(',')[1]
      const filePath = window.services.saveImage(base64, 'png')
      if (filePath) { window.utools.shellShowItemInFolder(filePath); showSnackbar('已导出长图') }
    }
    reader.readAsDataURL(blob)
  }, 'image/png')
}

defineExpose({ contentBodyRef, isScrolledToBottom, scrollToEnd })
</script>

<template>
  <template v-if="session">
    <div ref="contentHeaderRef" class="content-header">
      <div class="content-header-top">
        <button v-if="!session.isSubagent" class="resume-btn" @click="emit('toggle-favorite', session)" :title="session.isFavorite ? '取消收藏' : '收藏'">
          <IconStar v-if="session.isFavorite" :size="14" style="color: #ff9800" />
          <IconStarOutline v-else :size="14" />
        </button>
        <h3>{{ session.name }}</h3>
        <button v-if="!session.isSubagent" class="resume-btn" @click="emit('rename', session)" title="重命名">
          <IconEdit :size="13" />
        </button>
      </div>
      <div class="content-header-sub">
        <span class="content-cwd">{{ session.isSubagent ? session.agentId : resumeCommandText }}</span>
        <button v-if="session.sessionId && !session.isSubagent" class="resume-btn" @click="emit('resume')" title="在终端中恢复会话">
          <IconTerminal />
        </button>
        <button v-if="session.sessionId && !session.isSubagent" class="resume-btn" @click="copyResumeCommand" title="复制恢复命令">
          <IconCopy :size="13" />
        </button>
        <div style="flex:1"></div>
        <button class="header-action-btn" @click="allMode === 'expand' ? collapseAll() : expandAll()" :title="allMode === 'expand' ? '折叠全部工具调用' : '展开全部工具调用'">
          <IconExpandAll v-if="allMode !== 'expand'" :size="14" />
          <IconCollapseAll v-else :size="14" />
        </button>
        <button v-if="!standalone" class="header-action-btn" @click="emit('open-session-window', session)" title="新窗口打开">
          <IconOpenExternal :size="14" />
        </button>
        <button class="header-action-btn" @click="openSearch" title="搜索 (Ctrl+F)">
          <IconSearch :size="14" />
        </button>
        <button class="header-action-btn" :class="{ active: showOutline }" @click="toggleOutline" title="消息大纲">
          <IconList :size="14" />
        </button>
        <div class="more-wrapper">
          <button class="header-action-btn" @click="showMoreMenu = !showMoreMenu" title="更多">
            <IconMore :size="14" />
          </button>
          <div v-if="showMoreMenu" class="more-menu">
            <button v-if="session.path && currentProvider?.id !== 'opencode'" @click="openSessionDir">
              <IconFolder :size="13" />
              <span>打开源文件目录</span>
            </button>
            <div class="menu-divider"></div>
            <div class="menu-sub-wrapper" @mouseenter="showShareMenu = true" @mouseleave="showShareMenu = false">
              <button class="menu-sub-trigger">
                <IconExport :size="13" />
                <span>分享</span>
                <span class="menu-arrow">▸</span>
              </button>
              <div v-if="showShareMenu" class="menu-sub">
                <button @click="doExport('md')">导出 Markdown</button>
                <button @click="doExport('html')">导出 HTML</button>
                <button @click="doExport('image')">导出长图</button>
              </div>
            </div>
            <template v-if="!session.isSubagent">
              <div class="menu-divider"></div>
              <button class="menu-danger" @click="confirmDelete">
                <IconDelete :size="13" />
                <span>删除会话</span>
              </button>
            </template>
          </div>
        </div>
      </div>
    </div>
    <!-- 搜索栏 -->
    <div v-if="searchVisible" class="session-search-bar">
      <input
        class="session-search-input"
        v-model="searchText"
        placeholder="搜索内容..."
        @input="doSearch"
        @keyup.enter.exact="nextMatch"
        @keyup.enter.shift="prevMatch"
        @keyup.escape="closeSearch"
        ref="searchInputRef"
      />
      <button class="search-opt-btn" :class="{ active: caseSensitive }" @click="caseSensitive = !caseSensitive; doSearch()" title="区分大小写">Aa</button>
      <button class="search-opt-btn" :class="{ active: wholeWord }" @click="wholeWord = !wholeWord; doSearch()" title="全字匹配">Ab|</button>
      <button class="search-opt-btn" :class="{ active: useRegex }" @click="useRegex = !useRegex; doSearch()" title="正则表达式">.*</button>
      <span v-if="matchCount > 0" class="search-count">{{ matchIndex + 1 }}/{{ matchCount }}</span>
      <span v-else-if="searchText" class="search-count">0</span>
      <button class="search-nav-btn" @click="prevMatch" title="上一个 (Shift+F3)">▲</button>
      <button class="search-nav-btn" @click="nextMatch" title="下一个 (F3)">▼</button>
      <button class="search-nav-btn" @click="closeSearch" title="关闭 (Esc)"><IconClose :size="14" /></button>
    </div>
    <div class="view-body">
    <div class="content-body" ref="contentBodyRef" @scroll="onContentScroll">
      <div v-if="loading" class="loading">
        <div class="spinner"></div>
      </div>
      <template v-else-if="displayMessages.length > 0">
        <div v-if="hasMoreMessages" class="load-more-bar">
          <button class="load-more-btn" @click="loadMoreMessages" :disabled="loadingMore">
            {{ loadingMore ? '加载中...' : `加载更早的消息 (${displayMessages.length - visibleCount} 条)` }}
          </button>
        </div>
        <template v-for="item in visibleMessages" :key="item.uuid">
        <!-- 系统事件：中断 → 分隔线，通知 → 气泡 -->
        <div v-if="item.isSystemEvent && item.systemEventType === 'interrupt'" class="system-event">
          <div class="system-event-line"></div>
          <div class="system-event-content">
            <IconStop :size="12" />
            <span>用户中断了请求</span>
            <span class="system-event-time">{{ formatTime(item.timestamp) }}</span>
          </div>
          <div class="system-event-line"></div>
        </div>
        <!-- 文件历史快照：checkpoint 标记 -->
        <div v-else-if="item.isSnapshot" class="snapshot-checkpoint">
          <div class="snapshot-bar" @click="toggleCollapse(item.uuid + '-snap')">
            <div class="snapshot-line"></div>
            <div class="snapshot-center">
              <span class="snapshot-badge"><IconRestore :size="11" />快照</span>
              <span class="snapshot-meta">{{ formatTime(item.timestamp) }}</span>
              <span class="snapshot-file-count">{{ Object.keys(item.snapshotData.trackedFileBackups).length }} 个文件</span>
              <span class="collapse-icon">{{ isCollapsed(item.uuid + '-snap') ? '▸' : '▾' }}</span>
            </div>
            <div class="snapshot-line"></div>
            <button v-if="!session.isSubagent" class="snapshot-restore-btn" @click.stop="openRestoreDialog(item)">
              <IconRestore :size="12" />
              恢复
            </button>
          </div>
          <div v-if="!isCollapsed(item.uuid + '-snap')" class="snapshot-files">
            <span v-for="(_, filePath) in item.snapshotData.trackedFileBackups" :key="filePath" class="snapshot-file-chip">{{ filePath }}</span>
          </div>
        </div>
        <!-- 上下文压缩摘要，默认折叠 -->
        <div v-else-if="item.isCompactSummary" class="message-compact-summary" :data-uuid="item.uuid">
          <div class="compact-summary-header clickable" @click="toggleCollapse(item.uuid + '-summary')">
            <span class="role-badge role-summary">上下文压缩</span>
            <span class="message-time">{{ formatTime(item.timestamp) }}</span>
            <button v-if="!session.isSubagent && currentProvider?.supportsFork !== false" class="summary-fork-btn" @click.stop="emit('fork-summary', item)" title="以此摘要创建新会话分支">
              <IconFork :size="12" />
            </button>
            <span class="collapse-icon summary-collapse-icon">{{ isCollapsed(item.uuid + '-summary') ? '▸' : '▾' }}</span>
          </div>
          <div v-if="!isCollapsed(item.uuid + '-summary')" class="compact-summary-body">
            <template v-for="(block, idx) in parseContentBlocks(item)" :key="idx">
              <div v-if="block.type === 'text'" class="block-text">{{ block.text }}</div>
            </template>
          </div>
        </div>
        <div v-else-if="item.isSystemEvent" class="message message-system-notify">
          <div class="message-header">
            <span class="role-badge role-system-notify">系统</span>
            <span class="message-time">{{ formatTime(item.timestamp) }}</span>
          </div>
          <div class="message-blocks">
            <template v-for="(block, idx) in mergeToolBlocks(parseContentBlocks(item))" :key="idx">
              <template v-if="block.type === 'text'">
                <template v-if="hasXmlTags(block.text)">
                  <template v-for="(seg, si) in parseTextSegments(block.text)" :key="si">
                    <div v-if="seg.type === 'plain'" class="block-text">{{ seg.text }}</div>
                    <div v-else class="xml-tag-block" :class="'xml-' + seg.style">
                      <span class="xml-tag-label">{{ seg.label }}</span>
                      <span v-if="seg.text" class="xml-tag-content">{{ seg.text }}</span>
                    </div>
                  </template>
                </template>
                <div v-else class="block-text">{{ block.text }}</div>
              </template>
              <div v-else-if="block.type === 'tool_result'" class="tool-card">
                <div class="tool-card-header clickable" @click="toggleCollapse(item.uuid + '-result-' + idx)">
                  <span class="block-tag tag-result">Result</span>
                  <span class="collapse-icon">{{ isCollapsed(item.uuid + '-result-' + idx) ? '▸' : '▾' }}</span>
                </div>
                <div v-if="!isCollapsed(item.uuid + '-result-' + idx)" class="tool-card-body">
                  <div class="tool-card-section"><div class="tool-card-code">{{ block.content }}</div></div>
                </div>
              </div>
            </template>
          </div>
        </div>
            <!-- 普通消息 -->
        <div v-else
          class="message"
          :class="[('message-' + getMessageRole(item)), { 'message-api-error': item.isApiErrorMessage }]"
          :data-uuid="item.uuid"
        >
          <div class="message-header">
            <span class="role-badge" :class="item.isApiErrorMessage ? 'role-error' : ('role-' + getMessageRole(item))">
              {{ item.isApiErrorMessage ? '错误' : displayRoleLabel(getMessageRole(item)) }}
            </span>
            <span class="message-time">{{ formatTime(item.timestamp) }}</span>
          </div>
          <div class="message-blocks">
            <template v-for="(block, idx) in mergeToolBlocks(parseContentBlocks(item))" :key="idx">
              <!-- 中断提示 -->
              <div v-if="block.type === 'text' && /^\[Request interrupted by user/.test(block.text)" class="block-interrupted">
                <IconStop />
                用户中断了请求
              </div>
              <!-- 文本（可能包含 XML 标签） -->
              <template v-else-if="block.type === 'text'">
                <template v-if="hasXmlTags(block.text)">
                  <template v-for="(seg, si) in parseTextSegments(block.text)" :key="si">
                    <div v-if="seg.type === 'plain' && getMessageRole(item) === 'assistant'" class="md-content" v-html="renderMarkdown(seg.text)"></div>
                    <div v-else-if="seg.type === 'plain'" class="block-text">{{ seg.text }}</div>
                    <div v-else class="xml-tag-block" :class="'xml-' + seg.style">
                      <span class="xml-tag-label">{{ seg.label }}</span>
                      <span v-if="seg.text" class="xml-tag-content">{{ seg.text }}</span>
                    </div>
                  </template>
                </template>
                <div v-else-if="getMessageRole(item) === 'assistant'" class="md-content" v-html="renderMarkdown(block.text)"></div>
                <div v-else class="block-text">{{ block.text }}</div>
              </template>

              <!-- 思考过程 -->
              <div v-else-if="block.type === 'thinking'" class="block-thinking">
                <div class="block-header clickable" @click="toggleCollapse(item.uuid + '-thinking-' + idx)">
                  <span class="block-tag tag-thinking">Thinking</span>
                  <span class="collapse-icon">{{ isCollapsed(item.uuid + '-thinking-' + idx) ? '▸' : '▾' }}</span>
                </div>
                <div v-if="!isCollapsed(item.uuid + '-thinking-' + idx)" class="block-body">{{ block.text }}</div>
              </div>

              <!-- 命令注入提示词（isMeta），默认折叠 -->
              <div v-else-if="block.type === 'meta'" class="block-thinking">
                <div class="block-header clickable" @click="toggleCollapse(item.uuid + '-meta-' + idx)">
                  <span class="block-tag tag-meta">Prompt</span>
                  <span class="collapse-icon">{{ isCollapsed(item.uuid + '-meta-' + idx) ? '▸' : '▾' }}</span>
                </div>
                <div v-if="!isCollapsed(item.uuid + '-meta-' + idx)" class="block-body">{{ block.text }}</div>
              </div>

              <!-- 工具调用（含结果） -->
              <div v-else-if="block.type === 'tool_call'" class="tool-card" :class="{ 'tool-error': block.isError }">
                <div class="tool-card-header clickable" @click="toggleCollapse(item.uuid + '-tool-' + idx)">
                  <span class="block-tag" :class="block.isError ? 'tag-error' : 'tag-tool'">{{ block.name }}</span>
                  <span v-if="getToolSummary(block.name, block.input)" class="tool-summary" :data-full-path="block.input?.file_path || block.input?.path || ''">{{ getToolSummary(block.name, block.input) }}</span>
                  <a v-if="agentToolUseMap[block.id]" class="view-subagent-link" @click.stop="emit('open-session-window', agentToolUseMap[block.id])" title="新窗口查看子对话">查看</a>
                  <span class="collapse-icon">{{ isCollapsed(item.uuid + '-tool-' + idx) ? '▸' : '▾' }}</span>
                </div>
                <div v-if="!isCollapsed(item.uuid + '-tool-' + idx)" class="tool-card-body">
                  <!-- Edit diff view -->
                  <template v-if="block.name === 'Edit' && block.input?.old_string">
                    <div class="diff-view">
                      <div class="diff-stats">
                        <span class="diff-stat-add">+{{ getDiff(block).added }} added</span>
                        <span class="diff-stat-del">-{{ getDiff(block).removed }} removed</span>
                        <span v-if="block.input.replace_all" class="diff-meta">replace_all</span>
                      </div>
                      <div v-for="(line, li) in getDiff(block).lines" :key="li" class="diff-line" :class="'diff-' + line.type">
                        <span class="diff-sign">{{ line.sign }}</span>
                        <span class="diff-text"><template v-for="(part, pi) in line.parts" :key="pi"><span v-if="part.hl" class="diff-hl">{{ part.text }}</span><template v-else>{{ part.text }}</template></template></span>
                      </div>
                    </div>
                  </template>
                  <template v-else-if="block.name === 'Bash' && block.input?.command">
                    <div class="tool-card-section">
                      <div class="md-content bash-code-block" v-html="renderMarkdown('```bash\n' + block.input.command + '\n```')"></div>
                    </div>
                    <div v-if="block.input.description" class="tool-card-section">
                      <div class="tool-card-code">description: {{ block.input.description }}</div>
                    </div>
                  </template>
                  <template v-else>
                    <div class="tool-card-section">
                      <div class="tool-card-code">{{ formatToolInput(block.input) }}</div>
                    </div>
                  </template>
                  <div v-if="block.result !== null" class="tool-card-section">
                    <div class="tool-card-code" :class="{ 'error-text': block.isError }">{{ block.result }}</div>
                  </div>
                </div>
              </div>

              <!-- 未匹配的独立工具结果 -->
              <div v-else-if="block.type === 'tool_result'" class="tool-card" :class="{ 'tool-error': block.isError }">
                <div class="tool-card-header clickable" @click="toggleCollapse(item.uuid + '-result-' + idx)">
                  <span class="block-tag" :class="block.isError ? 'tag-error' : 'tag-result'">{{ block.isError ? 'Error' : 'Result' }}</span>
                  <span class="collapse-icon">{{ isCollapsed(item.uuid + '-result-' + idx) ? '▸' : '▾' }}</span>
                </div>
                <div v-if="!isCollapsed(item.uuid + '-result-' + idx)" class="tool-card-body">
                  <div class="tool-card-section">
                    <div class="tool-card-code">{{ block.content }}</div>
                  </div>
                </div>
              </div>

              <!-- 图片 -->
              <div v-else-if="block.type === 'image'">
                <template v-if="block.source?.type === 'base64'">
                  <img
                    :src="'data:' + (block.source.media_type || 'image/png') + ';base64,' + block.source.data"
                    class="inline-image"
                    @click="$emit('preview-image', 'data:' + (block.source.media_type || 'image/png') + ';base64,' + block.source.data, block.source.media_type || 'image/png')"
                  />
                </template>
                <span v-else class="muted">[图片]</span>
              </div>

              <!-- 未知类型 -->
              <div v-else class="block-unknown">
                <span class="muted">[{{ block.type }}]</span>
              </div>
            </template>
          </div>
          <!-- AI 用量统计 -->
          <div v-if="getMessageRole(item) === 'assistant' && item._stats && item._stats.output_tokens" class="message-stats">
            <span v-if="item._stats.model" class="stat-item">{{ item._stats.model }}</span>
            <span class="stat-item" title="输入 / 输出 tokens">{{ formatTokens(item._stats.input_tokens + item._stats.cache_read) }} / {{ formatTokens(item._stats.output_tokens) }} tokens</span>
            <span v-if="item._stats.cache_read" class="stat-item" title="缓存读取">cache {{ formatTokens(item._stats.cache_read) }}</span>
            <span v-if="item._stats.durationMs" class="stat-item">{{ formatDuration(item._stats.durationMs) }}</span>
            <span v-if="item._stats.stop_reason" class="stat-item">{{ item._stats.stop_reason }}</span>
          </div>
          <!-- 悬浮操作按钮 -->
          <div class="message-actions">
            <button class="msg-action-btn" @click="copyMessageText(item)" title="复制文本">
              <IconCopy :size="12" />
            </button>
            <button v-if="getMessageRole(item) === 'assistant' && !session.isSubagent && currentProvider?.supportsFork !== false" class="msg-action-btn" @click="emit('fork', item)" title="从此处分叉创建新会话">
              <IconFork :size="12" />
            </button>
          </div>
        </div>
        </template>
        <!-- 仅有压缩摘要时的引导提示 -->
        <div v-if="isCompressedOnlySession" class="compressed-only-hint" @click="emit('resume')">
          <div class="compressed-hint-icon-ring">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 2a4 4 0 0 1 4 4c0 1.5-.8 2.8-2 3.5V12h-4V9.5A4 4 0 0 1 8 6a4 4 0 0 1 4-4z"/>
              <path d="M8 12H6a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h1"/>
              <path d="M16 12h2a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2h-1"/>
              <rect x="9" y="12" width="6" height="8" rx="1"/>
              <path d="M9 18h6"/>
            </svg>
          </div>
          <p class="compressed-hint-title">这是一个压缩后的会话</p>
          <p class="compressed-hint-desc">AI 将保留之前对话的记忆<br>点击立即在终端中恢复对话</p>
          <div class="compressed-hint-btn">
            <IconTerminal :size="14" />
            <span>恢复对话</span>
          </div>
        </div>
      </template>
      <div v-else class="empty-content">会话内容为空</div>
    </div>
    <!-- 消息大纲侧边栏 -->
    <div v-if="showOutline" class="outline-sidebar">
      <div class="outline-header">消息大纲</div>
      <div class="outline-list">
        <div
          v-for="it in getOutlineItems()"
          :key="it.uuid"
          class="outline-item"
          :class="{ 'outline-item-summary': it.isCompactSummary }"
          @click="scrollToMessage(it.uuid)"
        >
          <template v-if="it.isCompactSummary">
            <span class="outline-summary-tag">上下文压缩</span>
          </template>
          <template v-else>
            <span class="outline-index">{{ it.index }}</span>
            <span class="outline-text">{{ it.text }}</span>
          </template>
        </div>
        <div v-if="getOutlineItems().length === 0" class="outline-empty">无用户消息</div>
      </div>
    </div>
    <!-- 滚动按钮 -->
    <div class="scroll-buttons">
      <button class="scroll-btn" @click="scrollToTop" title="滚动到顶部">
        <IconChevronUp />
      </button>
      <button class="scroll-btn" @click="scrollToBottom" title="滚动到底部">
        <IconChevronDown />
      </button>
    </div>
    </div>
    <!-- 底部恢复会话栏 -->
    <div v-if="!isCompressedOnlySession && session.sessionId && !session.isSubagent" class="bottom-resume-bar">
      <button class="bottom-resume-btn" @click="emit('resume')">
        <IconTerminal :size="15" />
        <span>在终端中恢复此会话</span>
      </button>
    </div>
  </template>
  <!-- 未选择会话 -->
  <div v-else class="empty-main">
    <IconChat :size="64" style="opacity: 0.2" />
    <p>选择一个会话查看详情</p>
  </div>

  <!-- 导出选项对话框 -->
  <ExportOptionsDialog
    :show="exportDialog.show"
    :format="exportDialog.format"
    @confirm="doExportWithOptions"
    @cancel="exportDialog.show = false"
  />

  <!-- 快照恢复确认对话框 -->
  <div v-if="snapshotDialog.show" class="restore-overlay" @click.self="snapshotDialog.show = false">
    <div class="restore-dialog" :class="{ 'restore-dialog-wide': snapshotDialog.step === 2 }">

      <!-- 步骤一：选择文件 -->
      <template v-if="snapshotDialog.step === 1">
        <div class="restore-dialog-header">
          <IconRestore :size="16" style="color: #00897b" />
          <span>恢复文件到此快照</span>
          <span class="restore-step-hint">第 1 步 / 共 2 步</span>
        </div>
        <div class="restore-dialog-body">
          <p class="restore-desc">
            选择要恢复的文件（已选 <strong>{{ snapshotDialog.selected.size }}</strong> / {{ Object.keys(snapshotDialog.item?.snapshotData?.trackedFileBackups || {}).length }}）：
          </p>
          <div class="restore-file-list">
            <label
              v-for="(backup, filePath) in snapshotDialog.item?.snapshotData?.trackedFileBackups"
              :key="filePath"
              class="restore-file-row"
              :class="{ 'restore-file-unchecked': !snapshotDialog.selected.has(filePath) }"
            >
              <input type="checkbox" class="restore-file-checkbox"
                :checked="snapshotDialog.selected.has(filePath)"
                @change="toggleSnapshotFile(filePath)" />
              <span class="restore-file-path">{{ filePath }}</span>
              <span class="restore-file-version">v{{ backup.version }}</span>
            </label>
          </div>
        </div>
        <div class="restore-dialog-footer">
          <button class="restore-btn-cancel" @click="snapshotDialog.show = false">取消</button>
          <button class="restore-btn-confirm" @click="goToStep2" :disabled="snapshotDialog.selected.size === 0">
            下一步 →
          </button>
        </div>
      </template>

      <!-- 步骤二：diff 预览 -->
      <template v-else>
        <div class="restore-dialog-header">
          <IconRestore :size="16" style="color: #00897b" />
          <span>变更预览</span>
          <span class="restore-step-hint">第 2 步 / 共 2 步</span>
        </div>
        <div class="restore-diff-tabs">
          <button
            v-for="(fd, idx) in snapshotDialog.diffData" :key="fd.filePath"
            class="restore-diff-tab"
            :class="{ active: snapshotDialog.activeFile === idx, unchanged: fd.unchanged }"
            @click="snapshotDialog.activeFile = idx"
          >
            {{ fd.fileName }}
            <template v-if="!fd.unchanged">
              <span v-if="fd.dels" class="diff-tab-del">-{{ fd.dels }}</span>
              <span v-if="fd.adds" class="diff-tab-add">+{{ fd.adds }}</span>
            </template>
            <span v-else class="diff-tab-same">unchanged</span>
          </button>
        </div>
        <div class="restore-diff-body">
          <template v-if="snapshotDialog.diffData[snapshotDialog.activeFile]">
            <div v-if="snapshotDialog.diffData[snapshotDialog.activeFile].unchanged" class="diff-unchanged">
              文件内容与快照相同，无需恢复
            </div>
            <div v-else class="diff-view-wrap">
              <div
                v-for="(line, li) in snapshotDialog.diffData[snapshotDialog.activeFile].lines"
                :key="li"
                class="diff-line"
                :class="'diff-' + line.type"
              >
                <span class="diff-sign">{{ line.type === 'add' ? '+' : line.type === 'del' ? '-' : line.type === 'fold' ? '⋯' : ' ' }}</span>
                <span v-if="line.type === 'fold'" class="diff-fold-text">{{ line.count }} 行未变更</span>
                <span v-else-if="line.type === 'info'" class="diff-fold-text">{{ line.text }}</span>
                <span v-else class="diff-text">{{ line.text }}</span>
              </div>
            </div>
          </template>
        </div>
        <div class="restore-dialog-footer">
          <button class="restore-btn-cancel" @click="snapshotDialog.step = 1">← 上一步</button>
          <button class="restore-btn-confirm" @click="doRestoreSnapshot" :disabled="snapshotDialog.restoring">
            <IconRestore :size="13" />
            {{ snapshotDialog.restoring ? '恢复中…' : `确认恢复 ${snapshotDialog.selected.size} 个文件` }}
          </button>
        </div>
      </template>

    </div>
  </div>
</template>

<style scoped>
.content-header {
  padding: 10px 16px 8px;
  border-bottom: 1px solid #e8e8e8;
  background: #fafafa;
}
:global(.dark .content-header) {
  background: #1a1a1a;
  border-color: #2a2a2a;
}
.content-header-top {
  display: flex;
  align-items: center;
  gap: 2px;
}
.content-header h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  line-height: 1.4;
}
.content-header-sub {
  display: flex;
  align-items: center;
  margin-top: 2px;
  gap: 2px;
}
.content-cwd {
  font-size: 11px;
  opacity: 0.45;
  font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
  user-select: all;
}
.resume-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border: none;
  background: none;
  border-radius: 4px;
  cursor: pointer;
  color: inherit;
  opacity: 0.5;
  margin-left: 4px;
}
.resume-btn:hover {
  opacity: 1;
  background: rgba(0,0,0,0.06);
}
:global(.dark .resume-btn:hover) {
  background: rgba(255,255,255,0.08);
}

/* Header action buttons */
.header-action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  background: none;
  border-radius: 4px;
  cursor: pointer;
  color: inherit;
  opacity: 0.4;
}
.header-action-btn:hover {
  opacity: 1;
  background: rgba(0,0,0,0.06);
}
:global(.dark .header-action-btn:hover) {
  background: rgba(255,255,255,0.08);
}
.more-wrapper {
  position: relative;
}
.more-menu {
  position: absolute;
  right: 0;
  top: 100%;
  z-index: 100;
  background: #fff;
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.1);
  overflow: visible;
  min-width: 160px;
  padding: 4px 0;
}
:global(.dark .more-menu) {
  background: #2a2a2a;
  border-color: #444;
}
.more-menu button, .menu-sub-trigger {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 14px;
  border: none;
  background: none;
  color: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}
.more-menu button:hover, .menu-sub-trigger:hover {
  background: rgba(0,0,0,0.04);
}
:global(.dark .more-menu button:hover), :global(.dark .menu-sub-trigger:hover) {
  background: rgba(255,255,255,0.06);
}
.menu-danger { color: #d32f2f !important; }
:global(.dark .menu-danger) { color: #ef9a9a !important; }
.menu-divider {
  height: 1px;
  background: rgba(0,0,0,0.08);
  margin: 4px 0;
}
:global(.dark .menu-divider) {
  background: rgba(255,255,255,0.08);
}
.menu-sub-wrapper {
  position: relative;
}
.menu-arrow {
  margin-left: auto;
  font-size: 11px;
  opacity: 0.5;
}
.menu-sub {
  position: absolute;
  right: 100%;
  top: -4px;
  background: #fff;
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.1);
  min-width: 140px;
  padding: 4px 0;
}
:global(.dark .menu-sub) {
  background: #2a2a2a;
  border-color: #444;
}
.menu-sub button {
  display: block;
  width: 100%;
  padding: 7px 14px;
  border: none;
  background: none;
  color: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}
.menu-sub button:hover {
  background: rgba(0,0,0,0.04);
}
:global(.dark .menu-sub button:hover) {
  background: rgba(255,255,255,0.06);
}

/* Session search bar */
.session-search-bar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 12px;
  background: #fff;
  border-bottom: 1px solid #e0e0e0;
}
:global(.dark .session-search-bar) {
  background: #1e1e1e;
  border-color: #333;
}
.session-search-input {
  flex: 1;
  border: 1px solid #ddd;
  border-radius: 4px;
  padding: 4px 8px;
  font-size: 13px;
  outline: none;
  background: inherit;
  color: inherit;
  font-family: inherit;
}
.session-search-input:focus {
  border-color: #1976d2;
}
:global(.dark .session-search-input) {
  border-color: #444;
}
:global(.dark .session-search-input:focus) {
  border-color: #90caf9;
}
.search-count {
  font-size: 12px;
  opacity: 0.5;
  white-space: nowrap;
}
.search-nav-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  background: none;
  border-radius: 4px;
  cursor: pointer;
  color: inherit;
  opacity: 0.5;
  font-size: 10px;
}
.search-nav-btn:hover {
  opacity: 1;
  background: rgba(0,0,0,0.06);
}
.search-opt-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 22px;
  padding: 0 5px;
  border: 1px solid transparent;
  background: none;
  border-radius: 3px;
  cursor: pointer;
  color: inherit;
  opacity: 0.4;
  font-size: 11px;
  font-weight: 600;
  font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
}
.search-opt-btn:hover {
  opacity: 0.7;
  background: rgba(0,0,0,0.04);
}
.search-opt-btn.active {
  opacity: 1;
  color: #1976d2;
  border-color: #1976d2;
  background: rgba(25,118,210,0.08);
}
:global(.dark .search-opt-btn.active) {
  color: #90caf9;
  border-color: #90caf9;
  background: rgba(144,202,249,0.12);
}

.load-more-bar {
  text-align: center;
  padding: 12px;
}
.load-more-btn {
  padding: 6px 16px;
  border: 1px solid #ddd;
  border-radius: 6px;
  background: none;
  color: inherit;
  font-size: 12px;
  cursor: pointer;
  opacity: 0.7;
  transition: all 0.15s;
}
.load-more-btn:hover { opacity: 1; background: rgba(0,0,0,0.04); }
.load-more-btn:disabled { cursor: default; opacity: 0.4; }
:global(.dark .load-more-btn) { border-color: #444; }
:global(.dark .load-more-btn:hover) { background: rgba(255,255,255,0.06); }

.view-body {
  flex: 1;
  display: flex;
  flex-direction: row;
  position: relative;
  overflow: hidden;
  min-height: 0;
}

.content-body {
  flex: 1;
  overflow: auto;
  padding: 16px;
}

/* Outline sidebar */
.outline-sidebar {
  width: 200px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  border-left: 1px solid #e0e0e0;
  background: #fafafa;
  overflow: hidden;
}
:global(.dark .outline-sidebar) {
  background: #252525;
  border-left-color: #333;
}
.outline-header {
  padding: 8px 12px;
  font-size: 11px;
  font-weight: 600;
  opacity: 0.5;
  border-bottom: 1px solid #e0e0e0;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  flex-shrink: 0;
}
:global(.dark .outline-header) {
  border-bottom-color: #333;
}
.outline-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
}
.outline-item {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 5px 10px;
  cursor: pointer;
  font-size: 12px;
  line-height: 1.4;
}
.outline-item:hover {
  background: rgba(0,0,0,0.05);
}
:global(.dark .outline-item:hover) {
  background: rgba(255,255,255,0.06);
}
.outline-index {
  flex-shrink: 0;
  font-size: 10px;
  opacity: 0.4;
  min-width: 16px;
  padding-top: 1px;
}
.outline-text {
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  opacity: 0.75;
}
.outline-item:hover .outline-text {
  opacity: 1;
}
.outline-empty {
  padding: 12px;
  font-size: 12px;
  opacity: 0.4;
  text-align: center;
}
.outline-item-summary {
  justify-content: center;
  padding: 4px 10px;
}
.outline-summary-tag {
  font-size: 10px;
  padding: 1px 7px;
  border-radius: 8px;
  background: rgba(99, 102, 241, 0.15);
  color: #6366f1;
  border: 1px solid rgba(99, 102, 241, 0.3);
}
:global(.dark .outline-summary-tag) {
  background: rgba(99, 102, 241, 0.2);
  color: #a5b4fc;
  border-color: rgba(99, 102, 241, 0.4);
}

.header-action-btn.active {
  opacity: 1;
  background: rgba(0,0,0,0.07);
}
:global(.dark .header-action-btn.active) {
  background: rgba(255,255,255,0.1);
}

.message {
  margin-bottom: 12px;
  padding: 12px;
  border-radius: 8px;
  position: relative;
}
.message-user {
  background: rgba(25, 118, 210, 0.06);
  border-left: 3px solid rgba(25, 118, 210, 0.4);
}
.message-assistant {
  background: transparent;
}
.message-system {
  background: rgba(0, 0, 0, 0.04);
  opacity: 0.6;
}
.message-system-notify {
  background: rgba(255, 152, 0, 0.08);
  border-left: 3px solid #ff9800;
}
:global(.dark .message-user) {
  background: rgba(144, 202, 249, 0.08);
  border-left-color: rgba(144, 202, 249, 0.3);
}
:global(.dark .message-assistant) {
  background: transparent;
}
:global(.dark .message-system) {
  background: rgba(255, 255, 255, 0.05);
}
:global(.dark .message-system-notify) {
  background: rgba(255, 152, 0, 0.1);
  border-left-color: rgba(255, 152, 0, 0.6);
}
.message-compact-summary {
  margin: 4px 0;
  border-radius: 8px;
  border: 1px solid rgba(99, 102, 241, 0.25);
  background: rgba(99, 102, 241, 0.05);
  overflow: hidden;
}
.compact-summary-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  user-select: none;
}
.compact-summary-body {
  padding: 8px 12px 10px;
  border-top: 1px solid rgba(99, 102, 241, 0.15);
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}
.role-summary {
  background: #6366f1;
  color: #fff;
}
.summary-fork-btn {
  margin-left: auto;
  display: flex;
  align-items: center;
  padding: 2px 6px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: #6366f1;
  cursor: pointer;
  opacity: 0.6;
  transition: opacity 0.15s, background 0.15s;
}
.summary-fork-btn:hover {
  opacity: 1;
  background: rgba(99, 102, 241, 0.12);
}
:global(.dark .summary-fork-btn) {
  color: #a5b4fc;
}
:global(.dark .summary-fork-btn:hover) {
  background: rgba(99, 102, 241, 0.2);
}
.summary-collapse-icon {
  opacity: 0.5;
  font-size: 12px;
}
:global(.dark .message-compact-summary) {
  border-color: rgba(129, 140, 248, 0.3);
  background: rgba(99, 102, 241, 0.08);
}
:global(.dark .compact-summary-body) {
  border-top-color: rgba(129, 140, 248, 0.2);
}
.message-api-error {
  background: rgba(211, 47, 47, 0.06);
  border-left: 3px solid #d32f2f;
}
.message-api-error .block-text,
.message-api-error .md-content {
  color: #d32f2f;
}
:global(.dark .message-api-error) {
  background: rgba(239, 154, 154, 0.08);
  border-left-color: #ef9a9a;
}
:global(.dark .message-api-error .block-text),
:global(.dark .message-api-error .md-content) {
  color: #ef9a9a;
}
.role-error {
  background: #d32f2f;
  color: #fff;
}

.message-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.role-badge {
  font-size: 11px;
  padding: 2px 10px;
  border-radius: 4px;
  font-weight: 600;
  letter-spacing: 0.02em;
}
.role-user {
  background: #1976d2;
  color: #fff;
}
.role-assistant {
  background: linear-gradient(135deg, #e8eaf6, #e0e0e0);
  color: #424242;
}
:global(.dark .role-assistant) {
  background: linear-gradient(135deg, #2a2a2a, #333);
  color: #ccc;
}
.role-system-notify {
  background: #ff9800;
  color: #fff;
}
.role-badge:not(.role-user):not(.role-assistant):not(.role-system-notify):not(.role-summary) {
  background: rgba(0,0,0,0.1);
}
:global(.dark .role-badge:not(.role-user):not(.role-assistant):not(.role-system-notify):not(.role-summary)) {
  background: rgba(255,255,255,0.15);
}
.message-time {
  font-size: 12px;
  opacity: 0.5;
}

.message-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  margin-top: 6px;
  padding-top: 4px;
  border-top: 1px solid rgba(0,0,0,0.05);
  font-size: 11px;
  opacity: 0.45;
}
:global(.dark .message-stats) {
  border-top-color: rgba(255,255,255,0.06);
}
.stat-item {
  white-space: nowrap;
}

.message-actions {
  display: none;
  position: sticky;
  bottom: 90px;
  float: right;
  gap: 2px;
  background: rgba(255,255,255,0.92);
  border-radius: 6px;
  padding: 2px;
  box-shadow: 0 1px 6px rgba(0,0,0,0.12);
  z-index: 10;
  margin-top: -28px;
  margin-right: 4px;
}
:global(.dark .message-actions) {
  background: rgba(40,40,40,0.92);
  box-shadow: 0 1px 6px rgba(0,0,0,0.3);
}
.message:hover .message-actions {
  display: flex;
}
.msg-action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: none;
  color: inherit;
  cursor: pointer;
  opacity: 0.5;
  padding: 4px;
  border-radius: 3px;
  width: 24px;
  height: 24px;
}
.msg-action-btn:hover {
  opacity: 1;
  background: rgba(0,0,0,0.08);
}
:global(.dark .msg-action-btn:hover) {
  background: rgba(255,255,255,0.1);
}

.message-blocks {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.block-text {
  font-size: 14px;
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.5;
}
.block-header {
  display: flex;
  align-items: center;
  gap: 6px;
}
.block-header.clickable {
  cursor: pointer;
  user-select: none;
}
.block-header.clickable:hover .block-tag {
  filter: brightness(1.1);
}
.tool-summary {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  opacity: 0.6;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
}
.collapse-icon {
  font-size: 11px;
  opacity: 0.5;
  flex-shrink: 0;
}
.block-tag {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 4px;
  font-weight: 600;
  border: 1px solid;
}
.tag-thinking { color: #78909c; border-color: #b0bec5; background: rgba(120,144,156,0.08); }
.tag-tool { color: #546e7a; border-color: #90a4ae; background: rgba(84,110,122,0.06); }
.tag-result { color: #558b2f; border-color: #aed581; background: rgba(85,139,47,0.06); }
.tag-error { color: #d32f2f; border-color: #ef9a9a; background: rgba(211,47,47,0.06); }
.tag-meta { color: #7b1fa2; border-color: #ce93d8; background: rgba(156,39,176,0.08); }
:global(.dark .tag-thinking) { color: #90a4ae; border-color: #546e7a; background: rgba(144,164,174,0.1); }
:global(.dark .tag-tool) { color: #b0bec5; border-color: #546e7a; background: rgba(176,190,197,0.08); }
:global(.dark .tag-result) { color: #a5d6a7; border-color: #4a6e4b; background: rgba(165,214,167,0.08); }
:global(.dark .tag-error) { color: #ef9a9a; border-color: #7a3333; background: rgba(239,154,154,0.1); }
:global(.dark .tag-meta) { color: #ce93d8; border-color: #7b1fa2; background: rgba(206,147,216,0.1); }

.block-body {
  margin-top: 4px;
  padding: 8px 10px;
  border-radius: 6px;
  font-size: 13px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 400px;
  overflow: auto;
  background: rgba(0,0,0,0.04);
}
:global(.dark .block-body) {
  background: rgba(255,255,255,0.05);
}

.tool-card {
  border-left: 2px solid rgba(0,0,0,0.12);
  border-radius: 0 6px 6px 0;
  background: rgba(0, 0, 0, 0.02);
  overflow: hidden;
}
.tool-card.tool-error {
  border-left-color: rgba(211, 47, 47, 0.4);
  background: rgba(211, 47, 47, 0.03);
}
:global(.dark .tool-card) {
  border-left-color: rgba(255,255,255,0.12);
  background: rgba(255, 255, 255, 0.03);
}
:global(.dark .tool-card.tool-error) {
  border-left-color: rgba(239, 154, 154, 0.3);
  background: rgba(239, 154, 154, 0.05);
}
.tool-card-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 10px;
  cursor: pointer;
  user-select: none;
}
.view-subagent-link {
  font-size: 11px;
  padding: 1px 6px;
  background: rgba(103, 58, 183, 0.08);
  color: #673ab7;
  border-radius: 3px;
  cursor: pointer;
  flex-shrink: 0;
  text-decoration: none;
  line-height: 18px;
  white-space: nowrap;
}
.view-subagent-link:hover {
  background: rgba(103, 58, 183, 0.18);
}
:global(.dark .view-subagent-link) {
  background: rgba(179, 157, 219, 0.12);
  color: #b39ddb;
}
:global(.dark .view-subagent-link:hover) {
  background: rgba(179, 157, 219, 0.22);
}
.tool-card-header:hover {
  background: rgba(0,0,0,0.03);
}
:global(.dark .tool-card-header:hover) {
  background: rgba(255,255,255,0.04);
}
.tool-card-body {
  border-top: 1px solid rgba(0,0,0,0.06);
  padding-left: 22px;
}
:global(.dark .tool-card-body) {
  border-top-color: rgba(255,255,255,0.08);
}
.tool-card-section + .tool-card-section {
  border-top: 1px dashed rgba(0,0,0,0.08);
}
:global(.dark .tool-card-section + .tool-card-section) {
  border-top-color: rgba(255,255,255,0.08);
}
.tool-card-code {
  padding: 8px 10px;
  font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 400px;
  overflow: auto;
}
.bash-code-block pre {
  margin: 0;
  max-height: 400px;
  overflow: auto;
}

/* Diff */
.diff-view {
  font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
  font-size: 12px;
  line-height: 1.55;
  overflow: auto;
  max-height: 500px;
}
.diff-stats {
  display: flex;
  gap: 10px;
  padding: 4px 10px;
  font-size: 11px;
  border-bottom: 1px solid rgba(0,0,0,0.06);
}
:global(.dark .diff-stats) {
  border-bottom-color: rgba(255,255,255,0.08);
}
.diff-stat-add { color: #2e7d32; font-weight: 600; }
.diff-stat-del { color: #d32f2f; font-weight: 600; }
:global(.dark .diff-stat-add) { color: #81c784; }
:global(.dark .diff-stat-del) { color: #ef9a9a; }
.diff-meta { opacity: 0.5; }
.diff-ctx { opacity: 0.7; }
.diff-line {
  display: flex;
  white-space: pre;
}
.diff-sign {
  width: 18px;
  flex-shrink: 0;
  text-align: center;
  user-select: none;
  font-weight: 600;
}
.diff-text {
  flex: 1;
  white-space: pre-wrap;
  word-break: break-all;
  padding-right: 10px;
}
.diff-del {
  background: rgba(255, 0, 0, 0.08);
}
.diff-del .diff-sign { color: #d32f2f; }
:global(.dark .diff-del .diff-sign) { color: #ef9a9a; }
.diff-add {
  background: rgba(0, 160, 0, 0.08);
}
.diff-add .diff-sign { color: #2e7d32; }
:global(.dark .diff-add .diff-sign) { color: #81c784; }
.diff-hl { border-radius: 2px; }
.diff-del .diff-hl { background: rgba(255, 0, 0, 0.2); }
.diff-add .diff-hl { background: rgba(0, 160, 0, 0.2); }
:global(.dark .diff-del) { background: rgba(255, 80, 80, 0.1); }
:global(.dark .diff-add) { background: rgba(80, 200, 80, 0.1); }
:global(.dark .diff-del .diff-hl) { background: rgba(255, 80, 80, 0.25); }
:global(.dark .diff-add .diff-hl) { background: rgba(80, 200, 80, 0.25); }

.error-text { color: #d32f2f; }
:global(.dark .error-text) { color: #ef9a9a; }

.inline-image {
  max-width: 100%;
  max-height: 300px;
  border-radius: 6px;
  margin-top: 4px;
  display: block;
  cursor: zoom-in;
  transition: opacity 0.15s;
}
.inline-image:hover { opacity: 0.85; }

/* System events (interruptions, notifications) */
.system-event {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 4px 0;
  user-select: none;
}
.system-event-line {
  flex: 1;
  height: 1px;
  background: rgba(0, 0, 0, 0.08);
}
:global(.dark .system-event-line) {
  background: rgba(255, 255, 255, 0.08);
}
.system-event-content {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: #e65100;
  white-space: nowrap;
  flex-shrink: 0;
}
:global(.dark .system-event-content) {
  color: #ffb74d;
}
.system-event-text {
  max-width: 300px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.system-event-time {
  opacity: 0.5;
  font-size: 11px;
}

.block-interrupted {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #e65100;
  background: rgba(255, 152, 0, 0.1);
  border: 1px dashed #ff9800;
  border-radius: 6px;
  padding: 4px 10px;
}
:global(.dark .block-interrupted) {
  color: #ffb74d;
  background: rgba(255, 152, 0, 0.12);
  border-color: rgba(255, 152, 0, 0.4);
}
.muted {
  font-size: 13px;
  opacity: 0.5;
}

/* XML tag blocks */
.xml-tag-block {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 6px 10px;
  border-radius: 6px;
  font-size: 13px;
  line-height: 1.5;
  border-left: 3px solid;
}
.xml-tag-label {
  font-size: 11px;
  font-weight: 600;
  padding: 0 5px;
  border-radius: 3px;
  white-space: nowrap;
  flex-shrink: 0;
  line-height: 1.7;
}
.xml-tag-content {
  white-space: pre-wrap;
  word-break: break-word;
  font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
  font-size: 12px;
}
.xml-caveat { background: rgba(255, 152, 0, 0.08); border-color: #ff9800; }
.xml-caveat .xml-tag-label { background: rgba(255, 152, 0, 0.15); color: #e65100; }
:global(.dark .xml-caveat) { background: rgba(255, 152, 0, 0.1); }
:global(.dark .xml-caveat .xml-tag-label) { color: #ffb74d; background: rgba(255, 152, 0, 0.2); }
.xml-stdout { background: rgba(76, 175, 80, 0.06); border-color: #4caf50; }
.xml-stdout .xml-tag-label { background: rgba(76, 175, 80, 0.12); color: #2e7d32; }
:global(.dark .xml-stdout) { background: rgba(76, 175, 80, 0.08); }
:global(.dark .xml-stdout .xml-tag-label) { color: #81c784; background: rgba(76, 175, 80, 0.18); }
.xml-stderr { background: rgba(244, 67, 54, 0.06); border-color: #f44336; }
.xml-stderr .xml-tag-label { background: rgba(244, 67, 54, 0.12); color: #c62828; }
:global(.dark .xml-stderr) { background: rgba(244, 67, 54, 0.08); }
:global(.dark .xml-stderr .xml-tag-label) { color: #ef9a9a; background: rgba(244, 67, 54, 0.18); }
.xml-bash-input { background: rgba(33, 33, 33, 0.06); border-color: #616161; }
.xml-bash-input .xml-tag-label { background: rgba(33, 33, 33, 0.1); color: #424242; }
:global(.dark .xml-bash-input) { background: rgba(255, 255, 255, 0.06); border-color: #9e9e9e; }
:global(.dark .xml-bash-input .xml-tag-label) { color: #bdbdbd; background: rgba(255, 255, 255, 0.1); }
.xml-command { background: rgba(33, 150, 243, 0.06); border-color: #2196f3; }
.xml-command .xml-tag-label { background: rgba(33, 150, 243, 0.12); color: #1565c0; }
:global(.dark .xml-command) { background: rgba(33, 150, 243, 0.08); }
:global(.dark .xml-command .xml-tag-label) { color: #90caf9; background: rgba(33, 150, 243, 0.18); }
.xml-ide { background: rgba(156, 39, 176, 0.06); border-color: #9c27b0; }
.xml-ide .xml-tag-label { background: rgba(156, 39, 176, 0.12); color: #7b1fa2; }
:global(.dark .xml-ide) { background: rgba(156, 39, 176, 0.08); }
:global(.dark .xml-ide .xml-tag-label) { color: #ce93d8; background: rgba(156, 39, 176, 0.18); }
.xml-task { background: rgba(0, 150, 136, 0.06); border-color: #009688; }
.xml-task .xml-tag-label { background: rgba(0, 150, 136, 0.12); color: #00695c; }
:global(.dark .xml-task) { background: rgba(0, 150, 136, 0.08); }
:global(.dark .xml-task .xml-tag-label) { color: #80cbc4; background: rgba(0, 150, 136, 0.18); }

/* Loading & scroll */
.loading {
  display: flex;
  justify-content: center;
  padding: 40px;
}
.spinner {
  width: 32px;
  height: 32px;
  border: 3px solid rgba(0,0,0,0.1);
  border-top-color: #1976d2;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
:global(.dark .spinner) {
  border-color: rgba(255,255,255,0.1);
  border-top-color: #90caf9;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}

.scroll-buttons {
  position: absolute;
  right: 20px;
  bottom: 20px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.empty-content, .empty-main {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  text-align: center;
  opacity: 0.5;
}
.empty-main p {
  margin-top: 12px;
  font-size: 16px;
}

.bottom-resume-bar {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 10px 16px;
  border-top: 1px solid rgba(0,0,0,0.07);
  flex-shrink: 0;
}
:global(.dark .bottom-resume-bar) {
  border-top-color: rgba(255,255,255,0.07);
}
.bottom-resume-btn {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 8px 20px;
  border: 1px solid rgba(0,0,0,0.12);
  border-radius: 20px;
  background: transparent;
  color: inherit;
  font-size: 13px;
  cursor: pointer;
  opacity: 0.45;
  transition: opacity 0.15s, border-color 0.15s, background 0.15s;
}
.bottom-resume-btn:hover {
  opacity: 1;
  border-color: #6366f1;
  color: #6366f1;
  background: rgba(99, 102, 241, 0.06);
}
:global(.dark .bottom-resume-btn) {
  border-color: rgba(255,255,255,0.15);
}
:global(.dark .bottom-resume-btn:hover) {
  border-color: #818cf8;
  color: #a5b4fc;
  background: rgba(99, 102, 241, 0.12);
}

.compressed-only-hint {
  margin: 28px auto 0;
  max-width: 400px;
  padding: 32px 28px 28px;
  border: 1.5px dashed rgba(99, 102, 241, 0.35);
  border-radius: 16px;
  background: rgba(99, 102, 241, 0.04);
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  cursor: pointer;
  transition: background 0.2s, border-color 0.2s, box-shadow 0.2s;
  user-select: none;
}
.compressed-only-hint:hover {
  background: rgba(99, 102, 241, 0.09);
  border-color: rgba(99, 102, 241, 0.6);
  box-shadow: 0 4px 20px rgba(99, 102, 241, 0.12);
}
:global(.dark .compressed-only-hint) {
  border-color: rgba(129, 140, 248, 0.3);
  background: rgba(99, 102, 241, 0.07);
}
:global(.dark .compressed-only-hint:hover) {
  background: rgba(99, 102, 241, 0.14);
  border-color: rgba(129, 140, 248, 0.55);
  box-shadow: 0 4px 20px rgba(99, 102, 241, 0.18);
}
.compressed-hint-icon-ring {
  width: 68px;
  height: 68px;
  border-radius: 50%;
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.15), rgba(139, 92, 246, 0.2));
  border: 1.5px solid rgba(99, 102, 241, 0.3);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #6366f1;
  margin-bottom: 16px;
  transition: transform 0.2s;
}
.compressed-only-hint:hover .compressed-hint-icon-ring {
  transform: scale(1.06);
}
:global(.dark .compressed-hint-icon-ring) {
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.2), rgba(139, 92, 246, 0.25));
  border-color: rgba(129, 140, 248, 0.4);
  color: #a5b4fc;
}
.compressed-hint-title {
  margin: 0 0 8px;
  font-size: 15px;
  font-weight: 600;
  color: #4f46e5;
}
:global(.dark .compressed-hint-title) {
  color: #a5b4fc;
}
.compressed-hint-desc {
  margin: 0 0 20px;
  font-size: 13px;
  line-height: 1.7;
  opacity: 0.65;
}
.compressed-hint-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 18px;
  border-radius: 20px;
  background: #6366f1;
  color: #fff;
  font-size: 13px;
  font-weight: 500;
  transition: background 0.15s, transform 0.15s;
}
.compressed-only-hint:hover .compressed-hint-btn {
  background: #4f46e5;
  transform: translateY(-1px);
}
:global(.dark .compressed-hint-btn) {
  background: #4f46e5;
}
:global(.dark .compressed-only-hint:hover .compressed-hint-btn) {
  background: #4338ca;
}

/* ── 文件历史快照 checkpoint ── */
.snapshot-checkpoint {
  margin: 4px 0 6px;
}
.snapshot-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  user-select: none;
  padding: 3px 0;
  min-height: 24px;
}
.snapshot-bar:hover .snapshot-center {
  opacity: 1;
}
.snapshot-line {
  flex: 1;
  height: 1px;
  background: rgba(0, 137, 123, 0.25);
  min-width: 8px;
}
:global(.dark .snapshot-line) {
  background: rgba(77, 182, 172, 0.25);
}
.snapshot-center {
  display: flex;
  align-items: center;
  gap: 6px;
  opacity: 0.85;
  transition: opacity 0.15s;
  flex-shrink: 0;
}
.snapshot-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 600;
  padding: 1px 7px;
  border-radius: 10px;
  background: rgba(0, 137, 123, 0.12);
  color: #00695c;
  border: 1px solid rgba(0, 137, 123, 0.25);
}
:global(.dark .snapshot-badge) {
  background: rgba(77, 182, 172, 0.15);
  color: #4db6ac;
  border-color: rgba(77, 182, 172, 0.3);
}
.snapshot-meta {
  font-size: 11px;
  color: #00695c;
  opacity: 0.8;
}
:global(.dark .snapshot-meta) {
  color: #4db6ac;
}
.snapshot-file-count {
  font-size: 11px;
  opacity: 0.55;
}
.snapshot-restore-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  font-size: 12px;
  padding: 3px 10px;
  border-radius: 12px;
  border: 1px solid rgba(0, 137, 123, 0.35);
  background: rgba(0, 137, 123, 0.08);
  color: #00695c;
  cursor: pointer;
  font-weight: 500;
  transition: background 0.15s, border-color 0.15s, opacity 0.15s;
  opacity: 0;
}
:global(.dark .snapshot-restore-btn) {
  border-color: rgba(77, 182, 172, 0.35);
  background: rgba(77, 182, 172, 0.1);
  color: #4db6ac;
}
.snapshot-bar:hover .snapshot-restore-btn {
  opacity: 1;
}
.snapshot-restore-btn:hover {
  background: rgba(0, 137, 123, 0.16);
  border-color: rgba(0, 137, 123, 0.5);
}
:global(.dark .snapshot-restore-btn:hover) {
  background: rgba(77, 182, 172, 0.18);
  border-color: rgba(77, 182, 172, 0.5);
}
.snapshot-files {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 6px 4px 4px;
}
.snapshot-file-chip {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 4px;
  background: rgba(0, 137, 123, 0.07);
  color: #00695c;
  border: 1px solid rgba(0, 137, 123, 0.18);
  font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
  word-break: break-all;
}
:global(.dark .snapshot-file-chip) {
  background: rgba(77, 182, 172, 0.1);
  color: #4db6ac;
  border-color: rgba(77, 182, 172, 0.2);
}

/* ── 快照恢复确认弹窗 ── */
.restore-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
}
.restore-dialog {
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.18);
  width: 460px;
  max-width: 90vw;
  overflow: hidden;
}
:global(.dark .restore-dialog) {
  background: #242424;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
}
.restore-dialog-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px 20px 14px;
  font-size: 15px;
  font-weight: 600;
  border-bottom: 1px solid rgba(0, 0, 0, 0.07);
}
:global(.dark .restore-dialog-header) {
  border-bottom-color: rgba(255, 255, 255, 0.08);
}
.restore-dialog-body {
  padding: 16px 20px;
}
.restore-desc {
  font-size: 13px;
  margin: 0 0 12px;
  opacity: 0.8;
  line-height: 1.5;
}
.restore-file-list {
  border: 1px solid rgba(0, 0, 0, 0.09);
  border-radius: 8px;
  overflow: hidden;
  max-height: 240px;
  overflow-y: auto;
  margin-bottom: 12px;
}
:global(.dark .restore-file-list) {
  border-color: rgba(255, 255, 255, 0.1);
}
.restore-file-row {
  display: flex;
  align-items: center;
  padding: 7px 12px;
  font-size: 12px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.05);
  gap: 8px;
  cursor: pointer;
  transition: background 0.1s;
}
.restore-file-row:last-child {
  border-bottom: none;
}
.restore-file-row:hover {
  background: rgba(0, 137, 123, 0.05);
}
:global(.dark .restore-file-row:hover) {
  background: rgba(77, 182, 172, 0.07);
}
:global(.dark .restore-file-row) {
  border-bottom-color: rgba(255, 255, 255, 0.06);
}
.restore-file-row:nth-child(odd) {
  background: rgba(0, 0, 0, 0.02);
}
:global(.dark .restore-file-row:nth-child(odd)) {
  background: rgba(255, 255, 255, 0.03);
}
.restore-file-unchecked {
  opacity: 0.38;
}
.restore-file-checkbox {
  flex-shrink: 0;
  width: 14px;
  height: 14px;
  cursor: pointer;
  accent-color: #00897b;
}
.restore-file-path {
  font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
  word-break: break-all;
  flex: 1;
  min-width: 0;
}
.restore-file-version {
  flex-shrink: 0;
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 4px;
  background: rgba(0, 137, 123, 0.1);
  color: #00695c;
  border: 1px solid rgba(0, 137, 123, 0.2);
}
:global(.dark .restore-file-version) {
  background: rgba(77, 182, 172, 0.12);
  color: #4db6ac;
  border-color: rgba(77, 182, 172, 0.25);
}
.restore-warn {
  font-size: 12px;
  color: #d32f2f;
  background: rgba(211, 47, 47, 0.06);
  border: 1px solid rgba(211, 47, 47, 0.2);
  border-radius: 6px;
  padding: 8px 12px;
  line-height: 1.5;
}
:global(.dark .restore-warn) {
  color: #ef9a9a;
  background: rgba(239, 154, 154, 0.08);
  border-color: rgba(239, 154, 154, 0.2);
}
.restore-dialog-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 14px 20px;
  border-top: 1px solid rgba(0, 0, 0, 0.07);
}
:global(.dark .restore-dialog-footer) {
  border-top-color: rgba(255, 255, 255, 0.08);
}
.restore-btn-cancel {
  padding: 7px 16px;
  border: 1px solid rgba(0, 0, 0, 0.15);
  border-radius: 6px;
  background: none;
  color: inherit;
  font-size: 13px;
  cursor: pointer;
  font-family: inherit;
}
.restore-btn-cancel:hover {
  background: rgba(0, 0, 0, 0.05);
}
:global(.dark .restore-btn-cancel) {
  border-color: rgba(255, 255, 255, 0.15);
}
:global(.dark .restore-btn-cancel:hover) {
  background: rgba(255, 255, 255, 0.07);
}
.restore-btn-confirm {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 7px 18px;
  border: none;
  border-radius: 6px;
  background: #00897b;
  color: #fff;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  font-family: inherit;
  transition: background 0.15s, opacity 0.15s;
}
.restore-btn-confirm:hover {
  background: #00796b;
}
.restore-btn-confirm:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* step hint */
.restore-step-hint {
  margin-left: auto;
  font-size: 11px;
  font-weight: 400;
  opacity: 0.4;
}

/* step 2: wider dialog */
.restore-dialog-wide {
  width: 680px;
}

/* diff file tabs */
.restore-diff-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 8px 16px;
  border-bottom: 1px solid rgba(0,0,0,0.07);
  background: rgba(0,0,0,0.02);
}
:global(.dark .restore-diff-tabs) {
  border-bottom-color: rgba(255,255,255,0.08);
  background: rgba(255,255,255,0.02);
}
.restore-diff-tab {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid rgba(0,0,0,0.12);
  background: none;
  color: inherit;
  font-size: 12px;
  font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
  cursor: pointer;
  opacity: 0.6;
  transition: all 0.15s;
}
.restore-diff-tab:hover { opacity: 0.9; background: rgba(0,0,0,0.04); }
.restore-diff-tab.active {
  opacity: 1;
  background: rgba(0,137,123,0.08);
  border-color: rgba(0,137,123,0.35);
  color: #00695c;
}
:global(.dark .restore-diff-tab) { border-color: rgba(255,255,255,0.12); }
:global(.dark .restore-diff-tab.active) {
  background: rgba(77,182,172,0.12);
  border-color: rgba(77,182,172,0.35);
  color: #4db6ac;
}
.restore-diff-tab.unchanged { opacity: 0.35; }
.diff-tab-del { color: #d32f2f; font-weight: 600; font-size: 11px; }
.diff-tab-add { color: #2e7d32; font-weight: 600; font-size: 11px; }
:global(.dark .diff-tab-del) { color: #ef9a9a; }
:global(.dark .diff-tab-add) { color: #81c784; }
.diff-tab-same { font-size: 10px; opacity: 0.45; }

/* diff body */
.restore-diff-body {
  overflow-y: auto;
  max-height: 380px;
  min-height: 120px;
  font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
  font-size: 12px;
  line-height: 1.55;
}
.diff-unchanged {
  padding: 32px;
  text-align: center;
  font-size: 13px;
  opacity: 0.45;
  font-family: inherit;
}
.diff-view-wrap { display: flex; flex-direction: column; }
.diff-line {
  display: flex;
  white-space: pre;
  min-height: 18px;
}
.diff-line.diff-add { background: rgba(46,125,50,0.1); }
.diff-line.diff-del { background: rgba(211,47,47,0.09); }
.diff-line.diff-fold { background: rgba(0,0,0,0.03); opacity: 0.5; }
:global(.dark .diff-line.diff-add) { background: rgba(129,199,132,0.1); }
:global(.dark .diff-line.diff-del) { background: rgba(239,154,154,0.1); }
:global(.dark .diff-line.diff-fold) { background: rgba(255,255,255,0.03); }
.diff-sign {
  flex-shrink: 0;
  width: 20px;
  text-align: center;
  user-select: none;
  font-weight: 700;
}
.diff-line.diff-add .diff-sign { color: #2e7d32; }
.diff-line.diff-del .diff-sign { color: #d32f2f; }
.diff-line.diff-fold .diff-sign { color: transparent; }
:global(.dark .diff-line.diff-add .diff-sign) { color: #81c784; }
:global(.dark .diff-line.diff-del .diff-sign) { color: #ef9a9a; }
.diff-text {
  flex: 1;
  white-space: pre-wrap;
  word-break: break-all;
  padding-right: 12px;
}
.diff-fold-text {
  flex: 1;
  text-align: center;
  font-size: 11px;
  opacity: 0.55;
  padding: 0 8px;
}
</style>
