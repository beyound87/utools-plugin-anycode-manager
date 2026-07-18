import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { readFileSync, writeFileSync } from 'fs'
import { resolve } from 'path'

// 构建时将 SVG logo 转为 PNG（同时输出到 dist/ 和 public/，保证 dev 模式也用新 logo）
function svgToPngPlugin() {
  return {
    name: 'svg-to-png',
    async writeBundle(options) {
      const sharp = (await import('sharp')).default
      const svgPath = resolve(__dirname, 'public/logo.svg')
      const outDir = options.dir || resolve(__dirname, 'dist')
      const svgBuffer = readFileSync(svgPath)
      const png = await sharp(svgBuffer).resize(256, 256).png().toBuffer()
      writeFileSync(resolve(outDir, 'logo.png'), png)
      writeFileSync(resolve(__dirname, 'public/logo.png'), png)
      console.log('\x1b[32m✓\x1b[0m logo.svg → logo.png (256x256)')
    }
  }
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [vue(), svgToPngPlugin()],
  base: './'
})


