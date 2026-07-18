import { ref } from 'vue'

const snackbar = ref({ show: false, message: '', type: 'success' })
let snackbarTimer = null
let snackbarEndTime = 0

export function useSnackbar() {
  function showSnackbar(message, type = 'success') {
    clearTimeout(snackbarTimer)
    snackbar.value = { show: true, message, type }
    const delay = 2500
    snackbarEndTime = Date.now() + delay
    snackbarTimer = setTimeout(() => { snackbar.value.show = false }, delay)
  }

  function pauseSnackbar() {
    if (!snackbar.value.show) return
    clearTimeout(snackbarTimer)
    snackbarTimer = null
  }

  function resumeSnackbar() {
    if (!snackbar.value.show || snackbarTimer !== null) return
    const remaining = snackbarEndTime - Date.now()
    snackbarTimer = setTimeout(() => { snackbar.value.show = false }, Math.max(remaining, 1000))
  }

  return { snackbar, showSnackbar, pauseSnackbar, resumeSnackbar }
}
