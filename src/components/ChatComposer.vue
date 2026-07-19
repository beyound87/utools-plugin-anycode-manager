<script setup>
import { ref, computed } from 'vue'
import { IconClose } from './icons'

const props = defineProps({
  active: Boolean,
  sending: Boolean,
  permMode: { type: String, default: 'plan' },
  provider: { type: String, default: 'claude' }
})
const emit = defineEmits(['send', 'toggle-chat', 'update:permMode', 'stop-chat'])

const text = ref('')
const images = ref([])
const attachments = ref([])
const textareaRef = ref(null)

const PERM_MODES = [
  { value: 'plan', label: '只读', desc: 'AI 不改文件不跑命令' },
  { value: 'acceptEdits', label: '允许编辑', desc: 'AI 可改文件，命令需人工审批' },
  { value: 'bypassPermissions', label: '全自动', desc: 'AI 自动执行一切（危险）' }
]

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
    const paths = window.utools.showOpenDialog({
      title: '选择附件',
      properties: ['openFile', 'openDirectory', 'multiSelections']
    })
    if (paths?.length) attachments.value = [...attachments.value, ...paths]
  } catch (e) {}
}

const canSend = computed(() => !props.sending && (text.value.trim() || images.value.length > 0))
</script>

<template>
  <div v-if="active" class="composer">
    <!-- 工具栏 -->
    <div class="composer-toolbar">
      <select class="perm-select" :value="permMode" @change="emit('update:permMode', $event.target.value)" title="AI 执行权限">
        <option v-for="m in PERM_MODES" :key="m.value" :value="m.value">{{ m.label }}</option>
      </select>
      <button class="composer-btn attach-btn" @click="addAttachments" title="添加文件/文件夹附件">+附件</button>
      <div style="flex:1"></div>
      <button class="composer-btn stop-btn" @click="emit('stop-chat')" title="结束对话">结束对话</button>
    </div>
    <!-- 附件预览 -->
    <div v-if="attachments.length" class="attachment-list">
      <span v-for="(a, i) in attachments" :key="i" class="attachment-chip" :title="a">
        {{ a.split(/[/\\]/).pop() }}
        <button class="chip-remove" @click="removeAttachment(i)"><IconClose :size="10" /></button>
      </span>
    </div>
    <!-- 图片预览 -->
    <div v-if="images.length" class="image-previews">
      <div v-for="(img, i) in images" :key="i" class="img-preview">
        <img :src="img.preview" />
        <button class="chip-remove img-remove" @click="removeImage(i)"><IconClose :size="10" /></button>
      </div>
    </div>
    <!-- 输入 -->
    <div class="composer-input-row">
      <textarea
        ref="textareaRef"
        class="composer-textarea"
        v-model="text"
        @keydown="onKeyDown"
        @paste="onPaste"
        placeholder="输入消息... (Enter 发送, Shift+Enter 换行, 粘贴图片)"
        rows="2"
        :disabled="sending"
      ></textarea>
      <button class="send-btn" :disabled="!canSend" @click="send">{{ sending ? '...' : '发送' }}</button>
    </div>
  </div>
  <!-- 未激活时显示"开始对话"按钮 -->
  <div v-else class="composer-inactive">
    <button class="start-chat-btn" @click="emit('toggle-chat')">开始对话</button>
  </div>
</template>

<style scoped>
.composer {
  border-top: 1px solid #e8e8e8;
  background: #fafafa;
  padding: 8px 16px 10px;
}
:global(.dark) .composer { background: #1a1a1a; border-color: #2a2a2a; }
.composer-toolbar { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
.perm-select {
  padding: 3px 6px; border: 1px solid #ddd; border-radius: 4px; font-size: 11px;
  background: inherit; color: inherit; cursor: pointer;
}
:global(.dark) .perm-select { border-color: #444; }
.composer-btn {
  padding: 3px 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 11px;
  background: none; color: inherit; cursor: pointer;
}
.composer-btn:hover { background: rgba(0,0,0,0.04); }
:global(.dark) .composer-btn { border-color: #444; }
:global(.dark) .composer-btn:hover { background: rgba(255,255,255,0.06); }
.stop-btn { color: #d32f2f; border-color: #d32f2f; }
.stop-btn:hover { background: rgba(211,47,47,0.08); }
.attachment-list { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 6px; }
.attachment-chip {
  display: inline-flex; align-items: center; gap: 3px; padding: 2px 8px;
  background: rgba(0,0,0,0.05); border-radius: 4px; font-size: 11px; max-width: 180px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
:global(.dark) .attachment-chip { background: rgba(255,255,255,0.08); }
.chip-remove {
  display: inline-flex; align-items: center; border: none; background: none;
  color: inherit; cursor: pointer; opacity: 0.5; padding: 0;
}
.chip-remove:hover { opacity: 1; }
.image-previews { display: flex; gap: 6px; margin-bottom: 6px; flex-wrap: wrap; }
.img-preview { position: relative; width: 56px; height: 56px; border-radius: 6px; overflow: hidden; border: 1px solid #ddd; }
:global(.dark) .img-preview { border-color: #444; }
.img-preview img { width: 100%; height: 100%; object-fit: cover; }
.img-remove { position: absolute; top: 2px; right: 2px; background: rgba(0,0,0,0.5); border-radius: 50%; width: 16px; height: 16px; display: flex; align-items: center; justify-content: center; color: #fff; }
.composer-input-row { display: flex; gap: 8px; align-items: flex-end; }
.composer-textarea {
  flex: 1; resize: none; border: 1px solid #ddd; border-radius: 8px; padding: 8px 10px;
  font-size: 13px; font-family: inherit; background: #fff; color: inherit;
  outline: none; min-height: 36px; max-height: 120px;
}
.composer-textarea:focus { border-color: #1976d2; }
:global(.dark) .composer-textarea { background: #222; border-color: #444; }
:global(.dark) .composer-textarea:focus { border-color: #90caf9; }
.send-btn {
  padding: 8px 16px; border: none; border-radius: 8px;
  background: #1976d2; color: #fff; font-size: 13px; font-weight: 600;
  cursor: pointer; white-space: nowrap;
}
.send-btn:disabled { opacity: 0.4; cursor: default; }
.send-btn:not(:disabled):hover { background: #1565c0; }
.composer-inactive { padding: 8px 16px; border-top: 1px solid #e8e8e8; text-align: center; }
:global(.dark) .composer-inactive { border-color: #2a2a2a; }
.start-chat-btn {
  padding: 6px 20px; border: 1px solid #1976d2; border-radius: 8px;
  background: none; color: #1976d2; font-size: 13px; cursor: pointer; font-weight: 500;
}
.start-chat-btn:hover { background: rgba(25,118,210,0.08); }
:global(.dark) .start-chat-btn { border-color: #90caf9; color: #90caf9; }
:global(.dark) .start-chat-btn:hover { background: rgba(144,202,249,0.12); }
</style>
