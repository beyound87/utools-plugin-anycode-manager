<script setup>
import { useSnackbar } from '../composables/useSnackbar'

const { snackbar, pauseSnackbar, resumeSnackbar } = useSnackbar()
</script>

<template>
  <Transition name="snackbar">
    <div v-if="snackbar.show" class="snackbar" :class="'snackbar-' + snackbar.type" @mouseenter="pauseSnackbar" @mouseleave="resumeSnackbar">
      {{ snackbar.message }}
    </div>
  </Transition>
</template>

<style scoped>
.snackbar {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  padding: 8px 24px;
  border-radius: 6px;
  font-size: 14px;
  color: #fff;
  z-index: 10001;
  box-shadow: 0 4px 12px rgba(0,0,0,0.2);
}
.snackbar-success { background: #43a047; }
.snackbar-error { background: #d32f2f; }
.snackbar-enter-active, .snackbar-leave-active { transition: all 0.3s ease; }
.snackbar-enter-from, .snackbar-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(16px);
}
</style>
