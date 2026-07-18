import { ref } from 'vue'

export function useSearch() {
  const searchVisible = ref(false)
  const searchText = ref('')
  const matchIndex = ref(0)
  const matchCount = ref(0)

  // Search options
  const caseSensitive = ref(false)
  const wholeWord = ref(false)
  const useRegex = ref(false)

  function openSearch() {
    searchVisible.value = true
  }

  function closeSearch() {
    searchVisible.value = false
    searchText.value = ''
    clearHighlights()
  }

  function clearHighlights() {
    document.querySelectorAll('.search-highlight').forEach(el => {
      const parent = el.parentNode
      parent.replaceChild(document.createTextNode(el.textContent), el)
      parent.normalize()
    })
    matchCount.value = 0
    matchIndex.value = 0
  }

  function buildRegex(query) {
    if (!query) return null
    let pattern
    if (useRegex.value) {
      try { pattern = query } catch { return null }
    } else {
      pattern = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    }
    if (wholeWord.value) {
      pattern = `\\b${pattern}\\b`
    }
    const flags = caseSensitive.value ? 'g' : 'gi'
    try { return new RegExp(`(${pattern})`, flags) } catch { return null }
  }

  function doSearch() {
    clearHighlights()
    const query = searchText.value.trim()
    if (!query) return

    const regex = buildRegex(query)
    if (!regex) return

    const container = document.querySelector('.content-body')
    if (!container) return

    // Test function for text node pre-filter
    const testRegex = new RegExp(regex.source, regex.flags)

    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
    const textNodes = []
    while (walker.nextNode()) {
      testRegex.lastIndex = 0
      if (testRegex.test(walker.currentNode.textContent)) {
        textNodes.push(walker.currentNode)
      }
    }

    let count = 0
    for (const node of textNodes) {
      const text = node.textContent
      const splitRegex = new RegExp(regex.source, regex.flags)
      const parts = text.split(splitRegex)
      if (parts.length <= 1) continue

      const fragment = document.createDocumentFragment()
      for (let i = 0; i < parts.length; i++) {
        // Odd indices are captured matches from split with capturing group
        if (i % 2 === 1) {
          const span = document.createElement('span')
          span.className = 'search-highlight'
          span.dataset.matchIndex = count
          span.textContent = parts[i]
          fragment.appendChild(span)
          count++
        } else if (parts[i]) {
          fragment.appendChild(document.createTextNode(parts[i]))
        }
      }
      node.parentNode.replaceChild(fragment, node)
    }
    matchCount.value = count
    matchIndex.value = count > 0 ? 0 : -1
    if (count > 0) scrollToMatch(0)
  }

  function scrollToMatch(index) {
    document.querySelectorAll('.search-highlight.active').forEach(el => el.classList.remove('active'))
    const matches = document.querySelectorAll('.search-highlight')
    if (matches[index]) {
      matches[index].classList.add('active')
      matches[index].scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }

  function nextMatch() {
    if (matchCount.value === 0) return
    matchIndex.value = (matchIndex.value + 1) % matchCount.value
    scrollToMatch(matchIndex.value)
  }

  function prevMatch() {
    if (matchCount.value === 0) return
    matchIndex.value = (matchIndex.value - 1 + matchCount.value) % matchCount.value
    scrollToMatch(matchIndex.value)
  }

  return {
    searchVisible, searchText, matchIndex, matchCount,
    caseSensitive, wholeWord, useRegex,
    openSearch, closeSearch, doSearch, nextMatch, prevMatch
  }
}
