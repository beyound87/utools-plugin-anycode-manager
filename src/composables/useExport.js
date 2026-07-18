import { parseContentBlocks, mergeToolBlocks, getMessageRole, getRoleLabel } from './useMessageParser'
import { formatTime } from './useFormat'

// Default export options
export const defaultExportOptions = {
  showSessionId: true,
  showCwd: true,
  showToolDetail: false,
  showStats: true,
  showThinking: false,
  filePathMode: 'short' // 'full' | 'short' | 'hidden'
}

function messagesToMarkdown(displayMessages, session) {
  let md = `# ${session.name || 'Session'}\n\n`
  md += `> Session ID: ${session.sessionId || ''}\n`
  md += `> CWD: ${session.cwd || ''}\n\n---\n\n`

  for (const item of displayMessages) {
    const role = getMessageRole(item)
    const label = getRoleLabel(role)
    const time = formatTime(item.timestamp)
    md += `### ${label}  ${time}\n\n`

    const blocks = mergeToolBlocks(parseContentBlocks(item))
    for (const block of blocks) {
      if (block.type === 'text') {
        md += block.text + '\n\n'
      } else if (block.type === 'thinking') {
        md += `<details><summary>Thinking</summary>\n\n${block.text}\n\n</details>\n\n`
      } else if (block.type === 'tool_call') {
        md += `**${block.name}**`
        if (block.input?.file_path) md += ` \`${block.input.file_path}\``
        md += '\n\n'
        if (block.result) {
          md += `<details><summary>Result</summary>\n\n\`\`\`\n${block.result}\n\`\`\`\n\n</details>\n\n`
        }
      } else if (block.type === 'image') {
        md += `[Image]\n\n`
      }
    }
    md += '---\n\n'
  }
  return md
}

export function exportAsMarkdown(displayMessages, session) {
  return messagesToMarkdown(displayMessages, session)
}

/**
 * Collect all CSS rules from the current document's stylesheets.
 * Strips Vue scoped data-v-xxx selectors so the rules work in standalone HTML.
 */
export function collectPageStyles() {
  // Selectors that are irrelevant or harmful in standalone HTML
  const skipPrefixes = [
    'html,', 'html ', '#app',
    '.sidebar', '.search-bar', '.search-box', '.search-input', '.search-clear', '.search-icon',
    '.icon-btn', '.project-', '.session-item', '.session-list', '.session-icon', '.session-info',
    '.session-name', '.session-meta', '.session-actions', '.session-count',
    '.action-btn', '.multi-select', '.multi-check', '.batch-',
    '.fav-star', '.empty-sessions', '.empty-state', '.sidebar-',
    '.dialog-', '.option-', '.fade-',
    '.content-header', '.content-cwd', '.resume-btn', '.header-action', '.export-',
    '.session-search', '.search-nav', '.search-count',
    '.scroll-btn', '.scroll-buttons',
    '.snackbar', '.image-preview',
    '.settings-', '.drawer-',
  ]
  const rules = []
  for (const sheet of document.styleSheets) {
    try {
      for (const rule of sheet.cssRules) {
        const text = rule.cssText
        // Skip @keyframes for app-specific animations
        if (rule.type === CSSRule.KEYFRAMES_RULE) continue
        // Skip rules with irrelevant selectors
        const selector = (rule.selectorText || '').trim()
        if (selector && skipPrefixes.some(p => selector.startsWith(p))) continue
        rules.push(text)
      }
    } catch { /* cross-origin sheets, skip */ }
  }
  // Strip data-v-xxx scoped attribute selectors
  return rules.join('\n').replace(/\[data-v-[a-f0-9]+\]/g, '')
}

/**
 * Serialize a DOM clone + collected CSS into a standalone HTML file.
 * Adds inline JS for collapsible tool-card and thinking blocks.
 */
export function serializeToHtml(container, title, isDark) {
  const css = collectPageStyles()
  const theme = isDark ? 'dark' : 'light'

  // Collapse toggle script
  const script = `
document.addEventListener('click', function(e) {
  var header = e.target.closest('.tool-card-header, .block-header.clickable');
  if (!header) return;
  var body = header.nextElementSibling;
  if (!body) return;
  var hidden = body.style.display === 'none';
  body.style.display = hidden ? '' : 'none';
  var icon = header.querySelector('.collapse-icon');
  if (icon) icon.textContent = hidden ? '▾' : '▸';
});`

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escHtml(title)}</title>
<style>
${css}
/* Overrides for standalone HTML */
html, body { width: auto; height: auto; overflow: auto; margin: 0; padding: 0; }
body { max-width: 860px; margin: 0 auto; padding: 24px; padding-bottom: 8px; line-height: 1.6;
  font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
  background: ${isDark ? '#1a1a1a' : '#f8f9fa'}; color: ${isDark ? '#e0e0e0' : '#1a1a1a'}; }
.content-body { overflow: visible; height: auto; padding: 0; }
.message-actions { display: none !important; }
</style>
</head>
<body class="${theme}">
${container.innerHTML}
<script>${script}<\/script>
</body>
</html>`
}

function escHtml(str) {
  if (!str) return ''
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
