// 裁剪 dist 里 better-sqlite3 的编译中间产物，只留运行时 .node
// 78MB → ~4MB，满足 uTools 20MB 上限。只动 dist/，源码 node_modules 不变。
import { existsSync, readdirSync, rmSync, statSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const bs = resolve(__dirname, '../dist/preload/node_modules/better-sqlite3')

if (!existsSync(bs)) {
  console.log('prune: 未找到 dist better-sqlite3，跳过')
  process.exit(0)
}

const buildDir = resolve(bs, 'build')
if (existsSync(buildDir)) {
  for (const e of readdirSync(buildDir)) {
    if (e !== 'Release') rmSync(resolve(buildDir, e), { recursive: true, force: true })
  }
  const rel = resolve(buildDir, 'Release')
  if (existsSync(rel)) {
    for (const e of readdirSync(rel)) {
      if (e !== 'better_sqlite3.node') rmSync(resolve(rel, e), { recursive: true, force: true })
    }
  }
}
rmSync(resolve(bs, 'deps'), { recursive: true, force: true })
rmSync(resolve(bs, 'src'), { recursive: true, force: true })

const mb = (statSync(resolve(bs, 'build/Release/better_sqlite3.node')).size / 1024 / 1024).toFixed(1)
console.log(`prune: 已裁剪 better-sqlite3（保留 better_sqlite3.node ${mb}MB）`)
