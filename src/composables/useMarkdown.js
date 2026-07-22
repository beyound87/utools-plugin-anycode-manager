import MarkdownIt from 'markdown-it'

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
  typographer: false
})

// Add target="_blank" to links
const defaultRender = md.renderer.rules.link_open || function(tokens, idx, options, env, self) {
  return self.renderToken(tokens, idx, options)
}
md.renderer.rules.link_open = function(tokens, idx, options, env, self) {
  tokens[idx].attrSet('target', '_blank')
  tokens[idx].attrSet('rel', 'noopener noreferrer')
  return defaultRender(tokens, idx, options, env, self)
}

// Add copy button and language label to code blocks
md.renderer.rules.fence = function(tokens, idx) {
  const token = tokens[idx]
  const lang = token.info.trim() || ''
  const code = md.utils.escapeHtml(token.content)
  const langLabel = lang ? `<span class="code-lang">${md.utils.escapeHtml(lang)}</span>` : ''
  return `<div class="code-block-wrapper">
    <div class="code-block-header">${langLabel}<button class="code-copy-btn" onclick="(function(btn){var code=btn.closest('.code-block-wrapper').querySelector('code').textContent;navigator.clipboard?navigator.clipboard.writeText(code):window.utools?.copyText(code);btn.textContent='已复制';setTimeout(function(){btn.textContent='复制'},1500)})(this)">复制</button></div>
    <pre class="code-block"><code class="${lang ? 'language-' + lang : ''}">${code}</code></pre>
  </div>`
}

const renderCache = new Map()
const CACHE_MAX = 500

export function renderMarkdown(text) {
  if (!text) return ''
  let html = renderCache.get(text)
  if (html !== undefined) return html
  html = md.render(text)
  if (renderCache.size >= CACHE_MAX) {
    const first = renderCache.keys().next().value
    renderCache.delete(first)
  }
  renderCache.set(text, html)
  return html
}
