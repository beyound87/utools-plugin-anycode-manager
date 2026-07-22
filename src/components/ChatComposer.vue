<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { IconClose } from './icons'

const props = defineProps({
  active: Boolean,
  sending: Boolean,
  permMode: { type: String, default: 'plan' },
  provider: { type: String, default: 'claude' },
  model: { type: String, default: '' },
  effort: { type: String, default: '' }
})
const emit = defineEmits(['send', 'toggle-chat', 'update:permMode', 'stop-chat', 'new-chat', 'update:model', 'update:effort'])

const text = ref('')
const images = ref([])
const attachments = ref([])
const modelOpen = ref(false)
const textareaRef = ref(null)
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

const hasEffort = computed(() => ['claude', 'codex', 'opencode'].includes(props.provider))
const modelList = ref([])
let modelReqId = 0
watch(() => props.provider, (p) => {
  modelList.value = []
  if (p && window.services?.listModels) {
    const reqId = ++modelReqId
    window.services.listModels(p, (list) => { if (reqId === modelReqId) modelList.value = list || [] })
  }
}, { immediate: true })


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

const canSend = computed(() => !props.sending && (text.value.trim() || images.value.length > 0))
function closeDropdowns(e) { if (!e.target.closest('.model-wrapper')) modelOpen.value = false }
onMounted(() => document.addEventListener('click', closeDropdowns))
onUnmounted(() => document.removeEventListener('click', closeDropdowns))
const currentPermLabel = computed(() => PERM_MODES.find(m => m.value === props.permMode)?.icon || '🔒')
</script>

<template>
  <!-- 未激活：简洁按钮 -->
  <div v-if="!active" class="composer-start">
    <button class="start-btn" @click="emit('toggle-chat')">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/></svg>
      继续此会话
    </button>
  </div>

  <!-- 激活态 -->
  <div v-else class="composer">
    <!-- 顶部工具栏：紧凑一行 -->
    <div class="toolbar">
      <!-- 权限模式 pills（仅 Claude/Codex/Gemini 支持，OpenCode 无此概念） -->
      <template v-if="provider !== 'opencode'">
        <div class="mode-pills">
          <button v-for="m in PERM_MODES" :key="m.value"
            class="mode-pill" :class="{ active: permMode === m.value, danger: m.value === 'bypassPermissions' && permMode === m.value }"
            @click="emit('update:permMode', m.value)" :title="m.desc"
          >{{ m.label }}</button>
        </div>
        <span class="toolbar-sep"></span>
      </template>

      <!-- 模型 -->
      <div class="model-wrapper" :class="{ open: modelOpen }">
        <button class="model-trigger" @click="modelOpen = !modelOpen" :title="model || '默认模型'">
          {{ model || '默认模型' }}
          <svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor"><path d="M7 10l5 5 5-5z"/></svg>
        </button>
        <div v-if="modelOpen" class="model-dropdown">
          <div v-for="m in modelList" :key="m" class="model-option" :class="{ active: m === model }" @click="emit('update:model', m); modelOpen = false">{{ m }}</div>
          <input class="model-custom" placeholder="自定义模型名..." @keydown.enter="emit('update:model', $event.target.value); $event.target.value=''; modelOpen = false" @click.stop />
        </div>
      </div>

      <!-- Effort（仅支持的平台） -->
      <div v-if="hasEffort" class="effort-pills">
        <button v-for="e in EFFORTS" :key="e.value"
          class="effort-pill" :class="{ active: effort === e.value }"
          @click="emit('update:effort', e.value)"
        >{{ e.label }}</button>
      </div>

      <div style="flex:1"></div>

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
        rows="3"
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
/* ========== 未激活 ========== */
.composer-start {
  padding: 10px 20px;
  border-top: 1px solid var(--border);
  background: var(--surface);
  text-align: center;
}
:global(.dark) .composer-start { border-color: var(--border); background: var(--surface); }
.start-btn {
  display: inline-flex; align-items: center; gap: 5px;
  min-height: 26px; padding: 4px 10px; border: 1px solid var(--accent); border-radius: 6px;
  background: var(--accent); color: #fff;
  font-size: 11px; cursor: pointer; font-weight: 600;
  transition: background 0.15s;
}
.start-btn:hover { background: #6a4ecf; box-shadow: 0 4px 12px rgba(124,92,224,0.3); }
:global(.dark) .start-btn { background: var(--accent); }
:global(.dark) .start-btn:hover { background: #68b9b0; }

/* ========== 激活态 ========== */
.composer {
  border-top: 1px solid var(--border);
  background: var(--surface);
  padding: 10px 16px 12px;
}
:global(.dark) .composer { background: var(--surface); border-color: var(--border); }

/* ========== 工具栏 ========== */
.toolbar {
  display: flex; align-items: center; gap: 6px; min-height: 34px;
  flex-wrap: wrap; row-gap: 4px;
}
.toolbar-sep { width: 1px; height: 20px; background: var(--border); flex-shrink: 0; margin: 0 4px; }

/* mode / effort pills */
.mode-pills, .effort-pills {
  display: flex; gap: 2px; background: var(--canvas); border-radius: 8px; padding: 2px;
  border: 1px solid var(--border); flex-shrink: 0;
}
.mode-pill, .effort-pill {
  padding: 4px 10px; border: none; background: transparent; border-radius: 6px;
  font-size: 11.5px; cursor: pointer; color: #5f6368; white-space: nowrap;
  transition: background 0.15s, color 0.15s; font-weight: 500;
}
:global(.dark) .mode-pill, :global(.dark) .effort-pill { color: #9aa0a6; }
.mode-pill:hover, .effort-pill:hover { color: #333; background: rgba(0,0,0,0.04); }
:global(.dark) .mode-pill:hover, :global(.dark) .effort-pill:hover { color: #e0e0e0; background: rgba(255,255,255,0.06); }
.mode-pill.active, .effort-pill.active {
  background: var(--surface); color: var(--accent); font-weight: 650;
  box-shadow: 0 1px 3px rgba(0,0,0,0.08);
}
:global(.dark) .mode-pill.active, :global(.dark) .effort-pill.active {
  background: var(--surface); color: var(--accent); box-shadow: 0 1px 4px rgba(0,0,0,0.3);
}
.mode-pill.danger { background: #fce8e6; color: #c5221f; }
:global(.dark) .mode-pill.danger { background: #3c2020; color: #f28b82; }

/* 模型选择下拉 */
.model-wrapper { position: relative; flex-shrink: 0; }
.model-trigger {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 4px 10px; border: 1px solid var(--border); border-radius: 7px;
  font-size: 12px; background: var(--surface); color: inherit; cursor: pointer;
  max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  transition: border-color 0.15s;
}
.model-wrapper.open .model-trigger { border-color: var(--accent); }
.model-dropdown {
  position: absolute; left: 0; bottom: 100%; margin-bottom: 4px;
  background: var(--surface); border: 1px solid var(--border); border-radius: 10px;
  box-shadow: 0 12px 36px rgba(0,0,0,0.12); backdrop-filter: blur(12px);
  min-width: 200px; max-height: 240px;
  overflow-y: auto; z-index: 100; padding: 4px;
}
:global(.dark) .model-dropdown { background: rgba(40,40,44,0.95); box-shadow: 0 12px 36px rgba(0,0,0,0.4); }
.model-option {
  padding: 7px 12px; border-radius: 6px; font-size: 12px; cursor: pointer;
  transition: background 0.1s; white-space: nowrap;
}
.model-option:hover { background: rgba(124,92,224,0.08); }
.model-option.active { background: rgba(124,92,224,0.12); color: var(--accent); font-weight: 600; }
:global(.dark) .model-option:hover { background: rgba(184,165,240,0.1); }
:global(.dark) .model-option.active { background: rgba(184,165,240,0.15); color: var(--accent); }
.model-custom {
  display: block; width: 100%; box-sizing: border-box; margin-top: 4px;
  padding: 6px 10px; border: 1px solid var(--border); border-radius: 6px;
  font-size: 11px; background: transparent; color: inherit; outline: none;
}
.model-custom::placeholder { color: #9aa0a6; }

/* 工具栏按钮 */
.toolbar-btn {
  display: flex; align-items: center; justify-content: center; width: 26px; height: 26px;
  border: 1px solid var(--border); background: var(--surface-subtle); border-radius: 7px; cursor: pointer;
  color: #5f6368; flex-shrink: 0; transition: background 0.15s, color 0.15s;
}
.toolbar-btn:hover { background: rgba(0,0,0,0.08); color: #333; }
:global(.dark) .toolbar-btn { color: #9aa0a6; }
:global(.dark) .toolbar-btn:hover { background: rgba(255,255,255,0.1); color: #e0e0e0; }
.toolbar-btn.stop { color: #c5221f; background: rgba(197,34,31,0.05); border-color: rgba(197,34,31,0.2); }
.toolbar-btn.stop:hover { background: rgba(197,34,31,0.12); }

/* ========== 附件 ========== */
.attachments { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0 4px; }
.att-chip {
  display: inline-flex; align-items: center; gap: 4px; padding: 4px 10px;
  background: rgba(124,92,224,0.08); border-radius: 6px; font-size: 12px; color: var(--accent);
  max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
:global(.dark) .att-chip { background: rgba(184,165,240,0.12); color: var(--accent); }
.att-remove { display: inline-flex; border: none; background: none; color: inherit; cursor: pointer; opacity: 0.5; padding: 0; margin-left: 2px; }
.att-remove:hover { opacity: 1; }

/* ========== 图片 ========== */
.img-bar { display: flex; gap: 8px; margin: 8px 0 4px; flex-wrap: wrap; }
.img-thumb {
  position: relative; width: 56px; height: 56px; border-radius: 8px; overflow: hidden;
  border: 1px solid var(--border); flex-shrink: 0; transition: border-color 0.15s;
}
.img-thumb:hover { border-color: var(--accent); }
.img-thumb img { width: 100%; height: 100%; object-fit: cover; }
.img-remove {
  position: absolute; top: 2px; right: 2px;
  background: rgba(0,0,0,0.65); border: none; border-radius: 50%; width: 18px; height: 18px;
  display: flex; align-items: center; justify-content: center; color: #fff; cursor: pointer;
  opacity: 0; transition: opacity 0.15s;
}
.img-thumb:hover .img-remove { opacity: 1; }

/* ========== 输入区 ========== */
.input-row { display: flex; align-items: flex-end; gap: 8px; margin-top: 8px; }
.attach-btn {
  display: flex; align-items: center; justify-content: center; width: 36px; height: 36px;
  border: 1px solid var(--border); background: var(--surface-subtle); border-radius: 10px; cursor: pointer;
  color: #5f6368; flex-shrink: 0; transition: background 0.15s, color 0.15s;
}
.attach-btn:hover { background: rgba(0,0,0,0.08); color: #333; }
:global(.dark) .attach-btn { color: #9aa0a6; }
:global(.dark) .attach-btn:hover { background: rgba(255,255,255,0.1); color: #e0e0e0; }

.input-area {
  flex: 1; resize: none; border: 1px solid var(--border); border-radius: 10px; padding: 10px 14px;
  font-size: 14px; font-family: inherit; background: var(--surface); color: inherit;
  outline: none; min-height: 22px; max-height: 140px; line-height: 1.5;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.input-area:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(124,92,224,0.1); }
:global(.dark) .input-area:focus { box-shadow: 0 0 0 3px rgba(184,165,240,0.15); }
.input-area::placeholder { color: #9aa0a6; }

.send-btn {
  display: flex; align-items: center; justify-content: center;
  width: 32px; height: 32px; border: none; border-radius: 10px;
  background: var(--accent); color: #fff;
  box-shadow: 0 2px 8px rgba(124,92,224,0.2);
  cursor: pointer; flex-shrink: 0; transition: background 0.15s, opacity 0.15s, box-shadow 0.15s, transform 0.15s;
}
.send-btn:disabled { opacity: 0.3; cursor: default; box-shadow: none; transform: none; }
.send-btn:not(:disabled):hover { background: #6a4ecf; box-shadow: 0 4px 12px rgba(124,92,224,0.3); transform: translateY(-1px); }
:global(.dark) .send-btn { background: var(--accent); }

.dot-loading {
  display: inline-block; width: 6px; height: 6px; border-radius: 50%;
  background: #fff; animation: dot-pulse 0.8s ease-in-out infinite;
}
@keyframes dot-pulse { 0%,100% { opacity: 0.2; transform: scale(0.8); } 50% { opacity: 1; transform: scale(1.2); } }
</style>
