<script setup>
import { ref, watch, nextTick } from 'vue'

const props = defineProps({
  show: Boolean,
  session: Object
})

const emit = defineEmits(['confirm', 'cancel'])
const name = ref('')

watch(() => props.show, (v) => {
  if (v && props.session) {
    name.value = props.session.name
    nextTick(() => {
      const input = document.querySelector('.rename-dialog-input')
      if (input) { input.focus(); input.select() }
    })
  }
})

function confirm() {
  const newName = name.value.trim()
  if (!newName || newName === props.session?.name) {
    emit('cancel')
    return
  }
  emit('confirm', newName)
}
</script>

<template>
  <Transition name="fade">
    <div v-if="show" class="dialog-overlay" @click.self="emit('cancel')">
      <div class="dialog-card">
        <h3 class="dialog-title">重命名会话</h3>
        <input
          class="rename-dialog-input"
          v-model="name"
          placeholder="输入新名称..."
          @keyup.enter="confirm"
          @keyup.escape="emit('cancel')"
        />
        <div class="dialog-actions">
          <button class="dialog-btn cancel" @click="emit('cancel')">取消</button>
          <button class="dialog-btn confirm" :disabled="!name.trim()" @click="confirm">确定</button>
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
.rename-dialog-input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 14px;
  outline: none;
  background: inherit;
  color: inherit;
  box-sizing: border-box;
  font-family: inherit;
}
.rename-dialog-input:focus {
  border-color: #1976d2;
}
:global(.dark .rename-dialog-input) {
  border-color: #444;
}
:global(.dark .rename-dialog-input:focus) {
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
