export interface ColorRule {
  min: number
  max: number
  color: string
}

export type ThemePresetId = 'default' | 'transparent' | 'highContrast' | 'streamer'
export type HeartRateSourceMode = 'mock' | 'manual'

export interface ThemePreset {
  id: ThemePresetId
  name: string
  description: string
  fontSize: number
  backgroundOpacity: number
  colorRules: ColorRule[]
}

export interface HeartDockConfig {
  themePresetId: ThemePresetId
  heartRateSourceMode: HeartRateSourceMode
  mockPaused: boolean
  manualBpm: number
  refreshIntervalMs: number
  fontSize: number
  backgroundOpacity: number
  alwaysOnTop: boolean
  clickThrough: boolean
  showSettings: boolean
  colorRules: ColorRule[]
}

export const themePresets: ThemePreset[] = [
  {
    id: 'default',
    name: '默认主题',
    description: '适合日常桌面显示的基础主题。',
    fontSize: 64,
    backgroundOpacity: 0.24,
    colorRules: [
      { min: 0, max: 90, color: '#4ade80' },
      { min: 91, max: 120, color: '#facc15' },
      { min: 121, max: 240, color: '#fb7185' }
    ]
  },
  {
    id: 'transparent',
    name: '透明主题',
    description: '更轻量的透明显示效果，适合覆盖在窗口上。',
    fontSize: 64,
    backgroundOpacity: 0.08,
    colorRules: [
      { min: 0, max: 90, color: '#93c5fd' },
      { min: 91, max: 120, color: '#fde68a' },
      { min: 121, max: 240, color: '#fda4af' }
    ]
  },
  {
    id: 'highContrast',
    name: '高对比度主题',
    description: '更强的对比度，适合复杂背景或远距离观看。',
    fontSize: 72,
    backgroundOpacity: 0.68,
    colorRules: [
      { min: 0, max: 90, color: '#22c55e' },
      { min: 91, max: 120, color: '#eab308' },
      { min: 121, max: 240, color: '#ef4444' }
    ]
  },
  {
    id: 'streamer',
    name: '直播醒目主题',
    description: '更大的数字和更明显的颜色，适合直播/录制画面。',
    fontSize: 84,
    backgroundOpacity: 0.36,
    colorRules: [
      { min: 0, max: 90, color: '#38bdf8' },
      { min: 91, max: 120, color: '#facc15' },
      { min: 121, max: 240, color: '#fb7185' }
    ]
  }
]

export const defaultConfig: HeartDockConfig = {
  themePresetId: 'default',
  heartRateSourceMode: 'mock',
  mockPaused: false,
  manualBpm: 78,
  refreshIntervalMs: 1000,
  fontSize: 64,
  backgroundOpacity: 0.24,
  alwaysOnTop: true,
  clickThrough: false,
  showSettings: true,
  colorRules: [
    { min: 0, max: 90, color: '#4ade80' },
    { min: 91, max: 120, color: '#facc15' },
    { min: 121, max: 240, color: '#fb7185' }
  ]
}

const CONFIG_KEY = 'heartdock.config.v1'

export function getThemePreset(id: ThemePresetId): ThemePreset {
  return themePresets.find((theme) => theme.id === id) ?? themePresets[0]
}

export function applyThemePreset(config: HeartDockConfig, themeId: ThemePresetId): HeartDockConfig {
  const theme = getThemePreset(themeId)

  return {
    ...config,
    themePresetId: theme.id,
    fontSize: theme.fontSize,
    backgroundOpacity: theme.backgroundOpacity,
    colorRules: theme.colorRules
  }
}

export function normalizeBpm(value: number): number {
  if (!Number.isFinite(value)) {
    return defaultConfig.manualBpm
  }

  return Math.min(Math.max(Math.round(value), 30), 240)
}

export function loadConfig(): HeartDockConfig {
  const raw = localStorage.getItem(CONFIG_KEY)

  if (!raw) {
    return createDefaultConfig()
  }

  try {
    const parsed = JSON.parse(raw) as Partial<HeartDockConfig>

    return {
      ...createDefaultConfig(),
      ...parsed,
      manualBpm: normalizeBpm(parsed.manualBpm ?? defaultConfig.manualBpm)
    }
  } catch {
    return createDefaultConfig()
  }
}

export function saveConfig(config: HeartDockConfig): void {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config, null, 2))
}

export function createDefaultConfig(): HeartDockConfig {
  return {
    ...defaultConfig,
    colorRules: [...defaultConfig.colorRules]
  }
}