<script setup>
import { ref, computed, watch } from 'vue'
import { IconClose } from './icons'

const props = defineProps({
  active: Boolean,
  sending: Boolean,
  permMode: { type: String, default: 'plan' },
  provider: { type: String, default: 'claude' },
  cwd: { type: String, default: '' },
  model: { type: String, default: '' },
  effort: { type: String, default: '' }
})
const emit = defineEmits(['send', 'toggle-chat', 'update:permMode', 'stop-chat', 'new-chat', 'change-cwd', 'update:model', 'update:effort'])

const text = ref('')
const images = ref([])
const attachments = ref([])
const textareaRef = ref(null)
const showToolbar = ref(true)

const PERM_MODES = [
  { value: 'plan', label: '只读', icon: '🔒', desc: 'AI 不改文件不跑命令' },
  { value: 'acceptEdits', label: '编辑', icon: '✏️', desc: '允许 AI 编辑文件' },
  { value: 'bypassPermissions', label: '全自动', icon: '⚡', desc: 'AI 自动执行一切' }
]

const EFFORTS = [
  { value: '', label: '默认' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Med' },
  { value: 'high', label: 'High' },
  { value: 'max', label: 'Max' }
]

const hasEffort = computed(() => ['codex', 'opencode'].includes(props.provider))
const modelList = ref([])
watch(() => props.provider, (p) => {
  if (p && window.services?.listModels) {
    window.services.listModels(p, (list) => { modelList.value = list || [] })
  }
}, { immediate: true })

const shortCwd = computed(() => {
  const c = props.cwd || ''
  if (!c) return ''
  const parts = c.replace(/\\/g, '/').split('/')
  return parts.length > 2 ? '.../' + parts.slice(-2).join('/') : c
})

function send() {
  const t = text.value.trim()
  if (!t && images.value.length === 0) return
  emit('send', { text: t, images: [...images.value], attachments: [...attachments.value] })
  text.value = ''
  images.value = []
  attachments.value = []
  textareaRef.value?.focus()
}

function onKeyDown(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
}

function onPaste(e) {
  const items = e.clipboardData?.items
  if (!items) return
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault()
      const file = item.getAsFile()
      if (!file) continue
      const reader = new FileReader()
      reader.onload = () => {
        const m = reader.result.match(/^data:(image\/\w+);base64,(.+)$/)
        if (m) images.value = [...images.value, { mediaType: m[1], data: m[2], preview: reader.result }]
      }
      reader.readAsDataURL(file)
    }
  }
}

function removeImage(idx) { images.value = images.value.filter((_, i) => i !== idx) }
function removeAttachment(idx) { attachments.value = attachments.value.filter((_, i) => i !== idx) }

function addAttachments() {
  try {
    const paths = window.utools.showOpenDialog({ title: '选择附件', properties: ['openFile', 'openDirectory', 'multiSelections'] })
    if (paths?.length) attachments.value = [...attachments.value, ...paths]
  } catch (e) {}
}

function changeCwd() {
  try {
    const dirs = window.utools.showOpenDialog({ title: '选择工作目录', properties: ['openDirectory'] })
    if (dirs?.[0]) emit('change-cwd', dirs[0])
  } catch (e) {}
}

const canSend = computed(() => !props.sending && (text.value.trim() || images.value.length > 0))
const currentPermLabel = computed(() => PERM_MODES.find(m => m.value === props.permMode)?.icon || '🔒')
</script>

<template>
  <!-- 未激活：简洁按钮 -->
  <div v-if="!active" class="composer-start">
    <button class="start-btn" @click="emit('toggle-chat')">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/></svg>
      开始对话
    </button>
  </div>

  <!-- 激活态 -->
  <div v-else class="composer">
    <!-- 顶部工具栏：紧凑一行 -->
    <div class="toolbar">
      <!-- 权限模式 pills -->
      <div class="mode-pills">
        <button v-for="m in PERM_MODES" :key="m.value"
          class="mode-pill" :class="{ active: permMode === m.value, danger: m.value === 'bypassPermissions' && permMode === m.value }"
          @click="emit('update:permMode', m.value)" :title="m.desc"
        >{{ m.label }}</button>
      </div>

      <span class="toolbar-sep"></span>

      <!-- 模型 -->
      <div class="model-wrapper">
        <input class="model-input" :value="model" @change="emit('update:model', $event.target.value)"
          placeholder="默认模型" title="模型名" list="chat-models" />
        <datalist id="chat-models"><option v-for="m in modelList" :key="m" :value="m" /></datalist>
      </div>

      <!-- Effort（仅支持的平台） -->
      <div v-if="hasEffort" class="effort-pills">
        <button v-for="e in EFFORTS" :key="e.value"
          class="effort-pill" :class="{ active: effort === e.value }"
          @click="emit('update:effort', e.value)"
        >{{ e.label }}</button>
      </div>

      <div style="flex:1"></div>

      <!-- cwd -->
      <span v-if="cwd" class="cwd-chip" :title="cwd" @click="changeCwd">
        <svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor"><path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>
        {{ shortCwd }}
      </span>

      <!-- 操作按钮 -->
      <button class="toolbar-btn" @click="emit('new-chat')" title="新建对话">
        <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
      </button>
      <button class="toolbar-btn stop" @click="emit('stop-chat')" title="结束对话">
        <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
      </button>
    </div>

    <!-- 附件 -->
    <div v-if="attachments.length" class="attachments">
      <span v-for="(a, i) in attachments" :key="i" class="att-chip" :title="a">
        <svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm4 18H6V4h7v5h5v11z"/></svg>
        {{ a.split(/[/\\]/).pop() }}
        <button class="att-remove" @click="removeAttachment(i)"><IconClose :size="9" /></button>
      </span>
    </div>

    <!-- 图片预览 -->
    <div v-if="images.length" class="img-bar">
      <div v-for="(img, i) in images" :key="i" class="img-thumb">
        <img :src="img.preview" />
        <button class="img-remove" @click="removeImage(i)"><IconClose :size="9" /></button>
      </div>
    </div>

    <!-- 输入区 -->
    <div class="input-row">
      <button class="attach-btn" @click="addAttachments" title="添加附件">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5a2.5 2.5 0 015 0v10.5c0 .83-.67 1.5-1.5 1.5s-1.5-.67-1.5-1.5V6H9v9.5a3 3 0 006 0V5c0-2.21-1.79-4-4-4S7 2.79 7 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6h-1.5z"/></svg>
      </button>
      <textarea
        ref="textareaRef"
        class="input-area"
        v-model="text"
        @keydown="onKeyDown"
        @paste="onPaste"
        placeholder="输入消息..."
        rows="1"
        :disabled="sending"
      ></textarea>
      <button class="send-btn" :class="{ loading: sending }" :disabled="!canSend" @click="send">
        <svg v-if="!sending" viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
        <span v-else class="dot-loading"></span>
      </button>
    </div>
  </div>
</template>

<style scoped>
/* 未激活 */
.composer-start { padding: 8px 16px; border-top: 1px solid #e8e8e8; text-align: center; }
:global(.dark) .composer-start { border-color: #2a2a2a; }
.start-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 7px 20px; border: 1px solid #1976d2; border-radius: 20px;
  background: none; color: #1976d2; font-size: 13px; cursor: pointer; font-weight: 500;
  transition: all 0.15s;
}
.start-btn:hover { background: rgba(25,118,210,0.08); }
:global(.dark) .start-btn { border-color: #90caf9; color: #90caf9; }
:global(.dark) .start-btn:hover { background: rgba(144,202,249,0.1); }

/* 激活态 */
.composer {
  border-top: 1px solid #e0e0e0; background: #fafafa;
  padding: 6px 12px 8px;
}
:global(.dark) .composer { background: #1a1a1a; border-color: #2a2a2a; }

/* 工具栏 */
.toolbar { display: flex; align-items: center; gap: 4px; flex-wrap: nowrap; overflow-x: auto; min-height: 28px; }
.toolbar-sep { width: 1px; height: 16px; background: #ddd; flex-shrink: 0; margin: 0 2px; }
:global(.dark) .toolbar-sep { background: #444; }

.mode-pills, .effort-pills { display: flex; gap: 1px; background: #e8e8e8; border-radius: 6px; padding: 1px; flex-shrink: 0; }
:global(.dark) .mode-pills, :global(.dark) .effort-pills { background: #333; }
.mode-pill, .effort-pill {
  padding: 2px 8px; border: none; background: none; border-radius: 5px;
  font-size: 11px; cursor: pointer; color: inherit; white-space: nowrap; transition: all 0.12s;
}
.mode-pill.active { background: #fff; font-weight: 600; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
.mode-pill.danger { background: #fee; color: #d32f2f; }
:global(.dark) .mode-pill.active { background: #2a2a2a; }
:global(.dark) .mode-pill.danger { background: #3a2020; color: #ef5350; }
.effort-pill.active { background: #fff; font-weight: 600; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
:global(.dark) .effort-pill.active { background: #2a2a2a; }

.model-wrapper { flex-shrink: 0; }
.model-input {
  width: 110px; padding: 2px 6px; border: 1px solid #ddd; border-radius: 5px;
  font-size: 11px; background: inherit; color: inherit; outline: none;
}
.model-input:focus { border-color: #1976d2; }
:global(.dark) .model-input { border-color: #444; }
:global(.dark) .model-input:focus { border-color: #90caf9; }

.cwd-chip {
  display: inline-flex; align-items: center; gap: 3px;
  font-size: 10px; opacity: 0.5; cursor: pointer; padding: 2px 6px; border-radius: 4px;
  max-width: 130px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex-shrink: 0;
}
.cwd-chip:hover { opacity: 0.8; background: rgba(0,0,0,0.04); }
:global(.dark) .cwd-chip:hover { background: rgba(255,255,255,0.06); }

.toolbar-btn {
  display: flex; align-items: center; justify-content: center; width: 24px; height: 24px;
  border: none; background: none; border-radius: 5px; cursor: pointer; color: inherit; opacity: 0.5; flex-shrink: 0;
}
.toolbar-btn:hover { opacity: 1; background: rgba(0,0,0,0.06); }
:global(.dark) .toolbar-btn:hover { background: rgba(255,255,255,0.08); }
.toolbar-btn.stop { color: #d32f2f; }

/* 附件 */
.attachments { display: flex; flex-wrap: wrap; gap: 4px; margin: 4px 0; }
.att-chip {
  display: inline-flex; align-items: center; gap: 3px; padding: 2px 8px;
  background: rgba(25,118,210,0.08); border-radius: 4px; font-size: 11px; color: #1976d2;
  max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
:global(.dark) .att-chip { background: rgba(144,202,249,0.12); color: #90caf9; }
.att-remove { display: inline-flex; border: none; background: none; color: inherit; cursor: pointer; opacity: 0.5; padding: 0; }
.att-remove:hover { opacity: 1; }

/* 图片 */
.img-bar { display: flex; gap: 6px; margin: 4px 0; flex-wrap: wrap; }
.img-thumb {
  position: relative; width: 48px; height: 48px; border-radius: 6px; overflow: hidden;
  border: 1px solid #ddd; flex-shrink: 0;
}
:global(.dark) .img-thumb { border-color: #444; }
.img-thumb img { width: 100%; height: 100%; object-fit: cover; }
.img-remove {
  position: absolute; top: 1px; right: 1px;
  background: rgba(0,0,0,0.6); border: none; border-radius: 50%; width: 14px; height: 14px;
  display: flex; align-items: center; justify-content: center; color: #fff; cursor: pointer;
}

/* 输入区 */
.input-row { display: flex; align-items: flex-end; gap: 6px; margin-top: 4px; }
.attach-btn {
  display: flex; align-items: center; justify-content: center; width: 32px; height: 32px;
  border: none; background: none; border-radius: 8px; cursor: pointer; color: inherit; opacity: 0.4;
  flex-shrink: 0;
}
.attach-btn:hover { opacity: 0.8; background: rgba(0,0,0,0.04); }
:global(.dark) .attach-btn:hover { background: rgba(255,255,255,0.06); }

.input-area {
  flex: 1; resize: none; border: 1px solid #ddd; border-radius: 12px; padding: 8px 12px;
  font-size: 13px; font-family: inherit; background: #fff; color: inherit;
  outline: none; min-height: 20px; max-height: 120px; line-height: 1.4;
}
.input-area:focus { border-color: #1976d2; box-shadow: 0 0 0 2px rgba(25,118,210,0.12); }
:global(.dark) .input-area { background: #222; border-color: #444; }
:global(.dark) .input-area:focus { border-color: #90caf9; box-shadow: 0 0 0 2px rgba(144,202,249,0.15); }

.send-btn {
  display: flex; align-items: center; justify-content: center;
  width: 32px; height: 32px; border: none; border-radius: 50%;
  background: #1976d2; color: #fff; cursor: pointer; flex-shrink: 0;
  transition: all 0.15s;
}
.send-btn:disabled { opacity: 0.3; cursor: default; }
.send-btn:not(:disabled):hover { background: #1565c0; transform: scale(1.05); }
.send-btn.loading { background: #888; }

.dot-loading {
  display: inline-block; width: 6px; height: 6px; border-radius: 50%;
  background: #fff; animation: dot-pulse 0.8s infinite;
}
@keyframes dot-pulse { 0%,100% { opacity: 0.3; } 50% { opacity: 1; } }
</style>
