<script setup>
import { ref, watch, computed } from 'vue'
import { IconClose } from './icons'
import { useSnackbar } from '../composables/useSnackbar'
import { useTheme } from '../composables/useTheme'

const props = defineProps({
  show: Boolean,
  terminalCommand: String,
  terminalApp: String
})

const emit = defineEmits(['update:terminalCommand', 'update:terminalApp', 'close'])
const { showSnackbar } = useSnackbar()
const platform = window.utools.isWindows() ? 'win32' : window.utools.isMacOS() ? 'darwin' : 'linux'

const terminalPresets = {
  win32: [
    { label: 'CMD (默认)', value: 'auto' },
    { label: 'PowerShell 7', value: "start \"\" pwsh -NoExit -Command \"cd '${cwd}'; ${cc_cmd}\"" },
    { label: 'Windows Terminal', value: 'wt -d "${cwd}" cmd /k ${cc_cmd}' },
    { label: 'WT + PowerShell 7', value: 'wt -d "${cwd}" pwsh -NoExit -Command ${cc_cmd}' },
  ],
  darwin: [
    { label: 'Terminal.app (默认)', value: 'auto' },
    { label: 'iTerm2', value: "osascript -e 'tell app \"iTerm2\" to create window with default profile command \"cd ${cwd} && ${cc_cmd}\"'" },
    { label: 'Warp', value: "osascript -e 'tell app \"Warp\" to activate' && sleep 0.5 && osascript -e 'tell app \"System Events\" to keystroke \"cd ${cwd} && ${cc_cmd}\" & return'" },
  ],
  linux: [
    { label: '自动检测 (默认)', value: 'auto' },
    { label: 'gnome-terminal', value: 'gnome-terminal -- bash -c "cd ${cwd} && ${cc_cmd}; exec bash"' },
    { label: 'Konsole', value: 'konsole -e bash -c "cd ${cwd} && ${cc_cmd}; exec bash"' },
    { label: 'Alacritty', value: 'alacritty --working-directory "${cwd}" -e bash -c "${cc_cmd}; exec bash"' },
    { label: 'Kitty', value: 'kitty --directory "${cwd}" bash -c "${cc_cmd}; exec bash"' },
  ]
}

const currentPresets = terminalPresets[platform] || terminalPresets.win32
const { themeMode, setThemeMode } = useTheme()
const draft = ref('')
const terminalAppMode = ref('preset')
const draftTerminalApp = ref('auto')
const customTerminalDraft = ref('')
const terminalAppError = ref(false)

watch(() => props.show, (v) => {
  if (v) {
    draft.value = props.terminalCommand
    const app = props.terminalApp || 'auto'
    const isPreset = currentPresets.some(p => p.value === app)
    if (isPreset || app === 'auto') {
      terminalAppMode.value = 'preset'
      draftTerminalApp.value = app
    } else {
      terminalAppMode.value = 'custom'
      draftTerminalApp.value = app
      customTerminalDraft.value = app
    }
    terminalAppError.value = false
  }
})

function save() {
  if (terminalAppMode.value === 'custom' && !draftTerminalApp.value.trim()) {
    terminalAppError.value = true
    return
  }
  terminalAppError.value = false
  emit('update:terminalCommand', draft.value)
  window.utools.dbStorage.setItem('terminalCommand', draft.value)
  const appVal = draftTerminalApp.value.trim() || 'auto'
  emit('update:terminalApp', appVal)
  window.utools.dbStorage.setItem('terminalApp', appVal)
  emit('close')
  showSnackbar('设置已保存')
}
</script>

<template>
  <Transition name="drawer">
    <div v-if="show" class="drawer-overlay" @click.self="emit('close')" @keydown.escape="emit('close')" tabindex="-1">
      <div class="drawer-panel">
        <div class="drawer-header">
          <h3>设置</h3>
          <button class="icon-btn" @click="emit('close')" title="关闭">
            <IconClose />
          </button>
        </div>
        <div class="drawer-body">
          <div class="setting-item">
            <label class="setting-label">主题模式</label>
            <div class="setting-desc">选择亮色、暗色或跟随系统</div>
            <div class="theme-options">
              <button
                class="theme-option"
                :class="{ active: themeMode === 'system' }"
                @click="setThemeMode('system')"
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18V4c4.41 0 8 3.59 8 8s-3.59 8-8 8z"/></svg>
                跟随系统
              </button>
              <button
                class="theme-option"
                :class="{ active: themeMode === 'light' }"
                @click="setThemeMode('light')"
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 7c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5zM2 13h2c.55 0 1-.45 1-1s-.45-1-1-1H2c-.55 0-1 .45-1 1s.45 1 1 1zm18 0h2c.55 0 1-.45 1-1s-.45-1-1-1h-2c-.55 0-1 .45-1 1s.45 1 1 1zM11 2v2c0 .55.45 1 1 1s1-.45 1-1V2c0-.55-.45-1-1-1s-1 .45-1 1zm0 18v2c0 .55.45 1 1 1s1-.45 1-1v-2c0-.55-.45-1-1-1s-1 .45-1 1zM5.99 4.58a.996.996 0 00-1.41 0 .996.996 0 000 1.41l1.06 1.06c.39.39 1.03.39 1.41 0s.39-1.03 0-1.41L5.99 4.58zm12.37 12.37a.996.996 0 00-1.41 0 .996.996 0 000 1.41l1.06 1.06c.39.39 1.03.39 1.41 0a.996.996 0 000-1.41l-1.06-1.06zm1.06-10.96a.996.996 0 000-1.41.996.996 0 00-1.41 0l-1.06 1.06c-.39.39-.39 1.03 0 1.41s1.03.39 1.41 0l1.06-1.06zM7.05 18.36a.996.996 0 000-1.41.996.996 0 00-1.41 0l-1.06 1.06c-.39.39-.39 1.03 0 1.41s1.03.39 1.41 0l1.06-1.06z"/></svg>
                亮色
              </button>
              <button
                class="theme-option"
                :class="{ active: themeMode === 'dark' }"
                @click="setThemeMode('dark')"
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 3a9 9 0 109 9c0-.46-.04-.92-.1-1.36a5.389 5.389 0 01-4.4 2.26 5.403 5.403 0 01-3.14-9.8c-.44-.06-.9-.1-1.36-.1z"/></svg>
                暗色
              </button>
            </div>
          </div>
          <div class="setting-item">
            <label class="setting-label">终端命令</label>
            <div class="setting-desc">留空则自动使用各 CLI 默认命令 (claude/codex/gemini/opencode)</div>
            <input class="setting-input" v-model="draft" placeholder="留空自动识别" @keyup.enter="save" />
          </div>
          <div class="setting-item">
            <label class="setting-label">终端程序</label>
            <div class="setting-desc">打开会话时使用的终端</div>
            <div class="terminal-presets">
              <button
                v-for="preset in currentPresets"
                :key="preset.value"
                class="terminal-preset-btn"
                :class="{ active: terminalAppMode !== 'custom' && draftTerminalApp === preset.value }"
                @click="terminalAppMode = 'preset'; draftTerminalApp = preset.value; terminalAppError = false"
              >{{ preset.label }}</button>
              <button
                class="terminal-preset-btn"
                :class="{ active: terminalAppMode === 'custom' }"
                @click="terminalAppMode = 'custom'; draftTerminalApp = customTerminalDraft; terminalAppError = false"
              >自定义...</button>
            </div>
            <template v-if="terminalAppMode === 'custom'">
              <input
                class="setting-input"
                :class="{ error: terminalAppError }"
                v-model="draftTerminalApp"
                placeholder='start cmd /c "cd ${cwd} && ${cc_cmd}"'
                @keyup.enter="save"
                @input="terminalAppError = false; customTerminalDraft = draftTerminalApp"
              />
              <div v-if="terminalAppError" class="input-error">请填写终端程序</div>
              <div class="setting-desc" style="margin-top: 4px; margin-bottom: 0;">
                占位符：<code>${cwd}</code> 项目目录（正斜杠）、<code>${cwd_raw}</code> 原始路径、<code>${cc_cmd}</code> 恢复命令
              </div>
            </template>
          </div>
        </div>
        <div class="drawer-footer">
          <button class="setting-save-btn" @click="save">保存</button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.drawer-overlay {
  position: fixed;
  inset: 0;
  z-index: 10000;
  background: rgba(0,0,0,0.3);
}
.drawer-panel {
  position: absolute;
  right: 0;
  top: 0;
  bottom: 0;
  width: 420px;
  background: #fff;
  display: flex;
  flex-direction: column;
  box-shadow: -4px 0 16px rgba(0,0,0,0.1);
}
:global(.dark .drawer-panel) {
  background: #1e1e1e;
  box-shadow: -4px 0 16px rgba(0,0,0,0.4);
}
.drawer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid #e0e0e0;
}
:global(.dark .drawer-header) {
  border-color: #333;
}
.drawer-header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
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
.drawer-body {
  flex: 1;
  padding: 16px;
  overflow: auto;
}
.drawer-footer {
  padding: 12px 16px;
  border-top: 1px solid #e0e0e0;
  text-align: right;
}
:global(.dark .drawer-footer) {
  border-color: #333;
}
.drawer-enter-active, .drawer-leave-active { transition: opacity 0.2s; }
.drawer-enter-active .drawer-panel, .drawer-leave-active .drawer-panel { transition: transform 0.2s; }
.drawer-enter-from, .drawer-leave-to { opacity: 0; }
.drawer-enter-from .drawer-panel, .drawer-leave-to .drawer-panel { transform: translateX(100%); }

.setting-item { margin-bottom: 12px; }
.setting-label {
  font-size: 13px;
  font-weight: 600;
  display: block;
  margin-bottom: 2px;
}
.setting-desc {
  font-size: 11px;
  opacity: 0.5;
  margin-bottom: 6px;
}
.setting-input {
  width: 100%;
  padding: 6px 10px;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 13px;
  outline: none;
  background: inherit;
  color: inherit;
  box-sizing: border-box;
  font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
}
.setting-input:focus { border-color: #1976d2; }
:global(.dark .setting-input) { border-color: #444; }
:global(.dark .setting-input:focus) { border-color: #90caf9; }
.theme-options {
  display: flex;
  gap: 6px;
}
.theme-option {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 6px 8px;
  border: 1px solid #ddd;
  border-radius: 6px;
  background: none;
  color: inherit;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
}
.theme-option:hover {
  background: rgba(0,0,0,0.04);
}
.theme-option.active {
  border-color: #1976d2;
  background: rgba(25, 118, 210, 0.08);
  color: #1976d2;
  font-weight: 600;
}
:global(.dark .theme-option) {
  border-color: #444;
}
:global(.dark .theme-option:hover) {
  background: rgba(255,255,255,0.06);
}
:global(.dark .theme-option.active) {
  border-color: #90caf9;
  background: rgba(144, 202, 249, 0.12);
  color: #90caf9;
}
.more-examples { margin-top: 6px; }
.more-examples summary {
  cursor: pointer;
  user-select: none;
  opacity: 0.7;
  font-size: 11px;
}
.more-examples summary:hover { opacity: 1; }
.examples-list {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin-top: 5px;
}
.example-group {
  font-size: 10px;
  opacity: 0.5;
  margin-top: 4px;
  counter-reset: ex;
}
.examples-list code {
  display: block;
  counter-increment: ex;
}
.examples-list code::before {
  content: counter(ex) ". ";
  opacity: 0.5;
}
.terminal-presets {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 6px;
}
.terminal-preset-btn {
  padding: 4px 10px;
  border: 1px solid #ddd;
  border-radius: 6px;
  background: none;
  color: inherit;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.15s;
}
.terminal-preset-btn:hover {
  background: rgba(0,0,0,0.04);
}
.terminal-preset-btn.active {
  border-color: #1976d2;
  background: rgba(25, 118, 210, 0.08);
  color: #1976d2;
  font-weight: 600;
}
:global(.dark .terminal-preset-btn) {
  border-color: #444;
}
:global(.dark .terminal-preset-btn:hover) {
  background: rgba(255,255,255,0.06);
}
:global(.dark .terminal-preset-btn.active) {
  border-color: #90caf9;
  background: rgba(144, 202, 249, 0.12);
  color: #90caf9;
}
.setting-input.error { border-color: #e53935; }
:global(.dark .setting-input.error) { border-color: #ef5350; }
.input-error {
  font-size: 11px;
  color: #e53935;
  margin-top: 3px;
}
:global(.dark .input-error) { color: #ef5350; }
.setting-save-btn {
  padding: 5px 16px;
  border: none;
  border-radius: 6px;
  background: #1976d2;
  color: #fff;
  font-size: 13px;
  cursor: pointer;
}
.setting-save-btn:hover { background: #1565c0; }
:global(.dark) .setting-save-btn { background: #42a5f5; }
:global(.dark) .setting-save-btn:hover { background: #1e88e5; }
</style>
