<script setup>
import { ref, watch, nextTick } from 'vue'

const props = defineProps({
  show: Boolean,
  desc: { type: String, default: '从当前 AI 消息处截断，创建新的会话分支' }
})

const emit = defineEmits(['confirm', 'cancel'])
const name = ref('')

watch(() => props.show, (v) => {
  if (v) {
    name.value = ''
    nextTick(() => {
      const input = document.querySelector('.fork-name-input')
      if (input) input.focus()
    })
  }
})

function confirm() {
  if (!name.value.trim()) return
  emit('confirm', name.value.trim())
}
</script>

<template>
  <Transition name="fade">
    <div v-if="show" class="dialog-overlay" @click.self="emit('cancel')">
      <div class="dialog-card">
        <h3 class="dialog-title">Fork 会话</h3>
        <p class="dialog-desc">{{ desc }}</p>
        <input
          class="fork-name-input"
          v-model="name"
          placeholder="输入新会话名称..."
          @keyup.enter="confirm"
          @keyup.escape="emit('cancel')"
        />
        <div class="dialog-actions">
          <button class="dialog-btn cancel" @click="emit('cancel')">取消</button>
          <button class="dialog-btn confirm" :disabled="!name.trim()" @click="confirm">创建</button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.dialog-overlay {
  position: fixed;
  inset: 0;
  z-index: 10000;
  background: rgba(0,0,0,0.5);
  display: flex;
  align-items: center;
  justify-content: center;
}
.dialog-card {
  background: #fff;
  border-radius: 12px;
  padding: 24px;
  width: 380px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.2);
}
:global(.dark .dialog-card) {
  background: #2a2a2a;
  box-shadow: 0 8px 32px rgba(0,0,0,0.5);
}
.dialog-title {
  margin: 0 0 4px;
  font-size: 16px;
  font-weight: 600;
}
.dialog-desc {
  margin: 0 0 16px;
  font-size: 13px;
  opacity: 0.6;
}
.fork-name-input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 14px;
  outline: none;
  background: inherit;
  color: inherit;
  box-sizing: border-box;
}
.fork-name-input:focus {
  border-color: #1976d2;
}
:global(.dark .fork-name-input) {
  border-color: #444;
}
:global(.dark .fork-name-input:focus) {
  border-color: #90caf9;
}
.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}
.dialog-btn {
  padding: 6px 18px;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
}
.dialog-btn.cancel {
  background: rgba(0,0,0,0.06);
  color: inherit;
}
:global(.dark .dialog-btn.cancel) {
  background: rgba(255,255,255,0.1);
}
.dialog-btn.confirm {
  background: #1976d2;
  color: #fff;
}
.dialog-btn.confirm:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.fade-enter-active, .fade-leave-active { transition: opacity 0.2s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
