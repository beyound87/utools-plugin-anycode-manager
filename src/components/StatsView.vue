<script setup>
import { ref, computed, watch } from 'vue'
import { IconClose } from './icons'
import { formatSize } from '../composables/useFormat'

const props = defineProps({ show: Boolean })
const emit = defineEmits(['close'])

const stats = ref(null)
const loading = ref(false)

const PROVIDER_COLORS = { claude: '#d97706', codex: '#059669', gemini: '#2563eb', opencode: '#7c3aed' }
const PROVIDER_LABEL = { claude: 'Claude', codex: 'Codex', gemini: 'Gemini', opencode: 'OpenCode' }

function load() {
  loading.value = true
  setTimeout(() => {
    try { stats.value = window.services.getStats() } catch (e) { console.error(e) }
    loading.value = false
  }, 0)
}

// 打开时加载
watch(() => props.show, (v) => { if (v && !stats.value) load() })

const providerList = computed(() => {
  if (!stats.value) return []
  return Object.values(stats.value.perProvider).filter(p => p.sessions > 0)
})
const maxProviderSessions = computed(() => Math.max(1, ...providerList.value.map(p => p.sessions)))

// 最近 14 天活跃度
const activityBars = computed(() => {
  if (!stats.value) return []
  const days = []
  const today = new Date()
  for (let i = 13; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86400000)
    const key = d.toISOString().slice(0, 10)
    days.push({ key, label: (d.getMonth() + 1) + '/' + d.getDate(), count: stats.value.activityByDay[key] || 0 })
  }
  return days
})
const maxActivity = computed(() => Math.max(1, ...activityBars.value.map(d => d.count)))
const maxTopSize = computed(() => Math.max(1, ...(stats.value?.topProjects || []).map(p => p.sessions)))

const totalCost = computed(() => {
  if (!stats.value) return 0
  let c = 0
  for (const p of Object.values(stats.value.perProvider)) if (p.cost?.cost) c += p.cost.cost
  return c
})

function fmtNum(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B'
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'
  return String(n)
}
</script>

<template>
  <Transition name="drawer">
    <div v-if="show" class="drawer-overlay" @click.self="emit('close')" @keydown.escape="emit('close')" tabindex="-1">
      <div class="stats-panel">
        <div class="drawer-header">
          <h3>统计洞察</h3>
          <button class="icon-btn" @click="emit('close')" title="关闭"><IconClose /></button>
        </div>
        <div class="stats-body">
          <div v-if="loading" class="stats-loading">统计中…</div>
          <template v-else-if="stats">
            <!-- 概览卡片 -->
            <div class="stat-cards">
              <div class="stat-card">
                <div class="stat-num">{{ stats.totalSessions }}</div>
                <div class="stat-label">总会话</div>
              </div>
              <div class="stat-card">
                <div class="stat-num">{{ formatSize(stats.totalSize) }}</div>
                <div class="stat-label">占用空间</div>
              </div>
              <div class="stat-card">
                <div class="stat-num">{{ providerList.length }}</div>
                <div class="stat-label">在用平台</div>
              </div>
              <div class="stat-card" v-if="totalCost > 0">
                <div class="stat-num">${{ totalCost.toFixed(2) }}</div>
                <div class="stat-label">OpenCode 花费</div>
              </div>
            </div>

            <!-- 平台分布 -->
            <div class="stat-section">
              <div class="stat-section-title">平台分布</div>
              <div v-for="p in providerList" :key="p.id" class="bar-row">
                <span class="bar-label">
                  <span class="bar-dot" :style="{ background: PROVIDER_COLORS[p.id] }"></span>
                  {{ PROVIDER_LABEL[p.id] || p.name }}
                </span>
                <div class="bar-track">
                  <div class="bar-fill" :style="{ width: (p.sessions / maxProviderSessions * 100) + '%', background: PROVIDER_COLORS[p.id] }"></div>
                </div>
                <span class="bar-value">{{ p.sessions }}<span class="bar-sub" v-if="p.size"> · {{ formatSize(p.size) }}</span></span>
              </div>
            </div>

            <!-- 最近 14 天活跃度 -->
            <div class="stat-section">
              <div class="stat-section-title">最近 14 天活跃度</div>
              <div class="activity-chart">
                <div v-for="d in activityBars" :key="d.key" class="activity-col" :title="d.label + '：' + d.count + ' 个会话'">
                  <div class="activity-bar" :style="{ height: Math.max(2, d.count / maxActivity * 60) + 'px' }" :class="{ zero: d.count === 0 }"></div>
                  <span class="activity-label">{{ d.label }}</span>
                </div>
              </div>
            </div>

            <!-- Top 项目 -->
            <div class="stat-section" v-if="stats.topProjects.length">
              <div class="stat-section-title">会话最多的项目</div>
              <div v-for="p in stats.topProjects" :key="p.provider + p.name" class="bar-row">
                <span class="bar-label bar-label-project" :title="p.name">
                  <span class="bar-dot" :style="{ background: PROVIDER_COLORS[p.provider] }"></span>
                  {{ p.name }}
                </span>
                <div class="bar-track">
                  <div class="bar-fill" :style="{ width: (p.sessions / maxTopSize * 100) + '%', background: PROVIDER_COLORS[p.provider] }"></div>
                </div>
                <span class="bar-value">{{ p.sessions }}</span>
              </div>
            </div>

            <!-- OpenCode token（如有）-->
            <div class="stat-section" v-if="stats.perProvider.opencode?.cost">
              <div class="stat-section-title">OpenCode Token</div>
              <div class="token-grid">
                <div class="token-item"><span>输入</span><b>{{ fmtNum(stats.perProvider.opencode.cost.tokensInput) }}</b></div>
                <div class="token-item"><span>输出</span><b>{{ fmtNum(stats.perProvider.opencode.cost.tokensOutput) }}</b></div>
                <div class="token-item"><span>推理</span><b>{{ fmtNum(stats.perProvider.opencode.cost.tokensReasoning) }}</b></div>
                <div class="token-item"><span>缓存读</span><b>{{ fmtNum(stats.perProvider.opencode.cost.cacheRead) }}</b></div>
              </div>
            </div>
          </template>
        </div>
        <div class="drawer-footer">
          <button class="stat-refresh" @click="load">重新统计</button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.drawer-overlay { position: fixed; inset: 0; z-index: 10000; background: rgba(0,0,0,0.3); }
.stats-panel {
  position: absolute; right: 0; top: 0; bottom: 0; width: 460px;
  background: #fff; display: flex; flex-direction: column; box-shadow: -4px 0 16px rgba(0,0,0,0.1);
}
:global(.dark) .stats-panel { background: #1e1e1e; box-shadow: -4px 0 16px rgba(0,0,0,0.4); }
.drawer-header { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid #e0e0e0; }
:global(.dark) .drawer-header { border-color: #333; }
.drawer-header h3 { margin: 0; font-size: 16px; font-weight: 600; }
.icon-btn { display: flex; align-items: center; justify-content: center; width: 32px; height: 32px; border: none; background: none; border-radius: 6px; cursor: pointer; color: inherit; opacity: 0.7; }
.icon-btn:hover { opacity: 1; background: rgba(0,0,0,0.06); }
:global(.dark) .icon-btn:hover { background: rgba(255,255,255,0.08); }
.stats-body { flex: 1; padding: 16px; overflow: auto; }
.stats-loading { text-align: center; padding: 40px; opacity: 0.5; }
.drawer-footer { padding: 10px 16px; border-top: 1px solid #e0e0e0; text-align: right; }
:global(.dark) .drawer-footer { border-color: #333; }
.stat-refresh { padding: 5px 14px; border: 1px solid #ddd; border-radius: 6px; background: none; color: inherit; font-size: 12px; cursor: pointer; }
.stat-refresh:hover { background: rgba(0,0,0,0.04); }
:global(.dark) .stat-refresh { border-color: #444; }
:global(.dark) .stat-refresh:hover { background: rgba(255,255,255,0.08); }

.stat-cards { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 18px; }
.stat-card { background: rgba(0,0,0,0.03); border-radius: 10px; padding: 14px; text-align: center; }
:global(.dark) .stat-card { background: rgba(255,255,255,0.05); }
.stat-num { font-size: 22px; font-weight: 700; letter-spacing: -0.02em; }
.stat-label { font-size: 12px; opacity: 0.55; margin-top: 3px; }

.stat-section { margin-bottom: 20px; }
.stat-section-title { font-size: 13px; font-weight: 600; margin-bottom: 10px; opacity: 0.85; }
.bar-row { display: flex; align-items: center; gap: 8px; margin-bottom: 7px; }
.bar-label { display: flex; align-items: center; gap: 5px; width: 90px; flex-shrink: 0; font-size: 12px; }
.bar-label-project { width: 130px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bar-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.bar-track { flex: 1; height: 8px; background: rgba(0,0,0,0.06); border-radius: 4px; overflow: hidden; }
:global(.dark) .bar-track { background: rgba(255,255,255,0.08); }
.bar-fill { height: 100%; border-radius: 4px; transition: width 0.3s ease; }
.bar-value { font-size: 11px; opacity: 0.7; flex-shrink: 0; min-width: 40px; text-align: right; }
.bar-sub { opacity: 0.6; }

.activity-chart { display: flex; align-items: flex-end; gap: 4px; height: 80px; }
.activity-col { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; gap: 4px; }
.activity-bar { width: 100%; max-width: 18px; background: #1976d2; border-radius: 3px 3px 0 0; min-height: 2px; }
.activity-bar.zero { background: rgba(0,0,0,0.1); }
:global(.dark) .activity-bar { background: #90caf9; }
:global(.dark) .activity-bar.zero { background: rgba(255,255,255,0.1); }
.activity-label { font-size: 10px; opacity: 0.45; white-space: nowrap; }

.token-grid { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 8px; }
.token-item { background: rgba(0,0,0,0.03); border-radius: 8px; padding: 8px; text-align: center; }
:global(.dark) .token-item { background: rgba(255,255,255,0.05); }
.token-item span { font-size: 10px; opacity: 0.5; display: block; }
.token-item b { font-size: 14px; }

.drawer-enter-active, .drawer-leave-active { transition: opacity 0.2s; }
.drawer-enter-active .stats-panel, .drawer-leave-active .stats-panel { transition: transform 0.2s; }
.drawer-enter-from, .drawer-leave-to { opacity: 0; }
.drawer-enter-from .stats-panel, .drawer-leave-to .stats-panel { transform: translateX(100%); }
</style>
