export interface ColorRule {
  min: number
  max: number
  color: string
}

export type HeartRateSourceMode = 'mock' | 'manual' | 'ble'
export type HeartRateColorMode = 'range' | 'fixed'
export type DisplayGlowLevel = 'off' | 'soft' | 'medium' | 'strong'
export type DisplayBackgroundImageFit = 'contain' | 'cover' | 'stretch'
export type DisplayStylePreset = 'none' | 'glass' | 'capsule' | 'neon' | 'kawaii' | 'image-card'

export interface HeartDockConfig {
  heartRateSourceMode: HeartRateSourceMode
  mockPaused: boolean
  manualBpm: number
  refreshIntervalMs: number
  fontSize: number
  backgroundOpacity: number
  alwaysOnTop: boolean
  clickThrough: boolean
  showSettings: boolean
  pureDisplay: boolean
  prefixText: string
  unitText: string
  colorMode: HeartRateColorMode
  fixedColor: string
  glowLevel: DisplayGlowLevel
  colorRules: ColorRule[]
  displayBackgroundImageEnabled: boolean
  displayBackgroundImageUrl: string
  displayBackgroundImageAssetFileName: string
  displayBackgroundImageName: string
  displayBackgroundImageOpacity: number
  displayBackgroundImageFit: DisplayBackgroundImageFit
  displayStylePreset: DisplayStylePreset
}

export const defaultConfig: HeartDockConfig = {
  heartRateSourceMode: 'mock',
  mockPaused: false,
  manualBpm: 78,
  refreshIntervalMs: 1000,
  fontSize: 64,
  backgroundOpacity: 0.24,
  alwaysOnTop: true,
  clickThrough: false,
  showSettings: true,
  pureDisplay: false,
  prefixText: '\u2665',
  unitText: 'bpm',
  colorMode: 'range',
  fixedColor: '#4ade80',
  glowLevel: 'medium',
  colorRules: [
    { min: 30, max: 90, color: '#4ade80' },
    { min: 91, max: 120, color: '#facc15' },
    { min: 121, max: 240, color: '#fb7185' }
  ],
  displayBackgroundImageEnabled: false,
  displayBackgroundImageUrl: '',
  displayBackgroundImageAssetFileName: '',
  displayBackgroundImageName: '',
  displayBackgroundImageOpacity: 0.85,
  displayBackgroundImageFit: 'contain',
  displayStylePreset: 'none'
}

const CONFIG_KEY = 'heartdock.config.v1'

export function normalizeBpm(value: number): number {
  if (!Number.isFinite(value)) {
    return defaultConfig.manualBpm
  }

  return Math.min(Math.max(Math.round(value), 30), 240)
}

export function normalizeRefreshIntervalMs(value: number): number {
  if (!Number.isFinite(value)) {
    return defaultConfig.refreshIntervalMs
  }

  const roundedValue = Math.round(value / 250) * 250

  return Math.min(Math.max(roundedValue, 250), 10000)
}

export function normalizeDisplayText(value: unknown, fallback: string, maxLength = 8): string {
  if (typeof value !== 'string') {
    return fallback
  }

  return value.slice(0, maxLength)
}

export function normalizeColor(value: unknown, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback
  }

  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback
}

export function normalizeColorMode(value: unknown): HeartRateColorMode {
  return value === 'fixed' || value === 'range' ? value : defaultConfig.colorMode
}

export function normalizeGlowLevel(value: unknown): DisplayGlowLevel {
  return value === 'off' || value === 'soft' || value === 'medium' || value === 'strong'
    ? value
    : defaultConfig.glowLevel
}

export function normalizeDisplayBackgroundImageFit(value: unknown): DisplayBackgroundImageFit {
  return value === 'contain' || value === 'cover' || value === 'stretch'
    ? value
    : defaultConfig.displayBackgroundImageFit
}

export function normalizeDisplayBackgroundImageOpacity(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return defaultConfig.displayBackgroundImageOpacity
  }

  return Math.min(Math.max(value, 0), 1)
}

export function normalizeDisplayStylePreset(value: unknown): DisplayStylePreset {
  return value === 'none' ||
    value === 'glass' ||
    value === 'capsule' ||
    value === 'neon' ||
    value === 'kawaii' ||
    value === 'image-card'
    ? value
    : defaultConfig.displayStylePreset
}

export function normalizeColorRules(value: unknown): ColorRule[] {
  const fallbackRules = defaultConfig.colorRules

  if (!Array.isArray(value)) {
    return fallbackRules.map((rule) => ({ ...rule }))
  }

  return fallbackRules.map((fallbackRule, index) => {
    const parsedRule = value[index] as Partial<ColorRule> | undefined
    const rawMin =
      typeof parsedRule?.min === 'number' && Number.isFinite(parsedRule.min)
        ? Math.round(parsedRule.min)
        : fallbackRule.min
    const rawMax =
      typeof parsedRule?.max === 'number' && Number.isFinite(parsedRule.max)
        ? Math.round(parsedRule.max)
        : fallbackRule.max
    const min = Math.min(Math.max(rawMin, 30), 240)
    const max = Math.min(Math.max(rawMax, min), 240)

    return {
      min,
      max,
      color: normalizeColor(parsedRule?.color, fallbackRule.color)
    }
  })
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
      manualBpm: normalizeBpm(parsed.manualBpm ?? defaultConfig.manualBpm),
      refreshIntervalMs: normalizeRefreshIntervalMs(
        parsed.refreshIntervalMs ?? defaultConfig.refreshIntervalMs
      ),
      clickThrough: Boolean(parsed.clickThrough ?? defaultConfig.clickThrough),
      showSettings: Boolean(parsed.showSettings ?? defaultConfig.showSettings),
      pureDisplay: Boolean(parsed.pureDisplay ?? defaultConfig.pureDisplay),
      prefixText: normalizeDisplayText(parsed.prefixText, defaultConfig.prefixText, 8),
      unitText: normalizeDisplayText(parsed.unitText, defaultConfig.unitText, 8),
      colorMode: normalizeColorMode(parsed.colorMode),
      fixedColor: normalizeColor(parsed.fixedColor, defaultConfig.fixedColor),
      glowLevel: normalizeGlowLevel(parsed.glowLevel),
      colorRules: normalizeColorRules(parsed.colorRules),
      displayBackgroundImageEnabled: Boolean(
        parsed.displayBackgroundImageEnabled ?? defaultConfig.displayBackgroundImageEnabled
      ),
      displayBackgroundImageUrl: normalizeDisplayText(
        parsed.displayBackgroundImageUrl,
        defaultConfig.displayBackgroundImageUrl,
        2048
      ),
      displayBackgroundImageAssetFileName: normalizeDisplayText(
        parsed.displayBackgroundImageAssetFileName,
        defaultConfig.displayBackgroundImageAssetFileName,
        256
      ),
      displayBackgroundImageName: normalizeDisplayText(
        parsed.displayBackgroundImageName,
        defaultConfig.displayBackgroundImageName,
        128
      ),
      displayBackgroundImageOpacity: normalizeDisplayBackgroundImageOpacity(
        parsed.displayBackgroundImageOpacity
      ),
      displayBackgroundImageFit: normalizeDisplayBackgroundImageFit(parsed.displayBackgroundImageFit),
      displayStylePreset: normalizeDisplayStylePreset(parsed.displayStylePreset)
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
    refreshIntervalMs: normalizeRefreshIntervalMs(defaultConfig.refreshIntervalMs),
    manualBpm: normalizeBpm(defaultConfig.manualBpm),
    clickThrough: defaultConfig.clickThrough,
    showSettings: defaultConfig.showSettings,
    pureDisplay: defaultConfig.pureDisplay,
    prefixText: normalizeDisplayText(defaultConfig.prefixText, '\u2665', 8),
    unitText: normalizeDisplayText(defaultConfig.unitText, 'bpm', 8),
    colorMode: defaultConfig.colorMode,
    fixedColor: normalizeColor(defaultConfig.fixedColor, '#4ade80'),
    glowLevel: defaultConfig.glowLevel,
    colorRules: normalizeColorRules(defaultConfig.colorRules),
    displayBackgroundImageEnabled: defaultConfig.displayBackgroundImageEnabled,
    displayBackgroundImageUrl: defaultConfig.displayBackgroundImageUrl,
    displayBackgroundImageAssetFileName: defaultConfig.displayBackgroundImageAssetFileName,
    displayBackgroundImageName: defaultConfig.displayBackgroundImageName,
    displayBackgroundImageOpacity: defaultConfig.displayBackgroundImageOpacity,
    displayBackgroundImageFit: defaultConfig.displayBackgroundImageFit,
    displayStylePreset: defaultConfig.displayStylePreset
  }
}
