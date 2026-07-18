<script setup>
import { computed, ref, watch, onMounted, onUnmounted } from 'vue'
import { IconSettings, IconSearch, IconClose, IconCollapseAll, IconExpandAll, IconRefresh, IconFolder, IconOpenExternal, IconFile, IconEdit, IconDelete, IconSun, IconMoon, IconStar, IconStarOutline, IconCheckbox, IconCheckboxChecked, IconSubagent, IconMore, IconTerminal, IconChat, IconMemory, IconFilter, IconCopy } from './icons'
import { useTheme } from '../composables/useTheme'
import { useSnackbar } from '../composables/useSnackbar'
import { formatTime, formatSize, shortenPath } from '../composables/useFormat'

const props = defineProps({
  projects: Array,
  expandedProjects: Object,
  selectedSession: Object,
  selectedMemory: Object,
  searchQuery: String,
  collapsed: Boolean,
  projectsLoaded: Boolean
})

const emit = defineEmits([
  'update:searchQuery',
  'toggle-project',
  'toggle-all',
  'select-session',
  'rename-session',
  'delete-session',
  'open-project-dir',
  'new-session',
  'select-memory',
  'refresh',
  'open-settings',
  'batch-delete',
  'open-session-window',
  'resume-session',
  'filter-memory-change',
  'delete-project-sessions'
])

const { isDark, toggleTheme } = useTheme()
const { showSnackbar } = useSnackbar()

// Multi-select mode
const multiSelectMode = ref(false)
const selectedPaths = ref(new Set())

function toggleMultiSelect() {
  multiSelectMode.value = !multiSelectMode.value
  if (!multiSelectMode.value) selectedPaths.value = new Set()
}

function toggleSelect(session) {
  if (!multiSelectMode.value) multiSelectMode.value = true
  const s = new Set(selectedPaths.value)
  if (s.has(session.path)) {
    s.delete(session.path)
    if (s.size === 0) multiSelectMode.value = false
  } else {
    s.add(session.path)
  }
  selectedPaths.value = s
}

function batchDelete() {
  if (selectedPaths.value.size === 0) return
  emit('batch-delete', [...selectedPaths.value])
}

function clearMultiSelect() {
  selectedPaths.value = new Set()
  multiSelectMode.value = false
}

function expandSubagents(sessionPath) {
  if (!sessionPath) return
  const s = new Set(expandedSubagents.value)
  s.add(sessionPath)
  expandedSubagents.value = s
}

// Filter state（提前声明，供 defineExpose 和 closeMenu 使用）
const filterOpen = ref(false)
const filterMenuStyle = ref({})
const filterOnlyMemory = ref(false)
const hasActiveFilter = computed(() => filterOnlyMemory.value)

watch(filterOnlyMemory, (val) => {
  emit('filter-memory-change', val)
})

defineExpose({ clearMultiSelect, expandSubagents, filterOnlyMemory })

// Subagent expand/collapse
const expandedSubagents = ref(new Set())
function toggleSubagents(sessionPath) {
  const s = new Set(expandedSubagents.value)
  if (s.has(sessionPath)) s.delete(sessionPath)
  else s.add(sessionPath)
  expandedSubagents.value = s
}

// Favorite toggle
function toggleFavorite(session, event) {
  event.stopPropagation()
  const result = window.services.toggleFavorite(session.path, session.provider)
  if (result.success) emit('refresh')
}

// Session item dropdown menu
const sidebarMenu = ref({ session: null, style: {} })
// Project item dropdown menu
const projectMenu = ref({ project: null, style: {} })

function openMenu(session, event) {
  event.stopPropagation()
  projectMenu.value.project = null
  if (event.type === 'contextmenu') {
    sidebarMenu.value = { session, style: { left: event.clientX + 'px', top: event.clientY + 'px' } }
  } else {
    const rect = event.currentTarget.getBoundingClientRect()
    sidebarMenu.value = { session, style: { right: (window.innerWidth - rect.right) + 'px', top: (rect.bottom + 4) + 'px' } }
  }
}

function openProjectMenu(project, event) {
  event.stopPropagation()
  if (!project.cwd) return
  sidebarMenu.value.session = null
  if (event.type === 'contextmenu') {
    projectMenu.value = { project, style: { left: event.clientX + 'px', top: event.clientY + 'px' } }
  } else {
    const rect = event.currentTarget.getBoundingClientRect()
    projectMenu.value = { project, style: { right: (window.innerWidth - rect.right) + 'px', top: (rect.bottom + 4) + 'px' } }
  }
}

function closeMenu() {
  sidebarMenu.value.session = null
  projectMenu.value.project = null
  filterOpen.value = false
}

function toggleFilterMenu(event) {
  event.stopPropagation()
  if (filterOpen.value) { filterOpen.value = false; return }
  sidebarMenu.value.session = null
  projectMenu.value.project = null
  const rect = event.currentTarget.getBoundingClientRect()
  filterMenuStyle.value = { right: (window.innerWidth - rect.right) + 'px', top: (rect.bottom + 4) + 'px' }
  filterOpen.value = true
}

function menuOpenWindow() {
  const s = sidebarMenu.value.session; closeMenu()
  emit('open-session-window', s)
}

function menuResume() {
  const s = sidebarMenu.value.session; closeMenu()
  emit('resume-session', s)
}

function menuToggleFavorite() {
  const s = sidebarMenu.value.session; closeMenu()
  const result = window.services.toggleFavorite(s.path, s.provider)
  if (result.success) emit('refresh')
}

function menuRename() {
  const s = sidebarMenu.value.session; closeMenu()
  emit('rename-session', s)
}

function menuDelete(event) {
  const s = sidebarMenu.value.session; closeMenu()
  emit('delete-session', s, event)
}

function menuProjectNewSession() {
  const p = projectMenu.value.project; closeMenu()
  emit('new-session', p)
}

function menuProjectOpenDir() {
  const p = projectMenu.value.project; closeMenu()
  emit('open-project-dir', p)
}

function menuProjectDeleteAll() {
  const p = projectMenu.value.project; closeMenu()
  emit('delete-project-sessions', p)
}

const sessionProvider = computed(() => {
  const s = sidebarMenu.value.session
  if (!s?.provider) return null
  return window.services?.getProvider?.(s.provider) || null
})

function menuCopyResumeCmd() {
  const s = sidebarMenu.value.session; closeMenu()
  if (!s?.sessionId) return
  const p = s.provider ? window.services.getProvider(s.provider) : null
  const cmd = p?.getResumeCommand ? p.getResumeCommand(s.sessionId) : `claude --resume ${s.sessionId}`
  window.utools.copyText(cmd)
  showSnackbar('已复制恢复命令')
}

const ctrlHeld = ref(false)
function onKeyDown(e) { if (e.key === 'Control' || e.key === 'Meta') ctrlHeld.value = true }
function onKeyUp(e) { if (e.key === 'Control' || e.key === 'Meta') ctrlHeld.value = false }

onMounted(() => {
  document.addEventListener('click', closeMenu)
  document.addEventListener('keydown', onKeyDown)
  document.addEventListener('keyup', onKeyUp)
})
onUnmounted(() => {
  document.removeEventListener('click', closeMenu)
  document.removeEventListener('keydown', onKeyDown)
  document.removeEventListener('keyup', onKeyUp)
})

const providerFilter = ref('')
const availableProviders = computed(() => window.services?.getAvailableProviders?.() || [])

const PROVIDER_COLORS = { claude: '#d97706', codex: '#059669', gemini: '#2563eb', opencode: '#7c3aed' }
const PROVIDER_SHORT = { claude: 'CC', codex: 'CX', gemini: 'GM', opencode: 'OC' }
const PROVIDER_LABEL = { claude: 'Claude', codex: 'Codex', gemini: 'Gemini', opencode: 'OCode' }
function providerColor(id) { return PROVIDER_COLORS[id] || '#888' }

const allExpanded = computed(() => {
  return props.projects.length > 0 && props.projects.every(p => props.expandedProjects[p.name])
})

const filteredProjects = computed(() => {
  const q = (props.searchQuery || '').trim().toLowerCase()
  let result = props.projects

  // Provider 筛选
  if (providerFilter.value) {
    result = result.filter(p => p.provider === providerFilter.value)
  }

  // 仅展示记忆管理：过滤掉没有记忆的项目
  if (filterOnlyMemory.value) {
    result = result.filter(p => p.hasMemory)
  }

  if (q) {
    result = result.map(project => {
      const sessions = project.sessions.filter(s =>
        s.name.toLowerCase().includes(q) ||
        (s.sessionId && s.sessionId.toLowerCase().includes(q)) ||
        (s.cwd && s.cwd.toLowerCase().includes(q))
      )
      if (project.displayName.toLowerCase().includes(q)) return project
      if (sessions.length === 0 && !project.hasMemory) return null
      return { ...project, sessions }
    }).filter(Boolean)
  }

  // 仅展示记忆管理模式下隐藏会话列表
  return result.map(p => ({
    ...p,
    sessions: filterOnlyMemory.value ? [] : [...p.sessions].sort((a, b) => (b.isFavorite ? 1 : 0) - (a.isFavorite ? 1 : 0)),
  }))
})
</script>

<template>
  <aside class="sidebar" :class="{ collapsed }">
    <div class="sidebar-header">
      <h2>会话管理</h2>
      <div class="header-actions">
        <button class="icon-btn" @click="toggleTheme" :title="isDark ? '切换到亮色模式' : '切换到暗色模式'">
          <IconSun v-if="isDark" />
          <IconMoon v-else />
        </button>
        <button class="icon-btn" @click="emit('open-settings')" title="设置">
          <IconSettings />
        </button>
      </div>
    </div>
    <div class="sidebar-divider"></div>
    <div class="search-bar">
      <div class="search-box">
        <IconSearch class="search-icon" />
        <input
          class="search-input"
          :value="searchQuery"
          @input="emit('update:searchQuery', $event.target.value)"
          placeholder="搜索会话..."
        />
        <button v-if="searchQuery" class="search-clear" @click="emit('update:searchQuery', '')">
          <IconClose :size="14" />
        </button>
        <button class="search-filter-btn" :class="{ active: hasActiveFilter }" @click="toggleFilterMenu" title="过滤">
          <IconFilter :size="14" />
          <span v-if="hasActiveFilter" class="filter-dot"></span>
        </button>
      </div>
      <button class="icon-btn-sm" @click="emit('toggle-all')" :title="allExpanded ? '全部收起' : '全部展开'">
        <IconCollapseAll v-if="allExpanded" />
        <IconExpandAll v-else />
      </button>
      <button class="icon-btn-sm" @click="emit('refresh')" title="刷新">
        <IconRefresh />
      </button>
    </div>
    <!-- Provider 筛选 -->
    <div v-if="availableProviders.length > 1" class="provider-filter">
      <button class="provider-chip" :class="{ active: !providerFilter }" @click="providerFilter = ''">全部</button>
      <button v-for="p in availableProviders" :key="p.id" class="provider-chip" :class="{ active: providerFilter === p.id }" @click="providerFilter = p.id">
        <span class="provider-dot" :style="{ background: providerColor(p.id) }"></span>
        {{ PROVIDER_LABEL[p.id] || p.name }}
      </button>
    </div>
    <!-- 多选操作栏 -->
    <div v-if="multiSelectMode" class="multi-select-bar">
      <span>已选 {{ selectedPaths.size }} 项</span>
      <button class="batch-delete-btn" :disabled="selectedPaths.size === 0" @click="batchDelete">批量删除</button>
      <button class="batch-cancel-btn" @click="toggleMultiSelect">取消</button>
    </div>
    <div class="sidebar-list">
      <template v-if="filteredProjects.length > 0">
        <div v-for="project in filteredProjects" :key="project.name" class="project-group">
          <div class="project-item" @click="emit('toggle-project', project.name, filterOnlyMemory)" @contextmenu.prevent="openProjectMenu(project, $event)">
            <span class="expand-icon">{{ expandedProjects[project.name] ? '▾' : '▸' }}</span>
            <IconFolder class="folder-icon" />
            <span v-if="project.provider" class="provider-badge" :style="{ background: providerColor(project.provider) }">{{ PROVIDER_SHORT[project.provider] || '' }}</span>
            <span class="project-name" :title="project.displayName">{{ shortenPath(project.displayName) }}</span>
            <span v-if="!filterOnlyMemory" class="session-count">{{ project.sessionsLoaded ? project.sessions.length : project.sessionCount }}</span>
            <button v-if="project.cwd" class="project-more-btn" @click.stop="openProjectMenu(project, $event)" title="更多操作">
              <IconMore />
            </button>
          </div>
          <Transition name="session-expand">
          <div v-if="expandedProjects[project.name] || searchQuery?.trim()" class="session-list">
            <!-- 记忆管理固定项（置顶） -->
            <div
              v-if="project.hasMemory"
              class="memory-item"
              :class="{ selected: selectedMemory?.name === project.name }"
              @click="emit('select-memory', project)"
            >
              <IconMemory class="memory-item-icon" />
              <span class="memory-item-label">记忆管理</span>
              <span class="memory-item-meta">{{ formatSize(project.memorySize) }} · {{ project.memoryFileCount }}个文件</span>
            </div>
            <template v-if="!filterOnlyMemory">
            <div v-if="project.sessionsLoading && project.sessions.length === 0" class="sessions-skeleton">
              <div v-for="n in 3" :key="n" class="skeleton-row">
                <span class="skeleton-dot"></span>
                <div class="skeleton-lines">
                  <span class="skeleton-line" :style="{ width: (70 - n * 8) + '%' }"></span>
                  <span class="skeleton-line short"></span>
                </div>
              </div>
            </div>
            <template v-else-if="project.sessions.length > 0">
              <template v-for="session in project.sessions" :key="session.path">
              <div
                class="session-item"
                :class="{ selected: selectedSession?.path === session.path, 'has-subtoggle': session.subagents?.length }"
                @click="emit('select-session', session)"
                @contextmenu.prevent="openMenu(session, $event)"
              >
                <!-- 子对话展开箭头 / 对齐占位 -->
                <span
                  v-if="session.subagents?.length"
                  class="session-sub-toggle"
                  @click.stop="toggleSubagents(session.path)"
                  :title="expandedSubagents.has(session.path) ? '收起子对话' : '展开子对话'"
                >{{ expandedSubagents.has(session.path) ? '▾' : '▸' }}</span>
                <!-- 文件图标 / 复选框 -->
                <span v-if="multiSelectMode || selectedPaths.has(session.path)" class="multi-check" @click.stop="toggleSelect(session)">
                  <IconCheckboxChecked v-if="selectedPaths.has(session.path)" style="color: #1976d2" />
                  <IconCheckbox v-else />
                </span>
                <template v-else>
                  <IconFile class="session-icon session-icon-file" />
                  <span class="session-icon session-icon-check" @click.stop="toggleSelect(session)"><IconCheckbox /></span>
                </template>
                <div class="session-info">
                  <span class="session-name">
                    <IconStar v-if="session.isFavorite" class="fav-star" />
                    {{ session.name }}
                  </span>
                  <span class="session-meta">{{ session.size ? formatSize(session.size) + ' · ' : '' }}{{ formatTime(session.timestamp) }}</span>
                </div>
                <div v-if="!multiSelectMode" class="session-actions">
                  <button class="action-btn" @click.stop="openMenu(session, $event)" title="更多操作">
                    <IconMore />
                  </button>
                </div>
              </div>
              <!-- 子对话列表 -->
              <template v-if="session.subagents?.length && expandedSubagents.has(session.path)">
                <div
                  v-for="sub in session.subagents"
                  :key="sub.path"
                  class="subagent-item"
                  :class="{ selected: selectedSession?.path === sub.path }"
                  @click="emit('select-session', sub)"
                >
                  <IconSubagent class="subagent-icon" />
                  <div class="session-info">
                    <span class="session-name">{{ sub.name }}</span>
                    <span class="session-meta">{{ formatSize(sub.size) }}</span>
                  </div>
                  <div class="session-actions">
                    <button class="action-btn" @click.stop="emit('open-session-window', sub)" title="新窗口打开">
                      <IconOpenExternal />
                    </button>
                  </div>
                </div>
              </template>
              </template>
            </template>
            <div v-else class="empty-sessions">暂无会话</div>
            </template>
          </div>
          </Transition>
        </div>
      </template>
      <div v-else-if="!projectsLoaded" class="empty-state">
        <div class="sidebar-spinner"></div>
        <p>加载中...</p>
      </div>
      <div v-else class="empty-state">
        <IconChat :size="48" style="opacity: 0.3" />
        <p>暂无项目</p>
        <small>未找到 Claude/Codex/Gemini/OpenCode 会话</small>
      </div>
    </div>
  </aside>

  <!-- 会话操作下拉菜单（fixed 定位，不受 overflow 裁剪） -->
  <Transition name="menu-fade">
    <div
      v-if="sidebarMenu.session"
      class="sidebar-item-menu"
      :style="sidebarMenu.style"
      @click.stop
    >
      <button @click="menuOpenWindow">
        <IconOpenExternal :size="13" />
        <span>新窗口打开</span>
      </button>
      <button v-if="sidebarMenu.session?.sessionId" @click="menuResume">
        <IconTerminal :size="13" />
        <span>在终端中恢复</span>
      </button>
      <button v-if="sidebarMenu.session?.sessionId" @click="menuCopyResumeCmd">
        <IconCopy :size="13" />
        <span>复制恢复命令</span>
      </button>
      <button v-if="sessionProvider?.supportsRename !== false" @click="menuToggleFavorite">
        <IconStar v-if="sidebarMenu.session.isFavorite" :size="13" style="color: #ff9800" />
        <IconStarOutline v-else :size="13" />
        <span>{{ sidebarMenu.session.isFavorite ? '取消收藏' : '收藏' }}</span>
      </button>
      <button v-if="sessionProvider?.supportsRename !== false" @click="menuRename">
        <IconEdit :size="13" />
        <span>重命名</span>
      </button>
      <div class="sidebar-item-menu-divider"></div>
      <button class="menu-danger" :class="{ 'menu-danger-direct': ctrlHeld }" @click="menuDelete($event)">
        <IconDelete :size="13" />
        <span>{{ ctrlHeld ? '直接删除' : '删除' }}</span>
      </button>
    </div>
  </Transition>

  <!-- 项目右键菜单 -->
  <Transition name="menu-fade">
    <div
      v-if="projectMenu.project"
      class="sidebar-item-menu"
      :style="projectMenu.style"
      @click.stop
    >
      <button v-if="projectMenu.project?.cwd" @click="menuProjectNewSession">
        <IconTerminal :size="13" />
        <span>新建会话</span>
      </button>
      <button v-if="projectMenu.project?.cwd" @click="menuProjectOpenDir">
        <IconOpenExternal :size="13" />
        <span>打开目录</span>
      </button>
      <div v-if="projectMenu.project?.sessionCount > 0" class="sidebar-item-menu-divider"></div>
      <button v-if="projectMenu.project?.sessionCount > 0" class="menu-danger" @click="menuProjectDeleteAll">
        <IconDelete :size="13" />
        <span>删除所有会话 ({{ projectMenu.project.sessionCount }})</span>
      </button>
    </div>
  </Transition>

  <!-- 过滤下拉菜单 -->
  <Transition name="menu-fade">
    <div
      v-if="filterOpen"
      class="filter-dropdown"
      :style="filterMenuStyle"
      @click.stop
    >
      <div class="filter-dropdown-title">过滤</div>
      <label class="filter-option">
        <input type="checkbox" v-model="filterOnlyMemory" />
        <span>仅展示记忆管理</span>
      </label>
    </div>
  </Transition>
</template>

<style scoped>
.provider-filter {
  display: flex;
  gap: 4px;
  padding: 4px 12px 6px;
  flex-wrap: nowrap;
  overflow-x: auto;
}
.provider-chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 7px;
  border: 1px solid #e0e0e0;
  border-radius: 12px;
  background: none;
  color: inherit;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
  flex-shrink: 0;
}
.provider-chip:hover { background: rgba(0,0,0,0.04); }
.provider-chip.active { border-color: #1976d2; background: rgba(25,118,210,0.08); color: #1976d2; font-weight: 600; }
:global(.dark .provider-chip) { border-color: #444; }
:global(.dark .provider-chip:hover) { background: rgba(255,255,255,0.06); }
:global(.dark .provider-chip.active) { border-color: #90caf9; background: rgba(144,202,249,0.12); color: #90caf9; }
.provider-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
.provider-badge {
  font-size: 9px;
  font-weight: 700;
  color: #fff;
  padding: 0 4px;
  border-radius: 3px;
  line-height: 16px;
  flex-shrink: 0;
}
.sidebar {
  width: 320px;
  min-width: 320px;
  display: flex;
  flex-direction: column;
  background: #f8f9fa;
  border-right: 1px solid #e8e8e8;
  flex-shrink: 0;
  transition: margin-left 0.2s;
  z-index: 20;
}
.sidebar.collapsed {
  margin-left: -320px;
}
:global(.dark .sidebar) {
  background: #161616;
  border-color: #2a2a2a;
}

.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  min-height: 46px;
  box-sizing: border-box;
}
.sidebar-header h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  letter-spacing: -0.01em;
}
.header-actions {
  display: flex;
  gap: 2px;
}
.sidebar-divider {
  height: 1px;
  background: #e0e0e0;
}
:global(.dark .sidebar-divider) {
  background: #333;
}

.search-bar {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px 8px 4px 0;
}
.search-box {
  display: flex;
  align-items: center;
  flex: 1;
  margin: 0 0 0 8px;
  padding: 0 8px;
  border-radius: 6px;
  background: rgba(0,0,0,0.04);
  gap: 6px;
}
:global(.dark .search-box) {
  background: rgba(255,255,255,0.06);
}
.search-icon {
  flex-shrink: 0;
  opacity: 0.4;
}
.search-input {
  flex: 1;
  border: none;
  background: none;
  outline: none;
  font-size: 13px;
  padding: 6px 0;
  color: inherit;
  font-family: inherit;
}
.search-input::placeholder {
  opacity: 0.4;
}
.search-clear {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border: none;
  background: none;
  border-radius: 50%;
  cursor: pointer;
  color: inherit;
  opacity: 0.4;
  flex-shrink: 0;
}
.search-clear:hover {
  opacity: 0.8;
  background: rgba(0,0,0,0.08);
}
:global(.dark .search-clear:hover) {
  background: rgba(255,255,255,0.1);
}

.icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  background: none;
  border-radius: 6px;
  cursor: pointer;
  color: inherit;
  opacity: 0.7;
}
.icon-btn:hover {
  opacity: 1;
  background: rgba(0,0,0,0.06);
}
:global(.dark .icon-btn:hover) {
  background: rgba(255,255,255,0.08);
}

.icon-btn-sm {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  background: none;
  border-radius: 6px;
  cursor: pointer;
  color: inherit;
  opacity: 0.5;
  flex-shrink: 0;
}
.icon-btn-sm:hover {
  opacity: 1;
  background: rgba(0,0,0,0.06);
}
:global(.dark .icon-btn-sm:hover) {
  background: rgba(255,255,255,0.08);
}

.sidebar-list {
  flex: 1;
  overflow: auto;
  padding: 4px 8px;
}

.project-item {
  display: flex;
  align-items: center;
  padding: 6px 10px;
  min-height: 34px;
  border-radius: 8px;
  cursor: pointer;
  gap: 6px;
  user-select: none;
  box-sizing: border-box;
  transition: background 0.13s ease;
}
.project-item:hover {
  background: rgba(0,0,0,0.04);
}
:global(.dark .project-item:hover) {
  background: rgba(255,255,255,0.06);
}
.expand-icon {
  width: 16px;
  text-align: center;
  font-size: 12px;
  opacity: 0.6;
  flex-shrink: 0;
}
.folder-icon {
  color: #1976d2;
  flex-shrink: 0;
}
:global(.dark .folder-icon) {
  color: #90caf9;
}
.project-name {
  flex: 1;
  font-weight: 600;
  font-size: 14px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.session-count {
  font-size: 12px;
  background: rgba(0,0,0,0.08);
  padding: 0 8px;
  border-radius: 10px;
  flex-shrink: 0;
  height: 22px;
  line-height: 22px;
  box-sizing: border-box;
}
:global(.dark .session-count) {
  background: rgba(255,255,255,0.12);
}
.project-more-btn {
  display: none;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  background: none;
  border-radius: 4px;
  cursor: pointer;
  color: inherit;
  opacity: 0.5;
  flex-shrink: 0;
}
.project-item:hover .project-more-btn {
  display: flex;
}
.project-item:hover .session-count {
  display: none;
}
.project-more-btn:hover {
  opacity: 1;
  background: rgba(0,0,0,0.08);
}
:global(.dark .project-more-btn:hover) {
  background: rgba(255,255,255,0.1);
}

.session-list {
  padding-left: 10px;
}
/* 展开/收起动画：仅 opacity + transform，GPU 加速不触发 layout */
.session-expand-enter-active {
  transition: opacity 0.16s ease, transform 0.16s ease;
}
.session-expand-enter-from {
  opacity: 0;
  transform: translateY(-4px);
}
.session-item {
  display: flex;
  align-items: center;
  padding: 6px 10px 6px 22px;
  border-radius: 8px;
  cursor: pointer;
  gap: 8px;
  position: relative;
  transition: background 0.13s ease;
}
.session-item.has-subtoggle {
  padding-left: 0;
}
.session-item:hover {
  background: rgba(0,0,0,0.04);
}
:global(.dark .session-item:hover) {
  background: rgba(255,255,255,0.06);
}
.session-item.selected {
  background: rgba(25, 118, 210, 0.1);
}
/* 选中态左侧强调条 */
.session-item.selected::before {
  content: '';
  position: absolute;
  left: 6px;
  top: 50%;
  transform: translateY(-50%);
  width: 3px;
  height: 60%;
  border-radius: 2px;
  background: #1976d2;
}
.session-item.selected .session-name {
  font-weight: 600;
}
:global(.dark .session-item.selected) {
  background: rgba(144, 202, 249, 0.15);
}
:global(.dark .session-item.selected::before) {
  background: #90caf9;
}
.session-icon {
  flex-shrink: 0;
  opacity: 0.5;
}
.session-icon-check {
  display: none;
  cursor: pointer;
}
.session-item:hover .session-icon-file {
  display: none;
}
.session-item:hover .session-icon-check {
  display: inline;
}
.session-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.session-name {
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.session-meta {
  font-size: 11px;
  opacity: 0.6;
}
.session-actions {
  display: none;
  gap: 2px;
  flex-shrink: 0;
}
.session-item:hover .session-actions,
.subagent-item:hover .session-actions {
  display: flex;
}
.action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  background: none;
  border-radius: 4px;
  cursor: pointer;
  color: inherit;
  opacity: 0.5;
}
.action-btn:hover {
  opacity: 1;
  background: rgba(0,0,0,0.08);
}
.action-btn.delete:hover {
  color: #d32f2f;
  background: rgba(211, 47, 47, 0.08);
}
:global(.dark .action-btn:hover) {
  background: rgba(255,255,255,0.1);
}
:global(.dark .action-btn.delete:hover) {
  color: #ef9a9a;
  background: rgba(239, 154, 154, 0.12);
}

.icon-btn-sm.active {
  opacity: 1;
  color: #1976d2;
}
.multi-select-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 12px;
  font-size: 12px;
  background: rgba(25, 118, 210, 0.08);
  border-bottom: 1px solid rgba(25, 118, 210, 0.2);
}
.batch-delete-btn {
  border: none;
  background: #d32f2f;
  color: #fff;
  font-size: 11px;
  padding: 3px 10px;
  border-radius: 4px;
  cursor: pointer;
}
.batch-delete-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.batch-cancel-btn {
  border: none;
  background: none;
  color: inherit;
  font-size: 11px;
  padding: 3px 8px;
  border-radius: 4px;
  cursor: pointer;
  opacity: 0.6;
}
.batch-cancel-btn:hover {
  background: rgba(0,0,0,0.06);
}
.multi-check {
  flex-shrink: 0;
  cursor: pointer;
  opacity: 0.6;
}
.fav-star {
  color: #ff9800;
  vertical-align: -2px;
  margin-right: 2px;
}

.empty-sessions {
  padding: 6px 30px;
  font-size: 13px;
  opacity: 0.5;
}
.memory-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px 6px 22px;
  border-radius: 8px;
  cursor: pointer;
  margin-bottom: 2px;
  border-bottom: 1px solid rgba(0,0,0,0.06);
}
.memory-item:hover {
  background: rgba(0,0,0,0.04);
}
.memory-item.selected {
  background: rgba(25, 118, 210, 0.1);
}
:global(.dark .memory-item) {
  border-bottom-color: rgba(255,255,255,0.07);
}
:global(.dark .memory-item:hover) {
  background: rgba(255,255,255,0.06);
}
:global(.dark .memory-item.selected) {
  background: rgba(144, 202, 249, 0.15);
}
.memory-item-icon {
  flex-shrink: 0;
  opacity: 0.6;
  color: #1976d2;
}
:global(.dark .memory-item-icon) {
  color: #90caf9;
}
.memory-item-label {
  font-size: 13px;
  font-weight: 500;
  flex: 1;
  min-width: 0;
}
.memory-item-meta {
  font-size: 11px;
  opacity: 0.5;
  white-space: nowrap;
  flex-shrink: 0;
}
.sessions-loading {
  display: flex;
  justify-content: center;
  padding: 8px 0;
}
.sessions-skeleton {
  padding: 2px 10px 2px 22px;
}
.skeleton-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
}
.skeleton-dot {
  width: 14px;
  height: 14px;
  border-radius: 3px;
  flex-shrink: 0;
  background: linear-gradient(90deg, rgba(0,0,0,0.06) 25%, rgba(0,0,0,0.1) 37%, rgba(0,0,0,0.06) 63%);
  background-size: 400% 100%;
  animation: skeleton-shimmer 1.2s ease infinite;
}
.skeleton-lines { flex: 1; display: flex; flex-direction: column; gap: 4px; }
.skeleton-line {
  height: 9px;
  border-radius: 4px;
  background: linear-gradient(90deg, rgba(0,0,0,0.06) 25%, rgba(0,0,0,0.1) 37%, rgba(0,0,0,0.06) 63%);
  background-size: 400% 100%;
  animation: skeleton-shimmer 1.2s ease infinite;
}
.skeleton-line.short { width: 40%; height: 8px; }
@keyframes skeleton-shimmer {
  0% { background-position: 100% 50%; }
  100% { background-position: 0 50%; }
}
:global(.dark) .skeleton-dot,
:global(.dark) .skeleton-line {
  background: linear-gradient(90deg, rgba(255,255,255,0.06) 25%, rgba(255,255,255,0.12) 37%, rgba(255,255,255,0.06) 63%);
  background-size: 400% 100%;
}

.session-sub-toggle {
  width: 14px;
  text-align: center;
  font-size: 11px;
  opacity: 0.5;
  flex-shrink: 0;
  cursor: pointer;
  padding: 2px 0;
  line-height: 1;
}
.session-sub-toggle:hover {
  opacity: 1;
}
.subagent-item {
  display: flex;
  align-items: center;
  padding: 5px 10px 5px 36px;
  border-radius: 8px;
  cursor: pointer;
  gap: 8px;
}
.subagent-item:hover {
  background: rgba(0,0,0,0.04);
}
.subagent-item.selected {
  background: rgba(103, 58, 183, 0.1);
}
:global(.dark .subagent-item:hover) {
  background: rgba(255,255,255,0.06);
}
:global(.dark .subagent-item.selected) {
  background: rgba(179, 157, 219, 0.15);
}
.subagent-icon {
  flex-shrink: 0;
  color: #673ab7;
  opacity: 0.8;
}
:global(.dark .subagent-icon) {
  color: #b39ddb;
}
.sidebar-spinner {
  width: 24px;
  height: 24px;
  border: 3px solid rgba(0,0,0,0.1);
  border-top-color: #1976d2;
  border-radius: 50%;
  animation: sidebar-spin 0.8s linear infinite;
}
:global(.dark .sidebar-spinner) {
  border-color: rgba(255,255,255,0.1);
  border-top-color: #90caf9;
}
@keyframes sidebar-spin {
  to { transform: rotate(360deg); }
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
  text-align: center;
}
.empty-state p {
  margin: 8px 0 4px;
  opacity: 0.5;
}
.empty-state small {
  opacity: 0.4;
  font-size: 12px;
}

.sidebar-item-menu {
  position: fixed;
  z-index: 9999;
  background: #fff;
  border: 1px solid rgba(0,0,0,0.12);
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.12);
  min-width: 148px;
  padding: 4px 0;
}
:global(.dark .sidebar-item-menu) {
  background: #2a2a2a;
  border-color: #444;
  box-shadow: 0 4px 16px rgba(0,0,0,0.4);
}
.sidebar-item-menu button {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 14px;
  border: none;
  background: transparent;
  color: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  font-family: inherit;
}
.sidebar-item-menu button:hover {
  background: rgba(0,0,0,0.05);
}
:global(.dark .sidebar-item-menu button:hover) {
  background: rgba(255,255,255,0.07);
}
.sidebar-item-menu .menu-danger {
  color: #d32f2f;
}
:global(.dark .sidebar-item-menu .menu-danger) {
  color: #ef9a9a;
}
.sidebar-item-menu .menu-danger-direct {
  background: rgba(211, 47, 47, 0.08);
}
:global(.dark .sidebar-item-menu .menu-danger-direct) {
  background: rgba(239, 154, 154, 0.1);
}
.sidebar-item-menu-divider {
  height: 1px;
  background: rgba(0,0,0,0.08);
  margin: 4px 0;
}
:global(.dark .sidebar-item-menu-divider) {
  background: rgba(255,255,255,0.1);
}
.search-filter-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  width: 22px;
  height: 22px;
  border: none;
  background: none;
  border-radius: 4px;
  cursor: pointer;
  color: inherit;
  opacity: 0.35;
  flex-shrink: 0;
}
.search-filter-btn:hover {
  opacity: 0.7;
  background: rgba(0,0,0,0.06);
}
.search-filter-btn.active {
  opacity: 1;
  color: #1976d2;
}
:global(.dark .search-filter-btn.active) {
  color: #90caf9;
}
:global(.dark .search-filter-btn:hover) {
  background: rgba(255,255,255,0.1);
}
.filter-dot {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 5px;
  height: 5px;
  background: #1976d2;
  border-radius: 50%;
  pointer-events: none;
}
:global(.dark .filter-dot) {
  background: #90caf9;
}

.filter-dropdown {
  position: fixed;
  z-index: 9999;
  background: #fff;
  border: 1px solid rgba(0,0,0,0.12);
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.12);
  min-width: 160px;
  padding: 6px 0 8px;
}
:global(.dark .filter-dropdown) {
  background: #2a2a2a;
  border-color: #444;
  box-shadow: 0 4px 16px rgba(0,0,0,0.4);
}
.filter-dropdown-title {
  font-size: 11px;
  font-weight: 600;
  opacity: 0.4;
  padding: 2px 14px 6px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.filter-option {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 14px;
  font-size: 13px;
  cursor: pointer;
  user-select: none;
}
.filter-option:hover {
  background: rgba(0,0,0,0.04);
}
:global(.dark .filter-option:hover) {
  background: rgba(255,255,255,0.06);
}
.filter-option input[type="checkbox"] {
  width: 14px;
  height: 14px;
  cursor: pointer;
  accent-color: #1976d2;
  flex-shrink: 0;
}

.menu-fade-enter-active, .menu-fade-leave-active { transition: opacity 0.12s, transform 0.12s; }
.menu-fade-enter-from, .menu-fade-leave-to { opacity: 0; transform: scale(0.95); }
</style>
