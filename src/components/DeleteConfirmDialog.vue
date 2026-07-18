<script setup>
const props = defineProps({
  show: Boolean,
  session: Object,
  showHint: { type: Boolean, default: true }
})

const emit = defineEmits(['confirm', 'cancel'])
</script>

<template>
  <Transition name="fade">
    <div v-if="show" class="dialog-overlay" @click.self="emit('cancel')">
      <div class="dialog-card">
        <h3 class="dialog-title">删除会话</h3>
        <p class="dialog-desc">确定要删除「{{ session?.name }}」吗？此操作不可撤销。</p>
        <div class="dialog-actions">
          <button class="dialog-btn cancel" @click="emit('cancel')">取消</button>
          <button class="dialog-btn danger" @click="emit('confirm')">删除</button>
        </div>
        <p v-if="showHint" class="dialog-hint">按住 Ctrl 点击删除按钮可跳过确认</p>
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
.dialog-btn.danger {
  background: #d32f2f;
  color: #fff;
}
.dialog-btn.danger:hover {
  background: #c62828;
}
:global(.dark .dialog-btn.danger) {
  background: #c62828;
}
:global(.dark .dialog-btn.danger:hover) {
  background: #b71c1c;
}
.dialog-hint {
  margin: 10px 0 0;
  font-size: 11px;
  opacity: 0.4;
  text-align: center;
}
.fade-enter-active, .fade-leave-active { transition: opacity 0.2s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
