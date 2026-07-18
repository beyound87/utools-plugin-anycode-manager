<script setup>
import { ref, watch } from 'vue'
import { defaultExportOptions } from '../composables/useExport'

const props = defineProps({
  show: Boolean,
  format: String // 'image' | 'html'
})

const emit = defineEmits(['confirm', 'cancel'])

const options = ref({ ...defaultExportOptions })

watch(() => props.show, (v) => {
  if (v) options.value = { ...defaultExportOptions }
})
</script>

<template>
  <Transition name="fade">
    <div v-if="show" class="dialog-overlay">
      <div class="dialog-card">
        <h3 class="dialog-title">导出{{ format === 'image' ? '长图' : 'HTML' }}设置</h3>
        <div class="option-list">
          <label class="option-item">
            <input type="checkbox" v-model="options.showSessionId" />
            <span>显示 Session ID</span>
          </label>
          <label class="option-item">
            <input type="checkbox" v-model="options.showCwd" />
            <span>显示项目路径</span>
          </label>
          <label class="option-item">
            <input type="checkbox" v-model="options.showStats" />
            <span>显示模型、用量、耗时等信息</span>
          </label>
          <label v-if="format === 'image'" class="option-item">
            <input type="checkbox" v-model="options.showToolDetail" />
            <span>展开工具调用详情</span>
          </label>
          <div class="option-item">
            <span>工具文件路径</span>
            <select v-model="options.filePathMode" class="option-select">
              <option value="short">缩略路径</option>
              <option value="full">完整路径</option>
              <option value="hidden">不显示</option>
            </select>
          </div>
          <label v-if="format === 'image'" class="option-item">
            <input type="checkbox" v-model="options.showThinking" />
            <span>显示 Thinking 思考过程</span>
          </label>
        </div>
        <div class="dialog-actions">
          <button class="dialog-btn cancel" @click="emit('cancel')">取消</button>
          <button class="dialog-btn confirm" @click="emit('confirm', options)">导出</button>
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
}
.dialog-title {
  margin: 0 0 16px;
  font-size: 16px;
  font-weight: 600;
}
.option-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 20px;
}
.option-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  cursor: pointer;
  user-select: none;
}
.option-item input[type="checkbox"] {
  width: 16px;
  height: 16px;
  accent-color: #1976d2;
  cursor: pointer;
}
.option-select {
  margin-left: auto;
  padding: 3px 8px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 12px;
  background: inherit;
  color: inherit;
  cursor: pointer;
  outline: none;
}
:global(.dark .option-select) {
  border-color: #555;
}
.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
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
.fade-enter-active, .fade-leave-active { transition: opacity 0.2s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
