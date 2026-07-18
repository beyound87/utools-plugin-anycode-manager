import { ref, computed, watch } from 'vue'

// 'system' | 'light' | 'dark'
const themeMode = ref(window.utools?.dbStorage?.getItem('themeMode') || 'system')
const systemDark = ref(window.matchMedia('(prefers-color-scheme: dark)').matches)

const isDark = computed(() => {
  if (themeMode.value === 'light') return false
  if (themeMode.value === 'dark') return true
  return systemDark.value
})

export function useTheme() {
  function initThemeListener() {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
      systemDark.value = e.matches
    })
  }

  function setThemeMode(mode) {
    themeMode.value = mode
    window.utools?.dbStorage?.setItem('themeMode', mode)
  }

  // 快速切换：在当前实际明暗之间切换（会覆盖跟随系统）
  function toggleTheme() {
    setThemeMode(isDark.value ? 'light' : 'dark')
  }

  return { isDark, themeMode, setThemeMode, toggleTheme, initThemeListener }
}
