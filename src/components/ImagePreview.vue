<script setup>
import { IconCopy, IconDownload, IconClose } from './icons'
import { useSnackbar } from '../composables/useSnackbar'

const props = defineProps({
  show: Boolean,
  src: String,
  mediaType: String
})

const emit = defineEmits(['close'])
const { showSnackbar } = useSnackbar()

function copyImage() {
  try {
    const img = document.querySelector('.preview-img')
    if (!img) return
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    const ctx = canvas.getContext('2d')
    ctx.drawImage(img, 0, 0)
    canvas.toBlob(blob => {
      if (blob) {
        navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
        showSnackbar('已复制到剪贴板')
      }
    }, 'image/png')
  } catch (e) {
    showSnackbar('复制失败', 'error')
  }
}

function saveImage() {
  try {
    const match = props.src.match(/^data:image\/([a-z]+);base64,(.+)$/i)
    if (!match) return
    const ext = match[1]
    const base64 = match[2]
    const filePath = window.services.saveImage(base64, ext)
    if (filePath) {
      window.utools.shellShowItemInFolder(filePath)
      showSnackbar('已保存')
    }
  } catch (e) {
    showSnackbar('保存失败', 'error')
  }
}
</script>

<template>
  <Transition name="fade">
    <div v-if="show" class="preview-overlay" @click.self="emit('close')">
      <div class="preview-toolbar">
        <button class="preview-btn" @click="copyImage" title="复制到剪贴板">
          <IconCopy />
          复制
        </button>
        <button class="preview-btn" @click="saveImage" title="另存为">
          <IconDownload />
          保存
        </button>
        <button class="preview-btn" @click="emit('close')" title="关闭">
          <IconClose />
        </button>
      </div>
      <img :src="src" class="preview-img" />
    </div>
  </Transition>
</template>

<style scoped>
.preview-overlay {
  position: fixed;
  inset: 0;
  z-index: 10000;
  background: rgba(0,0,0,0.8);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 12px;
}
.preview-toolbar {
  display: flex;
  gap: 8px;
}
.preview-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 14px;
  border: none;
  border-radius: 6px;
  background: rgba(255,255,255,0.15);
  color: #fff;
  font-size: 13px;
  cursor: pointer;
  backdrop-filter: blur(4px);
}
.preview-btn:hover {
  background: rgba(255,255,255,0.25);
}
.preview-img {
  max-width: 90vw;
  max-height: 80vh;
  border-radius: 8px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.4);
}
.fade-enter-active, .fade-leave-active { transition: opacity 0.2s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
