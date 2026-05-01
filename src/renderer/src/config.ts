export interface ColorRule {
  min: number
  max: number
  color: string
}

export interface HeartDockConfig {
  refreshIntervalMs: number
  fontSize: number
  backgroundOpacity: number
  alwaysOnTop: boolean
  clickThrough: boolean
  showSettings: boolean
  colorRules: ColorRule[]
}

export const defaultConfig: HeartDockConfig = {
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

export function loadConfig(): HeartDockConfig {
  const raw = localStorage.getItem(CONFIG_KEY)

  if (!raw) {
    return defaultConfig
  }

  try {
    return {
      ...defaultConfig,
      ...JSON.parse(raw)
    }
  } catch {
    return defaultConfig
  }
}

export function saveConfig(config: HeartDockConfig): void {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config, null, 2))
}
