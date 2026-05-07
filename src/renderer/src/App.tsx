import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent
} from 'react'

import {
  DisplayBackgroundImageFit,
  DisplayGlowLevel,
  DisplayStylePreset,
  HeartDockConfig,
  HeartRateColorMode,
  HeartRateSourceMode,
  ScenePresetId,
  createDefaultConfig,
  loadConfig,
  normalizeBpm,
  normalizeColor,
  normalizeConfig,
  normalizeDisplayBackgroundImageOpacity,
  normalizeDisplayText,
  normalizeRefreshIntervalMs,
  saveConfig
} from './config'
import { MockHeartRateSource } from './core/MockHeartRateSource'

type BleConnectionStatus = 'idle' | 'connecting' | 'connected' | 'failed'
type FirstRunNoticeMode = 'required' | 'splash'
type AppearanceMode = 'dark' | 'light'
type OnboardingStepId = 'source' | 'display' | 'pure' | 'dynamic' | 'recording' | 'tools'

interface HeartRateRecordSample {
  timestamp: number
  bpm: number
}

interface HeartRateRecordSummary {
  startedAt: number
  endedAt: number
  durationMs: number
  averageBpm: number
  maxBpm: number
  minBpm: number
  maxBpmAt: number
  minBpmAt: number
  sampleCount: number
  samples: HeartRateRecordSample[]
}

interface HeartRateZoneSummary {
  label: string
  color: string
  count: number
  percent: number
}

interface HeartRateReportWindowPayload {
  report: HeartRateRecordSummary | null
  notice: string
  config: HeartDockConfig
  versionLabel: string
  generatedAt: number
}

interface OnboardingStep {
  id: OnboardingStepId
  title: string
  body: string
  targetId: string
}

interface OnboardingRect {
  top: number
  left: number
  width: number
  height: number
}

interface FloatingHelpTooltip {
  text: string
  top: number
  left: number
  placement: 'above' | 'below'
}

interface ScenePreset {
  id: ScenePresetId
  label: string
  description: string
  recommendedFor: string
  config: Partial<HeartDockConfig>
}


const SOURCE_CODE_URL = 'https://github.com/HHS3188/heartdock'
const FEEDBACK_URL = 'https://github.com/HHS3188/heartdock/issues/new'
const FIRST_RUN_NOTICE_KEY = 'heartdock.firstRunNotice.v1'
const ONBOARDING_TOUR_KEY = 'heartdock.onboardingTour.v1'
const APPEARANCE_MODE_KEY = 'heartdock.appearanceMode.v1'
const FIRST_RUN_NOTICE_SECONDS = 15
const STARTUP_UPDATE_GATE_SECONDS = 3
const HEART_RATE_REPORT_VERSION_LABEL = 'v0.9.0'
const ONBOARDING_WINDOW_SIZE = {
  width: 1080,
  height: 760
}

const defaultUpdateSummary: UpdateSummary = {
  status: 'idle',
  currentVersion: '0.9.0',
  latestVersion: '',
  releaseName: '',
  releaseNotes: [],
  releaseDate: '',
  releasePageUrl: 'https://github.com/HHS3188/heartdock/releases/latest',
  isMajorUpdate: false,
  progressPercent: 0,
  message: ''
}

const onboardingSteps: OnboardingStep[] = [
  {
    id: 'source',
    title: '选择心率来源',
    body: '这里决定 HeartDock 使用模拟、手动还是 BLE 心率设备。第一次使用建议先用模拟心率确认显示效果。',
    targetId: 'tour-source'
  },
  {
    id: 'display',
    title: '调整心率显示',
    body: '这里控制字号、文字、颜色、发光和显示框样式，会同时影响普通模式和纯享模式。',
    targetId: 'tour-display'
  },
  {
    id: 'pure',
    title: '进入纯享模式',
    body: '纯享模式会隐藏设置，只保留心率本体。可以拖动位置，双击心率区域退出。',
    targetId: 'tour-pure'
  },
  {
    id: 'dynamic',
    title: '设置动态效果',
    body: '这里控制心跳缩放、颜色过渡和高低心率提醒。想降低性能开销时可以关闭部分动效。',
    targetId: 'tour-dynamic'
  },
  {
    id: 'recording',
    title: '记录纯享心率',
    body: '开启后进入纯享模式会记录本次有效心率，退出纯享时在独立报告窗口中查看和导出 PNG。',
    targetId: 'tour-recording'
  },
  {
    id: 'tools',
    title: '维护和反馈工具',
    body: '这里可以检查更新、导出诊断信息、导出配置，并在反馈问题时附带诊断文件。',
    targetId: 'tour-tools'
  }
]


const colorPresetOptions = [
  '#4ade80',
  '#22c55e',
  '#38bdf8',
  '#60a5fa',
  '#a78bfa',
  '#facc15',
  '#fb923c',
  '#fb7185',
  '#ef4444',
  '#f8fafc'
]

interface SelectOption<T extends string> {
  value: T
  label: string
  description?: string
}

const sourceModeOptions: Array<SelectOption<HeartRateSourceMode>> = [
  { value: 'mock', label: '模拟心率', description: '自动生成心率，适合测试样式。' },
  { value: 'manual', label: '手动输入', description: '固定显示指定 BPM。' },
  { value: 'ble', label: 'BLE 心率设备（实验）', description: '读取标准 BLE 心率服务。' }
]

const colorModeOptions: Array<SelectOption<HeartRateColorMode>> = [
  { value: 'range', label: '跟随心率区间', description: '不同心率区间显示不同颜色。' },
  { value: 'fixed', label: '固定颜色', description: '始终使用同一种颜色。' }
]

const glowLevelOptions: Array<SelectOption<DisplayGlowLevel>> = [
  { value: 'off', label: '关闭', description: '不显示发光效果。' },
  { value: 'soft', label: '弱', description: '轻微发光。' },
  { value: 'medium', label: '中', description: '默认发光强度。' },
  { value: 'strong', label: '强', description: '更醒目的发光效果。' }
]

const backgroundImageFitOptions: Array<SelectOption<DisplayBackgroundImageFit>> = [
  { value: 'contain', label: '完整显示', description: '完整显示图片，可能留出空白。' },
  { value: 'cover', label: '铺满裁切', description: '铺满背景区域，边缘可能被裁切。' },
  { value: 'stretch', label: '拉伸填满', description: '强制填满区域，可能改变图片比例。' }
]

const displayStylePresetOptions: Array<SelectOption<DisplayStylePreset>> = [
  { value: 'none', label: '无背景', description: '只显示心率文字，适合最干净的纯享叠加。' },
  { value: 'glass', label: '柔和玻璃卡片', description: '半透明玻璃质感，适合日常桌面。' },
  { value: 'capsule', label: '圆角胶囊', description: '紧凑的圆角胶囊框，适合小尺寸悬浮。' },
  { value: 'neon', label: '霓虹直播框', description: '带弱发光边框，适合直播和录屏。' },
  { value: 'kawaii', label: '二次元贴纸风', description: '粉蓝渐变、爱心和星星点缀，偏可爱风。' },
  { value: 'aurora', label: '极光流光框', description: '冷暖光带边框，适合深色全屏叠加。' },
  { value: 'mono', label: '极简描边框', description: '低开销细线框，适合游戏和长期显示。' },
  { value: 'heartbeat', label: '心电监护框', description: '监护仪风格网格和心电线，适合运动数据展示。' },
  { value: 'pixel', label: '像素游戏框', description: '像素描边和低分辨率质感，适合复古游戏叠加。' },
  { value: 'cyber-scan', label: '赛博扫描框', description: '扫描线和科技边角，适合节奏感强的全屏场景。' },
  { value: 'cloud', label: '软萌云朵框', description: '柔和云朵轮廓和轻量阴影，适合桌面陪伴。' }
]

const scenePresets: ScenePreset[] = [
  {
    id: 'stream-overlay',
    label: '直播叠加',
    description: '高可读、发光明显，适合直播和录屏画面。',
    recommendedFor: '直播 / 录屏',
    config: {
      displayStylePreset: 'neon',
      fontSize: 72,
      glowLevel: 'strong',
      colorMode: 'range',
      backgroundOpacity: 0.18,
      heartbeatPulseEnabled: true,
      smoothColorTransitionEnabled: true,
      highHeartRateAlertEnabled: true,
      highHeartRateAlertThreshold: 150,
      lowHeartRateBreathEnabled: false
    }
  },
  {
    id: 'game-minimal',
    label: '游戏极简',
    description: '低占用、低干扰，适合长时间游戏叠加。',
    recommendedFor: '游戏 / 全屏',
    config: {
      displayStylePreset: 'mono',
      fontSize: 58,
      glowLevel: 'soft',
      colorMode: 'fixed',
      fixedColor: '#38bdf8',
      backgroundOpacity: 0.08,
      heartbeatPulseEnabled: false,
      smoothColorTransitionEnabled: true,
      highHeartRateAlertEnabled: false,
      lowHeartRateBreathEnabled: false
    }
  },
  {
    id: 'desktop-companion',
    label: '桌面陪伴',
    description: '柔和玻璃和轻微动态，适合日常桌面观察。',
    recommendedFor: '日常桌面',
    config: {
      displayStylePreset: 'glass',
      fontSize: 64,
      glowLevel: 'medium',
      colorMode: 'range',
      backgroundOpacity: 0.22,
      heartbeatPulseEnabled: true,
      smoothColorTransitionEnabled: true,
      highHeartRateAlertEnabled: false,
      lowHeartRateBreathEnabled: true
    }
  },
  {
    id: 'anime-sticker',
    label: '二次元贴纸',
    description: '粉蓝贴纸感，适合轻松可爱的叠加风格。',
    recommendedFor: '陪伴 / 贴纸',
    config: {
      displayStylePreset: 'kawaii',
      fontSize: 62,
      glowLevel: 'soft',
      colorMode: 'fixed',
      fixedColor: '#fb7185',
      backgroundOpacity: 0.2,
      heartbeatPulseEnabled: true,
      smoothColorTransitionEnabled: true,
      highHeartRateAlertEnabled: false,
      lowHeartRateBreathEnabled: true
    }
  },
  {
    id: 'ecg-monitor',
    label: '心电监护',
    description: '监护仪视觉和高心率提醒，适合运动数据展示。',
    recommendedFor: '运动 / 监测',
    config: {
      displayStylePreset: 'heartbeat',
      fontSize: 66,
      glowLevel: 'medium',
      colorMode: 'range',
      backgroundOpacity: 0.16,
      heartbeatPulseEnabled: true,
      smoothColorTransitionEnabled: true,
      highHeartRateAlertEnabled: true,
      highHeartRateAlertThreshold: 145,
      lowHeartRateBreathEnabled: false
    }
  },
  {
    id: 'office-subtle',
    label: '办公低调',
    description: '弱动效和低饱和度，适合明亮环境长期显示。',
    recommendedFor: '办公 / 白天',
    config: {
      displayStylePreset: 'cloud',
      fontSize: 56,
      glowLevel: 'off',
      colorMode: 'fixed',
      fixedColor: '#0ea5e9',
      backgroundOpacity: 0.12,
      heartbeatPulseEnabled: false,
      smoothColorTransitionEnabled: true,
      highHeartRateAlertEnabled: false,
      lowHeartRateBreathEnabled: false
    }
  }
]

const appearanceModeOptions: Array<SelectOption<AppearanceMode>> = [
  { value: 'dark', label: '黑夜模式', description: '深色透明悬浮界面，适合桌面叠加和夜间使用。' },
  { value: 'light', label: '日间模式', description: '浅色柔和界面，适合明亮桌面环境。' }
]

const scenePresetOptions: Array<SelectOption<ScenePresetId>> = scenePresets.map((preset) => ({
  value: preset.id,
  label: preset.label,
  description: preset.description
}))

interface BleCharacteristic {
  value?: DataView
  startNotifications: () => Promise<BleCharacteristic>
  stopNotifications?: () => Promise<BleCharacteristic>
  addEventListener: (type: 'characteristicvaluechanged', listener: (event: Event) => void) => void
  removeEventListener: (type: 'characteristicvaluechanged', listener: (event: Event) => void) => void
}

interface BleService {
  getCharacteristic: (characteristic: string) => Promise<BleCharacteristic>
}

interface BleServer {
  connected?: boolean
  connect: () => Promise<BleServer>
  disconnect?: () => void
  getPrimaryService: (service: string) => Promise<BleService>
}

interface BleDevice {
  id: string
  name?: string
  gatt?: BleServer
  addEventListener: (type: 'gattserverdisconnected', listener: (event: Event) => void) => void
  removeEventListener: (type: 'gattserverdisconnected', listener: (event: Event) => void) => void
}

interface NavigatorWithBluetooth extends Navigator {
  bluetooth?: {
    requestDevice: (options: {
      filters: Array<{ services: string[] }>
      optionalServices?: string[]
    }) => Promise<BleDevice>
  }
}

function getColorForBpm(bpm: number, config: HeartDockConfig): string {
  if (config.colorMode === 'fixed') {
    return config.fixedColor
  }

  const rule = config.colorRules.find((item) => bpm >= item.min && bpm <= item.max)
  return rule?.color ?? '#ffffff'
}

function clampColorRuleValue(value: number): number {
  if (!Number.isFinite(value)) {
    return 30
  }

  return Math.min(Math.max(Math.round(value), 30), 240)
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function parseHeartRateMeasurement(value: DataView): number | null {
  if (value.byteLength < 2) {
    return null
  }

  const flags = value.getUint8(0)
  const is16BitHeartRate = (flags & 0x01) === 0x01

  if (is16BitHeartRate) {
    if (value.byteLength < 3) {
      return null
    }

    return normalizeBpm(value.getUint16(1, true))
  }

  return normalizeBpm(value.getUint8(1))
}

function getBleDeviceDisplayName(device: BleDevice): string {
  const fallbackName = `BLE 心率设备 ${device.id.slice(0, 8)}`
  const rawName = device.name?.trim()

  if (!rawName) {
    return fallbackName
  }

  const cleanedName = rawName
    .replace(/\uFFFD/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (!cleanedName) {
    return fallbackName
  }

  if (cleanedName.toLowerCase() === 'xiaomi') {
    return 'Xiaomi 心率设备'
  }

  return cleanedName
}

function getImportedConfigCandidate(payload: unknown): unknown {
  if (payload && typeof payload === 'object' && 'config' in payload) {
    return (payload as { config?: unknown }).config
  }

  return payload
}

function formatDateTime(timestamp: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(new Date(timestamp))
}

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  return minutes > 0 ? `${minutes} 分 ${seconds} 秒` : `${seconds} 秒`
}

function getTimestampFilePart(timestamp: number): string {
  const date = new Date(timestamp)

  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
    String(date.getHours()).padStart(2, '0'),
    String(date.getMinutes()).padStart(2, '0'),
    String(date.getSeconds()).padStart(2, '0')
  ].join('-')
}

function buildHeartRateRecordSummary(
  startedAt: number,
  endedAt: number,
  samples: HeartRateRecordSample[]
): HeartRateRecordSummary | null {
  if (samples.length === 0) {
    return null
  }

  let totalBpm = 0
  let maxSample = samples[0]
  let minSample = samples[0]

  for (const sample of samples) {
    totalBpm += sample.bpm

    if (sample.bpm > maxSample.bpm) {
      maxSample = sample
    }

    if (sample.bpm < minSample.bpm) {
      minSample = sample
    }
  }

  return {
    startedAt,
    endedAt,
    durationMs: Math.max(endedAt - startedAt, 0),
    averageBpm: Math.round(totalBpm / samples.length),
    maxBpm: maxSample.bpm,
    minBpm: minSample.bpm,
    maxBpmAt: maxSample.timestamp,
    minBpmAt: minSample.timestamp,
    sampleCount: samples.length,
    samples: samples.map((sample) => ({ ...sample }))
  }
}

function getHeartRateZoneSummary(
  report: HeartRateRecordSummary,
  config: HeartDockConfig
): HeartRateZoneSummary[] {
  return config.colorRules.map((rule) => {
    const count = report.samples.filter((sample) => sample.bpm >= rule.min && sample.bpm <= rule.max)
      .length

    return {
      label: `${rule.min}-${rule.max}`,
      color: rule.color,
      count,
      percent: report.sampleCount > 0 ? Math.round((count / report.sampleCount) * 100) : 0
    }
  })
}

function getChartMarkerSamples(report: HeartRateRecordSummary, maxMarkers = 12): HeartRateRecordSample[] {
  if (report.samples.length <= maxMarkers) {
    return report.samples
  }

  const requiredSamples = [
    report.samples[0],
    report.samples[report.samples.length - 1],
    report.samples.find((sample) => sample.timestamp === report.maxBpmAt && sample.bpm === report.maxBpm),
    report.samples.find((sample) => sample.timestamp === report.minBpmAt && sample.bpm === report.minBpm)
  ].filter((sample): sample is HeartRateRecordSample => Boolean(sample))

  const markerMap = new Map<string, HeartRateRecordSample>()
  const addMarker = (sample: HeartRateRecordSample): void => {
    markerMap.set(`${sample.timestamp}-${sample.bpm}`, sample)
  }

  requiredSamples.forEach(addMarker)

  const remainingSlots = Math.max(0, maxMarkers - markerMap.size)

  if (remainingSlots > 0) {
    const step = Math.max(1, Math.floor((report.samples.length - 1) / (remainingSlots + 1)))

    for (let index = step; index < report.samples.length - 1 && markerMap.size < maxMarkers; index += step) {
      addMarker(report.samples[index])
    }
  }

  return Array.from(markerMap.values()).sort((first, second) => first.timestamp - second.timestamp)
}

function getHeartRateReportInsights(report: HeartRateRecordSummary) {
  const firstSample = report.samples[0]
  const lastSample = report.samples[report.samples.length - 1] ?? firstSample
  const deltaBpm = lastSample.bpm - firstSample.bpm
  const rangeBpm = report.maxBpm - report.minBpm
  const sampleInterval =
    report.sampleCount > 1 ? Math.round(report.durationMs / Math.max(1, report.sampleCount - 1) / 100) / 10 : 0
  const trendLabel = Math.abs(deltaBpm) <= 2 ? '基本平稳' : deltaBpm > 0 ? '整体上升' : '整体下降'
  const stabilityLabel = rangeBpm <= 5 ? '波动很小' : rangeBpm <= 15 ? '轻微波动' : '波动明显'

  return {
    trendLabel,
    trendDetail: `${firstSample.bpm} → ${lastSample.bpm} bpm，变化 ${deltaBpm > 0 ? '+' : ''}${deltaBpm} bpm`,
    stabilityLabel,
    stabilityDetail: `最高与最低相差 ${rangeBpm} bpm`,
    densityLabel: `${report.sampleCount} 个样本`,
    densityDetail: sampleInterval > 0 ? `平均约 ${sampleInterval} 秒一个样本` : '本次记录时间较短',
    peakDetail: `最高 ${getTimeOffsetLabel(report.startedAt, report.maxBpmAt)}，最低 ${getTimeOffsetLabel(
      report.startedAt,
      report.minBpmAt
    )}`
  }
}

function createHeartRateReportPngBase64(
  report: HeartRateRecordSummary,
  config: HeartDockConfig,
  versionLabel = HEART_RATE_REPORT_VERSION_LABEL
): string {
  const canvas = document.createElement('canvas')
  canvas.width = 1200
  canvas.height = 860

  const context = canvas.getContext('2d')

  if (!context) {
    throw new Error('当前环境无法创建报告图片。')
  }

  const width = canvas.width
  const height = canvas.height
  const chartX = 86
  const chartY = 344
  const chartWidth = 1028
  const chartHeight = 240
  const zoneSummary = getHeartRateZoneSummary(report, config)
  const insights = getHeartRateReportInsights(report)
  const markerSamples = getChartMarkerSamples(report, 12)
  const firstSampleAt = report.samples[0]?.timestamp ?? report.startedAt
  const lastSampleAt = report.samples[report.samples.length - 1]?.timestamp ?? report.endedAt
  const timeRange = Math.max(lastSampleAt - firstSampleAt, 1000)
  const minChartBpm = Math.max(30, report.minBpm - 12)
  const maxChartBpm = Math.min(240, report.maxBpm + 12)
  const bpmRange = Math.max(maxChartBpm - minChartBpm, 20)
  const getPoint = (sample: HeartRateRecordSample): { x: number; y: number } => ({
    x: chartX + ((sample.timestamp - firstSampleAt) / timeRange) * chartWidth,
    y: chartY + chartHeight - ((sample.bpm - minChartBpm) / bpmRange) * chartHeight
  })

  context.fillStyle = '#07111f'
  context.fillRect(0, 0, width, height)

  const backgroundGradient = context.createLinearGradient(0, 0, width, height)
  backgroundGradient.addColorStop(0, '#0f1f38')
  backgroundGradient.addColorStop(0.52, '#111827')
  backgroundGradient.addColorStop(1, '#18213a')
  context.fillStyle = backgroundGradient
  context.fillRect(0, 0, width, height)

  context.fillStyle = 'rgba(56, 189, 248, 0.12)'
  context.beginPath()
  context.arc(180, 96, 180, 0, Math.PI * 2)
  context.fill()
  context.fillStyle = 'rgba(251, 113, 133, 0.1)'
  context.beginPath()
  context.arc(1040, 116, 220, 0, Math.PI * 2)
  context.fill()

  context.fillStyle = '#f8fafc'
  context.font = '800 44px Segoe UI, Microsoft YaHei, sans-serif'
  context.fillText('♥ HeartDock 心率记录', 72, 86)
  context.font = '600 18px Segoe UI, Microsoft YaHei, sans-serif'
  context.fillStyle = 'rgba(226, 232, 240, 0.76)'
  context.fillText(`${versionLabel} · ${formatDateTime(report.endedAt)} 导出`, 76, 122)

  const cards = [
    ['记录时长', formatDuration(report.durationMs)],
    ['平均心率', `${report.averageBpm} bpm`],
    ['最高心率', `${report.maxBpm} bpm`],
    ['最低心率', `${report.minBpm} bpm`],
    ['有效样本', `${report.sampleCount} 个`]
  ]

  cards.forEach(([label, value], index) => {
    const cardX = 72 + index * 214
    context.fillStyle = 'rgba(15, 23, 42, 0.62)'
    context.strokeStyle = 'rgba(125, 211, 252, 0.22)'
    context.lineWidth = 1
    context.beginPath()
    context.roundRect(cardX, 168, 184, 104, 22)
    context.fill()
    context.stroke()
    context.fillStyle = 'rgba(203, 213, 225, 0.76)'
    context.font = '600 18px Segoe UI, Microsoft YaHei, sans-serif'
    context.fillText(label, cardX + 20, 205)
    context.fillStyle = '#f8fafc'
    context.font = '800 30px Segoe UI, Microsoft YaHei, sans-serif'
    context.fillText(value, cardX + 20, 246)
  })

  context.fillStyle = 'rgba(2, 6, 23, 0.48)'
  context.strokeStyle = 'rgba(125, 211, 252, 0.22)'
  context.lineWidth = 1
  context.beginPath()
  context.roundRect(72, 312, 1056, 320, 26)
  context.fill()
  context.stroke()

  for (let gridIndex = 0; gridIndex <= 4; gridIndex++) {
    const y = chartY + (chartHeight / 4) * gridIndex
    const labelBpm = Math.round(maxChartBpm - (bpmRange / 4) * gridIndex)

    context.strokeStyle = 'rgba(148, 163, 184, 0.16)'
    context.beginPath()
    context.moveTo(chartX, y)
    context.lineTo(chartX + chartWidth, y)
    context.stroke()
    context.fillStyle = 'rgba(203, 213, 225, 0.62)'
    context.font = '600 14px Segoe UI, Microsoft YaHei, sans-serif'
    context.fillText(`${labelBpm}`, 36, y + 5)
  }

  report.samples.forEach((sample, index) => {
    if (index === 0) {
      return
    }

    const previousPoint = getPoint(report.samples[index - 1])
    const point = getPoint(sample)
    context.strokeStyle = getColorForBpm(sample.bpm, config)
    context.lineWidth = 4
    context.lineCap = 'round'
    context.beginPath()
    context.moveTo(previousPoint.x, previousPoint.y)
    context.lineTo(point.x, point.y)
    context.stroke()
  })

  for (const sample of markerSamples) {
    const point = getPoint(sample)
    const isExtreme =
      (sample.timestamp === report.maxBpmAt && sample.bpm === report.maxBpm) ||
      (sample.timestamp === report.minBpmAt && sample.bpm === report.minBpm)
    context.fillStyle =
      sample.timestamp === report.maxBpmAt && sample.bpm === report.maxBpm
        ? '#fb7185'
        : sample.timestamp === report.minBpmAt && sample.bpm === report.minBpm
          ? '#4ade80'
          : 'rgba(248, 250, 252, 0.72)'
    context.beginPath()
    context.arc(point.x, point.y, isExtreme ? 7 : 4, 0, Math.PI * 2)
    context.fill()
    context.strokeStyle = 'rgba(248, 250, 252, 0.84)'
    context.lineWidth = isExtreme ? 3 : 2
    context.stroke()
  }

  context.fillStyle = 'rgba(226, 232, 240, 0.78)'
  context.font = '600 17px Segoe UI, Microsoft YaHei, sans-serif'
  context.fillText(`记录时间：${formatDateTime(report.startedAt)} - ${formatDateTime(report.endedAt)}`, 86, 662)
  context.fillText(`${insights.trendLabel} · ${insights.trendDetail}`, 86, 692)
  context.fillText(`${insights.stabilityLabel} · ${insights.peakDetail}`, 600, 692)

  context.fillStyle = 'rgba(203, 213, 225, 0.72)'
  context.font = '700 17px Segoe UI, Microsoft YaHei, sans-serif'
  context.fillText('区间分布', 86, 730)

  zoneSummary.forEach((zone, index) => {
    const barX = 86 + index * 330
    const barY = 752
    context.fillStyle = 'rgba(15, 23, 42, 0.72)'
    context.beginPath()
    context.roundRect(barX, barY, 280, 18, 9)
    context.fill()
    context.fillStyle = zone.color
    context.beginPath()
    context.roundRect(barX, barY, Math.max(8, (zone.percent / 100) * 280), 18, 9)
    context.fill()
    context.fillStyle = 'rgba(226, 232, 240, 0.78)'
    context.font = '600 15px Segoe UI, Microsoft YaHei, sans-serif'
    context.fillText(`${zone.label} bpm · ${zone.percent}%`, barX, barY + 42)
  })

  context.fillStyle = 'rgba(148, 163, 184, 0.72)'
  context.font = '600 15px Segoe UI, Microsoft YaHei, sans-serif'
  context.fillText('仅保留本次纯享记录，不写入历史。', 76, 842)
  context.fillText('github.com/HHS3188/heartdock', 890, 842)

  return canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '')
}

function getTimeOffsetLabel(baseTimestamp: number, timestamp: number): string {
  return `+${formatDuration(timestamp - baseTimestamp)}`
}

function isHeartRateReportPayload(value: unknown): value is HeartRateReportWindowPayload {
  return Boolean(value && typeof value === 'object' && 'config' in value && 'generatedAt' in value)
}

function HeartRateReportWindow() {
  const [payload, setPayload] = useState<HeartRateReportWindowPayload | null>(null)
  const [notice, setNotice] = useState('')
  const [isExporting, setIsExporting] = useState(false)

  useEffect(() => {
    let isMounted = true

    void window.heartdock.getHeartRateReportPayload().then((value) => {
      if (isMounted && isHeartRateReportPayload(value)) {
        setPayload(value)
        setNotice(value.notice)
      }
    })

    const unsubscribe = window.heartdock.onHeartRateReportPayloadChanged((value) => {
      if (isHeartRateReportPayload(value)) {
        setPayload(value)
        setNotice(value.notice)
      }
    })

    return () => {
      isMounted = false
      unsubscribe()
    }
  }, [])

  const report = payload?.report ?? null
  const config = payload?.config ?? createDefaultConfig()
  const zones = useMemo(() => (report ? getHeartRateZoneSummary(report, config) : []), [config, report])
  const chart = useMemo(() => {
    if (!report) {
      return null
    }

    const firstSampleAt = report.samples[0]?.timestamp ?? report.startedAt
    const lastSampleAt = report.samples[report.samples.length - 1]?.timestamp ?? report.endedAt
    const timeRange = Math.max(lastSampleAt - firstSampleAt, 1000)
    const minChartBpm = Math.max(30, report.minBpm - 12)
    const maxChartBpm = Math.min(240, report.maxBpm + 12)
    const bpmRange = Math.max(maxChartBpm - minChartBpm, 20)
    const getPoint = (sample: HeartRateRecordSample): { x: number; y: number } => ({
      x: ((sample.timestamp - firstSampleAt) / timeRange) * 1000,
      y: 220 - ((sample.bpm - minChartBpm) / bpmRange) * 220
    })
    const points = report.samples.map(getPoint)
    const pathPoints = points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ')
    const maxPoint = getPoint({ timestamp: report.maxBpmAt, bpm: report.maxBpm })
    const minPoint = getPoint({ timestamp: report.minBpmAt, bpm: report.minBpm })
    const markerPoints = getChartMarkerSamples(report, 12).map((sample) => ({
      ...getPoint(sample),
      key: `${sample.timestamp}-${sample.bpm}`,
      isMax: sample.timestamp === report.maxBpmAt && sample.bpm === report.maxBpm,
      isMin: sample.timestamp === report.minBpmAt && sample.bpm === report.minBpm
    }))

    return { pathPoints, maxPoint, minPoint, markerPoints }
  }, [report])
  const insights = useMemo(() => (report ? getHeartRateReportInsights(report) : null), [report])

  const handleExportPng = async (): Promise<void> => {
    if (!report || !payload) {
      return
    }

    setIsExporting(true)

    try {
      const contentBase64 = createHeartRateReportPngBase64(report, config, payload.versionLabel)
      const defaultFileName = `heartdock-heart-rate-${getTimestampFilePart(report.endedAt)}.png`
      const result = await window.heartdock.saveHeartRateReportPng(contentBase64, defaultFileName)

      setNotice(result ? `已导出 PNG 报告：${result.fileName}` : '已取消导出 PNG，当前报告仍保留。')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '导出 PNG 报告失败。')
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <main className="report-window-shell">
      <section className="heart-rate-report-panel report-window-panel">
        <div className="report-heading">
          <span>纯享心率记录</span>
          <button
            className="icon-button"
            type="button"
            aria-label="关闭心率报告"
            title="关闭心率报告"
            onClick={() => void window.heartdock.closeHeartRateReportWindow()}
          >
            ×
          </button>
        </div>

        {report ? (
          <>
            <div className="report-summary-grid">
              <div>
                <span>记录时长</span>
                <strong>{formatDuration(report.durationMs)}</strong>
              </div>
              <div>
                <span>平均心率</span>
                <strong>{report.averageBpm} bpm</strong>
              </div>
              <div>
                <span>最高 / 最低</span>
                <strong>
                  {report.maxBpm} / {report.minBpm}
                </strong>
              </div>
              <div>
                <span>有效样本</span>
                <strong>{report.sampleCount} 个</strong>
              </div>
              <div>
                <span>心率波动</span>
                <strong>{report.maxBpm - report.minBpm} bpm</strong>
              </div>
              <div>
                <span>报告版本</span>
                <strong>{payload?.versionLabel ?? HEART_RATE_REPORT_VERSION_LABEL}</strong>
              </div>
            </div>

            <div className="report-chart" aria-label="本次纯享心率时间线">
              {chart && (
                <svg viewBox="0 0 1000 220" role="img">
                  <polyline className="report-chart-grid-line" points="0,55 1000,55" />
                  <polyline className="report-chart-grid-line" points="0,110 1000,110" />
                  <polyline className="report-chart-grid-line" points="0,165 1000,165" />
                  <polyline className="report-chart-line" points={chart.pathPoints} />
                  {chart.markerPoints.map((point) => (
                    <circle
                      className={`report-chart-marker ${point.isMax ? 'is-max' : ''} ${
                        point.isMin ? 'is-min' : ''
                      }`}
                      key={point.key}
                      cx={point.x}
                      cy={point.y}
                      r={point.isMax || point.isMin ? 7 : 4}
                    />
                  ))}
                </svg>
              )}
            </div>

            {insights && (
              <div className="report-insight-grid">
                <div className="report-insight-card is-trend">
                  <span>趋势</span>
                  <strong>{insights.trendLabel}</strong>
                  <small>{insights.trendDetail}</small>
                </div>
                <div className="report-insight-card is-stability">
                  <span>稳定度</span>
                  <strong>{insights.stabilityLabel}</strong>
                  <small>{insights.stabilityDetail}</small>
                </div>
                <div className="report-insight-card is-density">
                  <span>采样</span>
                  <strong>{insights.densityLabel}</strong>
                  <small>{insights.densityDetail}</small>
                </div>
              </div>
            )}

            <div className="report-detail-grid">
              <p className="report-meta">
                <span>记录时间</span>
                <strong>
                  {formatDateTime(report.startedAt)} - {formatDateTime(report.endedAt)}
                </strong>
              </p>
              <p className="report-meta">
                <span>峰值位置</span>
                <strong>{insights?.peakDetail}</strong>
              </p>
            </div>

            <div className="report-zone-panel">
              <span>区间分布</span>
              {zones.map((zone) => (
                <div className="report-zone-row" key={zone.label}>
                  <small>{zone.label} bpm</small>
                  <div className="report-zone-track">
                    <span
                      style={{
                        width: `${Math.max(zone.percent, zone.count > 0 ? 4 : 0)}%`,
                        backgroundColor: zone.color
                      }}
                    />
                  </div>
                  <strong>{zone.percent}%</strong>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="report-empty-message">{notice || '暂无可显示的心率记录。'}</p>
        )}

        {notice && report && <p className="report-status-message">{notice}</p>}

        <div className="report-actions">
          {report && (
            <button
              className="secondary-button"
              type="button"
              disabled={isExporting}
              onClick={() => void handleExportPng()}
            >
              {isExporting ? '正在导出...' : '导出 PNG'}
            </button>
          )}
          <button
            className="reset-button"
            type="button"
            onClick={() => void window.heartdock.closeHeartRateReportWindow()}
          >
            关闭报告
          </button>
        </div>
      </section>
    </main>
  )
}

function App() {
  if (new URLSearchParams(window.location.search).get('view') === 'heart-rate-report') {
    return <HeartRateReportWindow />
  }

  const initialConfigRef = useRef<HeartDockConfig | null>(null)

  if (initialConfigRef.current === null) {
    const loadedConfig = loadConfig()

    initialConfigRef.current = {
      ...loadedConfig,
      showSettings: true,
      pureDisplay: false,
      clickThrough: false
    }
  }

  const sourceRef = useRef(new MockHeartRateSource())
  const sourceModeRef = useRef<HeartRateSourceMode>(initialConfigRef.current.heartRateSourceMode)
  const bleDeviceRef = useRef<BleDevice | null>(null)
  const bleCharacteristicRef = useRef<BleCharacteristic | null>(null)
  const isManualBleDisconnectRef = useRef(false)
  const pureHeartRef = useRef<HTMLDivElement | null>(null)
  const overlayCardRef = useRef<HTMLElement | null>(null)
  const firstRunNoticeCardRef = useRef<HTMLElement | null>(null)
  const normalWindowBoundsRef = useRef<HeartDockWindowBounds | null>(null)
  const pureDragStateRef = useRef({
    isDragging: false,
    lastScreenX: 0,
    lastScreenY: 0,
    totalDeltaX: 0,
    totalDeltaY: 0,
    animationFrameId: 0,
    pendingDeltaX: 0,
    pendingDeltaY: 0
  })
  const heartRateRecordSessionRef = useRef<{
    startedAt: number
    samples: HeartRateRecordSample[]
    lastRecordedAt: number
  } | null>(null)
  const heartRateRecordIntervalRef = useRef<number | null>(null)
  const latestBpmRef = useRef(normalizeBpm(initialConfigRef.current?.manualBpm ?? 78))
  const latestRecordableBpmRef = useRef(true)
  const lastScenePresetUndoRef = useRef<HeartDockConfig | null>(null)

  const pureDragMovedRef = useRef(false)
  const onboardingPreviousWindowBoundsRef = useRef<HeartDockWindowBounds | null>(null)
  const interactionLockNoticeTimerRef = useRef<number | null>(null)
  const windowResizeStateRef = useRef({
    isResizing: false,
    startScreenX: 0,
    startScreenY: 0,
    startBounds: null as HeartDockWindowBounds | null,
    animationFrameId: 0,
    pendingBounds: null as HeartDockWindowBounds | null,
    lastAppliedAt: 0
  })

  const [bpm, setBpm] = useState(() => normalizeBpm(initialConfigRef.current?.manualBpm ?? 78))
  const [config, setConfig] = useState<HeartDockConfig>(() => initialConfigRef.current ?? loadConfig())
  const configRef = useRef(config)
  configRef.current = config
  const [isInteractionLockNoticeVisible, setIsInteractionLockNoticeVisible] = useState(false)
  const [isClosing, setIsClosing] = useState(false)
  const [isWindowResizing, setIsWindowResizing] = useState(false)
  const [appearanceMode, setAppearanceMode] = useState<AppearanceMode>(() =>
    localStorage.getItem(APPEARANCE_MODE_KEY) === 'light' ? 'light' : 'dark'
  )
  const [shouldShowFirstRunNotice, setShouldShowFirstRunNotice] = useState(true)
  const [firstRunNoticeMode, setFirstRunNoticeMode] = useState<FirstRunNoticeMode>(() =>
    localStorage.getItem(FIRST_RUN_NOTICE_KEY) === 'accepted' ? 'splash' : 'required'
  )
  const [isFirstRunNoticeLeaving, setIsFirstRunNoticeLeaving] = useState(false)
  const [firstRunNoticeSecondsLeft, setFirstRunNoticeSecondsLeft] = useState(() =>
    localStorage.getItem(FIRST_RUN_NOTICE_KEY) === 'accepted' ? 0 : FIRST_RUN_NOTICE_SECONDS
  )
  const [firstRunNoticeAccepted, setFirstRunNoticeAccepted] = useState(false)
  const [isBootSplashVisible, setIsBootSplashVisible] = useState(true)
  const [startupGateSecondsLeft, setStartupGateSecondsLeft] = useState(STARTUP_UPDATE_GATE_SECONDS)
  const [isStartupGateReady, setIsStartupGateReady] = useState(false)
  const [updateSummary, setUpdateSummary] = useState<UpdateSummary>(defaultUpdateSummary)
  const [isUpdateDialogDismissed, setIsUpdateDialogDismissed] = useState(false)
  const [isManualUpdateCheck, setIsManualUpdateCheck] = useState(false)
  const [isManualUpdateDialogOpen, setIsManualUpdateDialogOpen] = useState(false)
  const [settingsNotice, setSettingsNotice] = useState('')
  const [isOnboardingActive, setIsOnboardingActive] = useState(false)
  const [onboardingStepIndex, setOnboardingStepIndex] = useState(0)
  const [onboardingRect, setOnboardingRect] = useState<OnboardingRect | null>(null)
  const [manualInput, setManualInput] = useState(() =>
    String(normalizeBpm(initialConfigRef.current?.manualBpm ?? 78))
  )
  const [refreshIntervalInput, setRefreshIntervalInput] = useState(() =>
    String(normalizeRefreshIntervalMs(initialConfigRef.current?.refreshIntervalMs ?? 1000))
  )
  const [bleStatus, setBleStatus] = useState<BleConnectionStatus>('idle')
  const [bleDeviceName, setBleDeviceName] = useState('')
  const [hasBleReconnectDevice, setHasBleReconnectDevice] = useState(false)
  const [bleMessage, setBleMessage] = useState(
    '尚未连接 BLE 心率设备。请先开启 Windows 蓝牙，并确保心率设备正在广播标准心率服务。连接前心率将显示为 -- bpm。'
  )
  const [canUndoScenePreset, setCanUndoScenePreset] = useState(false)
  const [selectedScenePresetId, setSelectedScenePresetId] = useState<ScenePresetId>(
    initialConfigRef.current?.lastAppliedScenePreset || 'stream-overlay'
  )
  const [scenePresetToConfirm, setScenePresetToConfirm] = useState<ScenePreset | null>(null)
  const [isScenePresetModalClosing, setIsScenePresetModalClosing] = useState(false)
  const [isResetConfigConfirmOpen, setIsResetConfigConfirmOpen] = useState(false)
  const [isResetConfigConfirmClosing, setIsResetConfigConfirmClosing] = useState(false)
  const [bpmPulseKey, setBpmPulseKey] = useState(0)
  const [heartRateRecordReport, setHeartRateRecordReport] =
    useState<HeartRateRecordSummary | null>(null)
  const [heartRateRecordNotice, setHeartRateRecordNotice] = useState('')
  const [isExportingHeartRateReport, setIsExportingHeartRateReport] = useState(false)
  const [isHeartRateReportClosing, setIsHeartRateReportClosing] = useState(false)
  const [floatingHelpTooltip, setFloatingHelpTooltip] = useState<FloatingHelpTooltip | null>(null)

  const [openColorRuleIndexes, setOpenColorRuleIndexes] = useState<number[]>([])

  const [openSelectId, setOpenSelectId] = useState<string | null>(null)

  const shouldShowBlePlaceholder =
    config.heartRateSourceMode === 'ble' && bleStatus !== 'connected'
  latestBpmRef.current = bpm
  latestRecordableBpmRef.current = !shouldShowBlePlaceholder

  const displayBpm = shouldShowBlePlaceholder ? '--' : String(bpm)

  const bpmColor = useMemo(
    () => (shouldShowBlePlaceholder ? '#94a3b8' : getColorForBpm(bpm, config)),
    [bpm, config, shouldShowBlePlaceholder]
  )
  const isPureDisplay = config.pureDisplay
  const displayGlowClass = `glow-${config.glowLevel}`
  const hasDisplayBackgroundImage = false
  const effectiveDisplayStylePreset =
    config.displayStylePreset === 'image-card' ? 'none' : config.displayStylePreset
  const hasDisplayFrame = effectiveDisplayStylePreset !== 'none'
  const displayStylePresetClass = `display-style-${effectiveDisplayStylePreset}`
  const displayBackgroundFitClass = `display-background-fit-${config.displayBackgroundImageFit}`
  const isHighHeartRateAlertActive =
    config.highHeartRateAlertEnabled &&
    !shouldShowBlePlaceholder &&
    bpm >= config.highHeartRateAlertThreshold
  const isLowHeartRateBreathActive =
    config.lowHeartRateBreathEnabled &&
    !shouldShowBlePlaceholder &&
    bpm <= (config.colorRules[0]?.max ?? 90)
  const displayEffectClass = [
    config.heartbeatPulseEnabled ? 'effect-heartbeat-pulse' : '',
    config.smoothColorTransitionEnabled ? 'effect-smooth-color' : '',
    isLowHeartRateBreathActive ? 'effect-low-breath' : ''
  ]
    .filter(Boolean)
    .join(' ')
  const shouldProducePureDisplayReport =
    config.heartRateRecordingEnabled ||
    (config.heartRateSourceMode === 'ble' && bleStatus === 'connected')
  const displayFrameStateClass = isHighHeartRateAlertActive ? 'is-high-heart-rate-alert' : ''
  const firstRunNoticeTotalSeconds =
    firstRunNoticeMode === 'required' ? FIRST_RUN_NOTICE_SECONDS : 0
  const firstRunNoticeProgress =
    firstRunNoticeTotalSeconds <= 0
      ? 100
      : ((firstRunNoticeTotalSeconds - firstRunNoticeSecondsLeft) / firstRunNoticeTotalSeconds) * 100
  const isUpdateBlocking =
    updateSummary.status === 'checking' ||
    updateSummary.status === 'downloading' ||
    (updateSummary.isMajorUpdate &&
      (updateSummary.status === 'available' || updateSummary.status === 'downloaded'))
  const canEnterFromStartup = isStartupGateReady && !isUpdateBlocking
  const hasActionableUpdate =
    updateSummary.status === 'available' ||
    updateSummary.status === 'downloading' ||
    updateSummary.status === 'downloaded'
  const shouldShowUpdateDialog =
    (!isUpdateDialogDismissed && hasActionableUpdate) || isManualUpdateDialogOpen
  const isUpdateCheckStatusDialog = isManualUpdateDialogOpen && !hasActionableUpdate
  const updateDialogLatestVersion =
    updateSummary.latestVersion ||
    (updateSummary.status === 'not-available' ? updateSummary.currentVersion : '-')
  const currentOnboardingStep = onboardingSteps[onboardingStepIndex] ?? onboardingSteps[0]
  const heartRateReportChart = useMemo(() => {
    const report = heartRateRecordReport

    if (!report) {
      return null
    }

    const firstSampleAt = report.samples[0]?.timestamp ?? report.startedAt
    const lastSampleAt = report.samples[report.samples.length - 1]?.timestamp ?? report.endedAt
    const timeRange = Math.max(lastSampleAt - firstSampleAt, 1000)
    const minChartBpm = Math.max(30, report.minBpm - 12)
    const maxChartBpm = Math.min(240, report.maxBpm + 12)
    const bpmRange = Math.max(maxChartBpm - minChartBpm, 20)
    const getPoint = (sample: HeartRateRecordSample): { x: number; y: number } => ({
      x: ((sample.timestamp - firstSampleAt) / timeRange) * 1000,
      y: 220 - ((sample.bpm - minChartBpm) / bpmRange) * 220
    })
    const points = report.samples.map(getPoint)
    const pathPoints = points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ')
    const maxPoint = getPoint({ timestamp: report.maxBpmAt, bpm: report.maxBpm })
    const minPoint = getPoint({ timestamp: report.minBpmAt, bpm: report.minBpm })
    const markerPoints = getChartMarkerSamples(report, 12).map((sample) => ({
      ...getPoint(sample),
      key: `${sample.timestamp}-${sample.bpm}`,
      isMax: sample.timestamp === report.maxBpmAt && sample.bpm === report.maxBpm,
      isMin: sample.timestamp === report.minBpmAt && sample.bpm === report.minBpm
    }))

    return { pathPoints, maxPoint, minPoint, markerPoints }
  }, [heartRateRecordReport])
  const heartRateReportZones = useMemo(
    () => (heartRateRecordReport ? getHeartRateZoneSummary(heartRateRecordReport, config) : []),
    [config, heartRateRecordReport]
  )
  const heartRateReportInsights = useMemo(
    () => (heartRateRecordReport ? getHeartRateReportInsights(heartRateRecordReport) : null),
    [heartRateRecordReport]
  )

  const recordCurrentBpmSample = useCallback((): void => {
    const session = heartRateRecordSessionRef.current

    if (!session || !latestRecordableBpmRef.current) {
      return
    }

    const now = Date.now()

    if (now - session.lastRecordedAt < 250) {
      return
    }

    session.samples.push({
      timestamp: now,
      bpm: normalizeBpm(latestBpmRef.current)
    })
    session.lastRecordedAt = now
  }, [])

  const stopHeartRateRecording = useCallback((showResult: boolean): void => {
    const session = heartRateRecordSessionRef.current

    if (!session) {
      return
    }

    if (heartRateRecordIntervalRef.current !== null) {
      window.clearInterval(heartRateRecordIntervalRef.current)
      heartRateRecordIntervalRef.current = null
    }

    recordCurrentBpmSample()

    const endedAt = Date.now()
    const summary = buildHeartRateRecordSummary(session.startedAt, endedAt, session.samples)
    heartRateRecordSessionRef.current = null

    if (!showResult) {
      return
    }

    const openReportWindow = (report: HeartRateRecordSummary | null, notice: string): void => {
      void window.heartdock.openHeartRateReportWindow({
        report,
        notice,
        config: configRef.current,
        versionLabel: HEART_RATE_REPORT_VERSION_LABEL,
        generatedAt: Date.now()
      })
    }

    if (!summary) {
      setHeartRateRecordReport(null)
      setHeartRateRecordNotice('')
      return
    }

    setHeartRateRecordNotice('')
    setHeartRateRecordReport(null)
    openReportWindow(summary, '')
  }, [recordCurrentBpmSample])

  const startHeartRateRecording = useCallback((): void => {
    if (heartRateRecordSessionRef.current) {
      return
    }

    const startedAt = Date.now()
    heartRateRecordSessionRef.current = {
      startedAt,
      samples: [],
      lastRecordedAt: 0
    }
    setHeartRateRecordReport(null)
    setHeartRateRecordNotice('')
    recordCurrentBpmSample()

    heartRateRecordIntervalRef.current = window.setInterval(() => {
      recordCurrentBpmSample()
    }, 1000)
  }, [recordCurrentBpmSample])

  const beginOnboardingTour = useCallback((): void => {
    setConfig((current) => ({
      ...current,
      pureDisplay: false,
      showSettings: true
    }))

    void window.heartdock.setPureDisplayTopmost(false)
    void window.heartdock.setHitTestPassthrough(false)

    void window.heartdock.getWindowBounds().then((bounds) => {
      if (!bounds) {
        return
      }

      if (!onboardingPreviousWindowBoundsRef.current) {
        onboardingPreviousWindowBoundsRef.current = bounds
      }

      const width = ONBOARDING_WINDOW_SIZE.width
      const height = ONBOARDING_WINDOW_SIZE.height

      void window.heartdock.setWindowBounds({
        width,
        height,
        x: Math.round(bounds.x + bounds.width / 2 - width / 2),
        y: Math.round(bounds.y + bounds.height / 2 - height / 2)
      })
    })

    setOnboardingStepIndex(0)
    setIsOnboardingActive(true)
  }, [])

  const restoreOnboardingWindowBounds = useCallback((): void => {
    const previousBounds = onboardingPreviousWindowBoundsRef.current
    onboardingPreviousWindowBoundsRef.current = null

    if (previousBounds) {
      void window.heartdock.setWindowBounds(previousBounds)
    }
  }, [])

  useEffect(() => {
    sourceModeRef.current = config.heartRateSourceMode
  }, [config.heartRateSourceMode])

  useEffect(() => {
    setBpmPulseKey((current) => current + 1)
    recordCurrentBpmSample()
  }, [bpm, recordCurrentBpmSample])

  useEffect(() => {
    if (config.pureDisplay && shouldProducePureDisplayReport) {
      startHeartRateRecording()
      return
    }

    if (heartRateRecordSessionRef.current) {
      stopHeartRateRecording(shouldProducePureDisplayReport)
    }
  }, [
    shouldProducePureDisplayReport,
    config.heartRateRecordingEnabled,
    config.pureDisplay,
    startHeartRateRecording,
    stopHeartRateRecording
  ])

  useEffect(() => {
    return () => {
      if (heartRateRecordIntervalRef.current !== null) {
        window.clearInterval(heartRateRecordIntervalRef.current)
        heartRateRecordIntervalRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (!shouldShowFirstRunNotice) {
      return
    }

    void window.heartdock.showStartupView()
  }, [shouldShowFirstRunNotice])

  useEffect(() => {
    if (!shouldShowFirstRunNotice) {
      return
    }

    setIsFirstRunNoticeLeaving(false)
    setFirstRunNoticeAccepted(false)

    if (firstRunNoticeMode !== 'required') {
      setFirstRunNoticeSecondsLeft(0)
      return
    }

    const startedAt = Date.now()
    setFirstRunNoticeSecondsLeft(FIRST_RUN_NOTICE_SECONDS)

    const updateSecondsLeft = (): void => {
      const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000)
      const nextSecondsLeft = Math.max(0, FIRST_RUN_NOTICE_SECONDS - elapsedSeconds)
      setFirstRunNoticeSecondsLeft(nextSecondsLeft)
    }

    updateSecondsLeft()
    const timer = window.setInterval(updateSecondsLeft, 200)

    return () => {
      window.clearInterval(timer)
    }
  }, [firstRunNoticeMode, shouldShowFirstRunNotice])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setIsBootSplashVisible(false)
    }, 2800)

    return () => {
      window.clearTimeout(timer)
    }
  }, [])

  useEffect(() => {
    const unsubscribe = window.heartdock.onUpdateStatusChanged((summary) => {
      setUpdateSummary(summary)
      setIsManualUpdateCheck(false)
    })

    void window.heartdock.getUpdateStatus().then(setUpdateSummary)

    return unsubscribe
  }, [])

  useEffect(() => {
    if (!shouldShowFirstRunNotice) {
      return
    }

    setIsStartupGateReady(false)
    setStartupGateSecondsLeft(STARTUP_UPDATE_GATE_SECONDS)
    setIsUpdateDialogDismissed(false)

    const startedAt = Date.now()
    const timer = window.setInterval(() => {
      const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000)
      const nextSecondsLeft = Math.max(0, STARTUP_UPDATE_GATE_SECONDS - elapsedSeconds)
      setStartupGateSecondsLeft(nextSecondsLeft)

      if (nextSecondsLeft === 0) {
        setIsStartupGateReady(true)
      }
    }, 200)

    void window.heartdock.checkForUpdates().catch((error) => {
      setUpdateSummary({
        ...defaultUpdateSummary,
        status: 'error',
        message: error instanceof Error ? error.message : '检查更新失败。'
      })
    })

    return () => {
      window.clearInterval(timer)
    }
  }, [shouldShowFirstRunNotice])

  useEffect(() => {
    if (shouldShowFirstRunNotice || isPureDisplay || localStorage.getItem(ONBOARDING_TOUR_KEY) === 'completed') {
      return
    }

    const timer = window.setTimeout(() => {
      beginOnboardingTour()
    }, 420)

    return () => {
      window.clearTimeout(timer)
    }
  }, [beginOnboardingTour, isPureDisplay, shouldShowFirstRunNotice])

  useEffect(() => {
    if (!isOnboardingActive) {
      setOnboardingRect(null)
      return
    }

    let scrollTimer: number | null = null
    let settleTimer: number | null = null
    let finalSettleTimer: number | null = null

    const updateRect = (): void => {
      const element = document.querySelector<HTMLElement>(
        `[data-tour-id="${currentOnboardingStep.targetId}"]`
      )

      if (!element) {
        setOnboardingRect(null)
        return
      }

      const rect = element.getBoundingClientRect()
      setOnboardingRect({
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height
      })
    }

    const scrollTargetIntoView = (): void => {
      const element = document.querySelector<HTMLElement>(
        `[data-tour-id="${currentOnboardingStep.targetId}"]`
      )

      if (!element) {
        setOnboardingRect(null)
        return
      }

      const settingsPanel = element.closest<HTMLElement>('.settings-panel')

      if (settingsPanel) {
        const panelRect = settingsPanel.getBoundingClientRect()
        const elementRect = element.getBoundingClientRect()
        const desiredTop =
          settingsPanel.scrollTop +
          elementRect.top -
          panelRect.top -
          Math.max(24, (settingsPanel.clientHeight - elementRect.height) / 2)

        settingsPanel.scrollTo({
          top: Math.max(0, desiredTop),
          behavior: 'smooth'
        })
      } else {
        element.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
          inline: 'nearest'
        })
      }

      window.scrollTo(0, 0)
      updateRect()

      settleTimer = window.setTimeout(updateRect, 220)
      finalSettleTimer = window.setTimeout(updateRect, 560)
    }

    scrollTimer = window.setTimeout(scrollTargetIntoView, 90)
    window.addEventListener('resize', updateRect)
    window.addEventListener('scroll', updateRect, true)

    return () => {
      if (scrollTimer !== null) {
        window.clearTimeout(scrollTimer)
      }
      if (settleTimer !== null) {
        window.clearTimeout(settleTimer)
      }
      if (finalSettleTimer !== null) {
        window.clearTimeout(finalSettleTimer)
      }
      window.removeEventListener('resize', updateRect)
      window.removeEventListener('scroll', updateRect, true)
    }
  }, [currentOnboardingStep.targetId, isOnboardingActive])

  useEffect(() => {
    saveConfig(config)
  }, [config])

  useEffect(() => {
    setManualInput(String(normalizeBpm(config.manualBpm)))
  }, [config.manualBpm])

  useEffect(() => {
    setRefreshIntervalInput(String(normalizeRefreshIntervalMs(config.refreshIntervalMs)))
  }, [config.refreshIntervalMs])

  useEffect(() => {
    window.heartdock.setAlwaysOnTop(config.alwaysOnTop)
  }, [config.alwaysOnTop])

  useEffect(() => {
    void window.heartdock.setPureDisplayTopmost(config.pureDisplay && config.alwaysOnTop)

    return () => {
      void window.heartdock.setPureDisplayTopmost(false)
    }
  }, [config.alwaysOnTop, config.pureDisplay])

  useEffect(() => {
    window.heartdock.setClickThrough(config.clickThrough)
  }, [config.clickThrough])

  useEffect(() => {
    const needsTransparentAreaPassthrough =
      isBootSplashVisible || shouldShowFirstRunNotice || config.clickThrough || config.pureDisplay

    if (!needsTransparentAreaPassthrough) {
      void window.heartdock.setHitTestPassthrough(false)
      return
    }

    let lastSentPassthrough: boolean | null = null

    const applyPassthrough = (enabled: boolean): void => {
      if (enabled === lastSentPassthrough) {
        return
      }
      lastSentPassthrough = enabled
      void window.heartdock.setHitTestPassthrough(enabled)
    }

    const getActiveHitRect = (): DOMRect | null => {
      if (isBootSplashVisible) {
        return null
      }

      if (shouldShowFirstRunNotice) {
        return firstRunNoticeCardRef.current?.getBoundingClientRect() ?? null
      }

      if (config.pureDisplay) {
        return pureHeartRef.current?.getBoundingClientRect() ?? null
      }

      if (config.clickThrough) {
        return overlayCardRef.current?.getBoundingClientRect() ?? null
      }

      return null
    }

    const updateHitTest = (event: MouseEvent): void => {
      const rect = getActiveHitRect()

      if (!rect) {
        applyPassthrough(true)
        return
      }

      const isInsideVisibleArea =
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom

      applyPassthrough(!isInsideVisibleArea)
    }

    const handleWindowMouseLeave = (): void => {
      applyPassthrough(true)
    }

    applyPassthrough(true)
    window.addEventListener('mousemove', updateHitTest)
    window.addEventListener('mouseleave', handleWindowMouseLeave)

    return () => {
      window.removeEventListener('mousemove', updateHitTest)
      window.removeEventListener('mouseleave', handleWindowMouseLeave)
      void window.heartdock.setHitTestPassthrough(false)
    }
  }, [config.clickThrough, config.pureDisplay, isBootSplashVisible, shouldShowFirstRunNotice])

  useEffect(() => {
    const unsubscribe = window.heartdock.onClickThroughChanged((enabled) => {
      setConfig((current) => ({ ...current, clickThrough: enabled }))
    })

    return unsubscribe
  }, [])

  useEffect(() => {
    return () => {
      if (interactionLockNoticeTimerRef.current !== null) {
        window.clearTimeout(interactionLockNoticeTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (config.heartRateSourceMode === 'manual') {
      setBpm(normalizeBpm(config.manualBpm))
      return
    }

    if (config.heartRateSourceMode === 'ble') {
      return
    }

    if (config.mockPaused) {
      return
    }

    const safeRefreshIntervalMs = normalizeRefreshIntervalMs(config.refreshIntervalMs)

    setBpm(sourceRef.current.next())

    const timer = window.setInterval(() => {
      setBpm(sourceRef.current.next())
    }, safeRefreshIntervalMs)

    return () => window.clearInterval(timer)
  }, [config.heartRateSourceMode, config.manualBpm, config.mockPaused, config.refreshIntervalMs])

  const updateConfig = <K extends keyof HeartDockConfig>(key: K, value: HeartDockConfig[K]): void => {
    setConfig((current) => ({ ...current, [key]: value }))
  }

  const applyScenePreset = (preset: ScenePreset): void => {
    lastScenePresetUndoRef.current = configRef.current
    setCanUndoScenePreset(true)
    setConfig((current) => ({
      ...current,
      ...preset.config,
      displayBackgroundImageEnabled: false,
      lastAppliedScenePreset: preset.id,
      pureDisplay: current.pureDisplay,
      showSettings: current.showSettings,
      clickThrough: current.clickThrough,
      heartRateSourceMode: current.heartRateSourceMode,
      mockPaused: current.mockPaused,
      manualBpm: current.manualBpm,
      refreshIntervalMs: current.refreshIntervalMs
    }))
  }

  const handleOpenScenePresetConfirm = (): void => {
    const preset = scenePresets.find((item) => item.id === selectedScenePresetId) ?? scenePresets[0]

    setScenePresetToConfirm(preset)
    setIsScenePresetModalClosing(false)
  }

  const handleCloseScenePresetConfirm = (): void => {
    setIsScenePresetModalClosing(true)

    window.setTimeout(() => {
      setScenePresetToConfirm(null)
      setIsScenePresetModalClosing(false)
    }, 180)
  }

  const handleConfirmScenePreset = (): void => {
    if (!scenePresetToConfirm) {
      return
    }

    applyScenePreset(scenePresetToConfirm)
    handleCloseScenePresetConfirm()
  }

  const handleUndoScenePreset = (): void => {
    const previousConfig = lastScenePresetUndoRef.current

    if (!previousConfig) {
      return
    }

    setConfig((current) => ({
      ...previousConfig,
      pureDisplay: current.pureDisplay,
      showSettings: current.showSettings,
      clickThrough: current.clickThrough
    }))
    lastScenePresetUndoRef.current = null
    setCanUndoScenePreset(false)
  }

  const handlePrefixTextChange = (value: string): void => {
    updateConfig('prefixText', normalizeDisplayText(value, '', 8))
  }

  const handleUnitTextChange = (value: string): void => {
    updateConfig('unitText', normalizeDisplayText(value, '', 8))
  }

  const handleFixedColorChange = (value: string): void => {
    updateConfig('fixedColor', normalizeColor(value, config.fixedColor))
  }

  const handleColorRuleColorChange = (index: number, color: string): void => {
    setConfig((current) => ({
      ...current,
      colorRules: current.colorRules.map((rule, ruleIndex) =>
        ruleIndex === index ? { ...rule, color: normalizeColor(color, rule.color) } : rule
      )
    }))
  }

  const handleColorRuleToggle = (index: number, isOpen: boolean): void => {
    setOpenColorRuleIndexes((current) => {
      if (isOpen) {
        return current.includes(index) ? current : [...current, index]
      }

      return current.filter((item) => item !== index)
    })
  }

  const updateColorRuleRange = (
    index: number,
    key: 'min' | 'max',
    rawValue: number
  ): void => {
    if (!Number.isFinite(rawValue)) {
      return
    }

    setConfig((current) => {
      const nextRules = current.colorRules.map((rule) => ({ ...rule }))
      const currentRule = nextRules[index]

      if (!currentRule) {
        return current
      }

      const nextValue = clampColorRuleValue(rawValue)

      if (key === 'max') {
        const remainingRuleCount = nextRules.length - index - 1
        const maxLimit = 240 - remainingRuleCount

        currentRule.max = clampNumber(nextValue, currentRule.min, maxLimit)

        for (let ruleIndex = index + 1; ruleIndex < nextRules.length; ruleIndex++) {
          const previousRule = nextRules[ruleIndex - 1]
          const rule = nextRules[ruleIndex]
          const remainingAfterThisRule = nextRules.length - ruleIndex - 1
          const maxForThisRule = 240 - remainingAfterThisRule

          rule.min = clampNumber(previousRule.max + 1, 30, maxForThisRule)
          rule.max = clampNumber(Math.max(rule.max, rule.min), rule.min, maxForThisRule)
        }
      } else {
        const previousRuleCount = index
        const minLimit = 30 + previousRuleCount

        currentRule.min = clampNumber(nextValue, minLimit, currentRule.max)

        for (let ruleIndex = index - 1; ruleIndex >= 0; ruleIndex--) {
          const nextRule = nextRules[ruleIndex + 1]
          const rule = nextRules[ruleIndex]
          const minForThisRule = 30 + ruleIndex

          rule.max = clampNumber(nextRule.min - 1, minForThisRule, 240)
          rule.min = clampNumber(Math.min(rule.min, rule.max), minForThisRule, rule.max)
        }
      }

      return {
        ...current,
        colorRules: nextRules
      }
    })
  }

  const handleColorRuleRangeChange = (
    index: number,
    key: 'min' | 'max',
    value: string
  ): void => {
    if (!value.trim()) {
      return
    }

    updateColorRuleRange(index, key, Number(value))
  }

  const handleColorRuleRangeStep = (index: number, key: 'min' | 'max', delta: number): void => {
    const rule = config.colorRules[index]

    if (!rule) {
      return
    }

    const currentValue = key === 'min' ? rule.min : rule.max
    updateColorRuleRange(index, key, currentValue + delta)
  }

  const renderCustomSelect = <T extends string>(
    id: string,
    value: T,
    options: Array<SelectOption<T>>,
    onChange: (value: T) => void,
    ariaLabel: string
  ) => {
    const selectedOption = options.find((option) => option.value === value) ?? options[0]
    const isOpen = openSelectId === id

    return (
      <div className={`custom-select ${isOpen ? 'is-open' : ''}`} onClick={(event) => event.stopPropagation()}>
        <button
          className="custom-select-trigger"
          type="button"
          aria-label={ariaLabel}
          aria-expanded={isOpen}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            setOpenSelectId((current) => (current === id ? null : id))
          }}
        >
          <span className="custom-select-value">{selectedOption.label}</span>
          <span className="custom-select-chevron" aria-hidden="true">
            ▾
          </span>
        </button>

        <div className="custom-select-menu" role="listbox" aria-hidden={!isOpen}>
          {options.map((option) => (
            <button
              key={option.value}
              className={`custom-select-option ${option.value === value ? 'is-selected' : ''}`}
              type="button"
              role="option"
              tabIndex={isOpen ? 0 : -1}
              aria-selected={option.value === value}
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                onChange(option.value)
                setOpenSelectId(null)
              }}
            >
              <span>{option.label}</span>
              {option.description && <small>{option.description}</small>}
            </button>
          ))}
        </div>
      </div>
    )
  }

  const renderRangeControl = (
    value: number,
    onInputChange: (value: string) => void,
    onStep: (delta: number) => void,
    ariaLabel: string
  ) => (
    <div className="range-field" aria-label={ariaLabel} onClick={(event) => event.stopPropagation()}>
      <input
        className="range-value-input"
        type="text"
        inputMode="numeric"
        value={value}
        onPointerDown={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
        onChange={(event) => {
          const nextValue = event.target.value.trim()

          if (/^\d{0,3}$/.test(nextValue)) {
            onInputChange(nextValue)
          }
        }}
        onBlur={(event) => onInputChange(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.currentTarget.blur()
          }
        }}
      />

      <div className="range-action-row">
        <button
          className="range-action-button"
          type="button"
          aria-label="减少 1"
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onStep(-1)
          }}
        >
          −1
        </button>

        <button
          className="range-action-button"
          type="button"
          aria-label="增加 1"
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onStep(1)
          }}
        >
          +1
        </button>
      </div>
    </div>
  )

  const renderColorControl = (
    color: string,
    onChange: (color: string) => void,
    ariaLabel: string
  ) => (
    <div className="custom-color-control" aria-label={ariaLabel} onClick={(event) => event.stopPropagation()}>
      <div className="color-preview-card">
        <span className="color-preview" style={{ backgroundColor: color }} />
        <div className="hex-input-wrap">
          <input
            key={color}
            className="hex-color-input"
            type="text"
            defaultValue={color}
            maxLength={7}
            spellCheck={false}
            onBlur={(event) => onChange(normalizeColor(event.currentTarget.value.trim(), color))}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.currentTarget.blur()
              }
            }}
          />
          <small>可手动输入 RGB 16 进制颜色码，例如 #4ade80。</small>
        </div>
      </div>

      <div className="color-swatch-grid" aria-label="预设颜色">
        {colorPresetOptions.map((presetColor) => (
          <button
            key={presetColor}
            className={`color-swatch-button ${presetColor.toLowerCase() === color.toLowerCase() ? 'is-active' : ''}`}
            type="button"
            aria-label={`选择颜色 ${presetColor}`}
            title={presetColor}
            style={{ backgroundColor: presetColor }}
            onClick={() => onChange(presetColor)}
          />
        ))}
      </div>
    </div>
  )


  const handleSelectDisplayBackgroundImage = async (): Promise<void> => {
    try {
      const result = await window.heartdock.selectDisplayBackgroundImage()

      if (!result) {
        return
      }

      setConfig((current) => ({
        ...current,
        displayBackgroundImageEnabled: true,
        displayBackgroundImageUrl: result.url,
        displayBackgroundImageAssetFileName: result.assetFileName,
        displayBackgroundImageName: result.fileName,
        displayStylePreset: 'image-card'
      }))
    } catch (error) {
      const message = error instanceof Error ? error.message : '选择背景图片失败。'
      window.alert(message)
    }
  }

  const handleClearDisplayBackgroundImage = (): void => {
    setConfig((current) => ({
      ...current,
      displayBackgroundImageEnabled: false,
      displayBackgroundImageUrl: '',
      displayBackgroundImageAssetFileName: '',
      displayBackgroundImageName: '',
      displayStylePreset: current.displayStylePreset === 'image-card' ? 'none' : current.displayStylePreset
    }))
  }

  const handleDisplayBackgroundImageEnabledChange = (enabled: boolean): void => {
    if (enabled && !config.displayBackgroundImageUrl) {
      void handleSelectDisplayBackgroundImage()
      return
    }

    updateConfig('displayBackgroundImageEnabled', enabled)
  }

  const handleDisplayBackgroundImageOpacityChange = (value: number): void => {
    updateConfig('displayBackgroundImageOpacity', normalizeDisplayBackgroundImageOpacity(value))
  }

  const renderDisplayBackgroundImageLayer = () => {
    if (!hasDisplayBackgroundImage) {
      return null
    }

    return (
      <span
        className="display-background-image"
        aria-hidden="true"
        style={{
          backgroundImage: `url("${config.displayBackgroundImageUrl}")`,
          opacity: config.displayBackgroundImageOpacity
        }}
      />
    )
  }

  const handleTogglePureDisplay = async (): Promise<void> => {
    if (!config.pureDisplay) {
      normalWindowBoundsRef.current = await window.heartdock.getWindowBounds()

      setConfig((current) => ({
        ...current,
        pureDisplay: true,
        showSettings: false
      }))

      return
    }

    const normalWindowBounds = normalWindowBoundsRef.current

    setConfig((current) => ({
      ...current,
      pureDisplay: false,
      showSettings: true
    }))

    if (normalWindowBounds) {
      window.setTimeout(() => {
        void window.heartdock.setWindowBounds(normalWindowBounds)
      }, 0)
    }
  }

  const handlePureDisplayDoubleClick = (): void => {
    if (pureDragMovedRef.current || configRef.current.clickThrough) {
      return
    }

    void handleTogglePureDisplay()
  }

  const handlePureDisplayMouseDown = (event: ReactMouseEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || configRef.current.clickThrough) {
      return
    }

    event.preventDefault()

    pureDragStateRef.current = {
      isDragging: true,
      lastScreenX: event.screenX,
      lastScreenY: event.screenY,
      totalDeltaX: 0,
      totalDeltaY: 0,
      animationFrameId: 0,
      pendingDeltaX: 0,
      pendingDeltaY: 0
    }

    window.heartdock.setHitTestPassthrough(false)

    const applyPendingPureDrag = (): void => {
      const dragState = pureDragStateRef.current
      dragState.animationFrameId = 0

      if (!dragState.isDragging) {
        dragState.pendingDeltaX = 0
        dragState.pendingDeltaY = 0
        return
      }

      const deltaX = dragState.pendingDeltaX
      const deltaY = dragState.pendingDeltaY

      if (deltaX === 0 && deltaY === 0) {
        return
      }

      dragState.pendingDeltaX = 0
      dragState.pendingDeltaY = 0

      void window.heartdock.moveWindowBy(deltaX, deltaY)
    }

    const handleMouseMove = (moveEvent: MouseEvent): void => {
      const dragState = pureDragStateRef.current

      if (!dragState.isDragging) {
        return
      }

      const deltaX = moveEvent.screenX - dragState.lastScreenX
      const deltaY = moveEvent.screenY - dragState.lastScreenY

      if (deltaX === 0 && deltaY === 0) {
        return
      }

      dragState.lastScreenX = moveEvent.screenX
      dragState.lastScreenY = moveEvent.screenY
      dragState.totalDeltaX += Math.abs(deltaX)
      dragState.totalDeltaY += Math.abs(deltaY)

      if (dragState.totalDeltaX + dragState.totalDeltaY > 4) {
        pureDragMovedRef.current = true
      }

      dragState.pendingDeltaX += deltaX
      dragState.pendingDeltaY += deltaY

      if (dragState.animationFrameId === 0) {
        dragState.animationFrameId = window.requestAnimationFrame(applyPendingPureDrag)
      }
    }

    const handleMouseUp = (upEvent: MouseEvent): void => {
      const dragState = pureDragStateRef.current
      dragState.isDragging = false

      if (dragState.animationFrameId !== 0) {
        window.cancelAnimationFrame(dragState.animationFrameId)
        dragState.animationFrameId = 0
      }

      if (dragState.pendingDeltaX !== 0 || dragState.pendingDeltaY !== 0) {
        void window.heartdock.moveWindowBy(dragState.pendingDeltaX, dragState.pendingDeltaY)
        dragState.pendingDeltaX = 0
        dragState.pendingDeltaY = 0
      }

      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)

      const latestConfig = configRef.current

      if (latestConfig.pureDisplay && !latestConfig.clickThrough) {
        const rect = pureHeartRef.current?.getBoundingClientRect()
        const isInsideHeart = Boolean(
          rect &&
            upEvent.clientX >= rect.left &&
            upEvent.clientX <= rect.right &&
            upEvent.clientY >= rect.top &&
            upEvent.clientY <= rect.bottom
        )

        void window.heartdock.setHitTestPassthrough(!isInsideHeart)
      }

      window.setTimeout(() => {
        pureDragMovedRef.current = false
      }, 180)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }

  const handleWindowResizeMouseDown = async (
    event: ReactMouseEvent<HTMLButtonElement>
  ): Promise<void> => {
    if (event.button !== 0 || isPureDisplay) {
      return
    }

    event.preventDefault()
    event.stopPropagation()

    const bounds = await window.heartdock.getWindowBounds()

    if (!bounds) {
      return
    }

    windowResizeStateRef.current = {
      isResizing: true,
      startScreenX: event.screenX,
      startScreenY: event.screenY,
      startBounds: bounds,
      animationFrameId: 0,
      pendingBounds: null,
      lastAppliedAt: 0
    }

    setIsWindowResizing(true)

    const applyPendingResizeBounds = (): void => {
      const resizeState = windowResizeStateRef.current
      resizeState.animationFrameId = 0

      if (!resizeState.isResizing || !resizeState.pendingBounds) {
        return
      }

      const now = window.performance.now()
      const minFrameIntervalMs = 40

      if (resizeState.lastAppliedAt > 0 && now - resizeState.lastAppliedAt < minFrameIntervalMs) {
        resizeState.animationFrameId = window.requestAnimationFrame(applyPendingResizeBounds)
        return
      }

      const nextBounds = resizeState.pendingBounds
      resizeState.pendingBounds = null
      resizeState.lastAppliedAt = now

      void window.heartdock.setWindowBounds(nextBounds)
    }

    const handleMouseMove = (moveEvent: MouseEvent): void => {
      const resizeState = windowResizeStateRef.current

      if (!resizeState.isResizing || !resizeState.startBounds) {
        return
      }

      const deltaX = moveEvent.screenX - resizeState.startScreenX
      const deltaY = moveEvent.screenY - resizeState.startScreenY

      resizeState.pendingBounds = {
        ...resizeState.startBounds,
        width: resizeState.startBounds.width + deltaX,
        height: resizeState.startBounds.height + deltaY
      }

      if (resizeState.animationFrameId === 0) {
        resizeState.animationFrameId = window.requestAnimationFrame(applyPendingResizeBounds)
      }
    }

    const handleMouseUp = (): void => {
      const resizeState = windowResizeStateRef.current
      resizeState.isResizing = false

      if (resizeState.animationFrameId !== 0) {
        window.cancelAnimationFrame(resizeState.animationFrameId)
        resizeState.animationFrameId = 0
      }

      if (resizeState.pendingBounds) {
        void window.heartdock.setWindowBounds(resizeState.pendingBounds)
        resizeState.pendingBounds = null
      }

      resizeState.lastAppliedAt = 0
      setIsWindowResizing(false)

      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }

  const getBleStatusText = (): string => {
    if (bleStatus === 'connecting') {
      return '连接中'
    }

    if (bleStatus === 'connected') {
      return '已连接'
    }

    if (bleStatus === 'failed') {
      return '连接失败'
    }

    return '未连接'
  }

  const handleBleMeasurement = useCallback((event: Event): void => {
    if (sourceModeRef.current !== 'ble') {
      return
    }

    const characteristic = event.target as unknown as BleCharacteristic | null
    const value = characteristic?.value

    if (!value) {
      return
    }

    const nextBpm = parseHeartRateMeasurement(value)

    if (nextBpm === null) {
      setBleMessage('收到心率数据，但暂时无法解析。')
      return
    }

    setBpm(nextBpm)
    setBleStatus('connected')
    setBleMessage(`正在接收 BLE 心率数据：${nextBpm} bpm`)
  }, [])

  const handleBleDisconnected = useCallback((): void => {
    if (isManualBleDisconnectRef.current) {
      isManualBleDisconnectRef.current = false
      return
    }

    const device = bleDeviceRef.current

    bleCharacteristicRef.current = null
    setBleStatus('idle')

    if (device) {
      const displayName = getBleDeviceDisplayName(device)

      setBleDeviceName(displayName)
      setHasBleReconnectDevice(true)
      setBleMessage(`BLE 设备已断开连接。可以点击“重新连接上次设备”尝试重新连接 ${displayName}。`)
      return
    }

    setBleDeviceName('')
    setHasBleReconnectDevice(false)
    setBleMessage('BLE 设备已断开连接。当前不再接收实时心率，可以重新点击连接心率设备。')
  }, [])

  const connectBleDevice = useCallback(
    async (device: BleDevice, isReconnect = false): Promise<void> => {
      if (sourceModeRef.current !== 'ble') {
        return
      }

      const displayName = getBleDeviceDisplayName(device)
      const previousDevice = bleDeviceRef.current

      if (previousDevice && previousDevice !== device) {
        previousDevice.removeEventListener('gattserverdisconnected', handleBleDisconnected)
      }

      setBleStatus('connecting')
      setBleDeviceName(displayName)
      setHasBleReconnectDevice(true)
      setBleMessage(isReconnect ? `正在重新连接 ${displayName}。` : '已选择设备，正在连接 GATT 服务。')

      device.removeEventListener('gattserverdisconnected', handleBleDisconnected)
      device.addEventListener('gattserverdisconnected', handleBleDisconnected)

      const server = await device.gatt?.connect()

      if (!server) {
        throw new Error('无法连接设备 GATT 服务。')
      }

      if (sourceModeRef.current !== 'ble') {
        server.disconnect?.()
        return
      }

      const service = await server.getPrimaryService('heart_rate')
      const characteristic = await service.getCharacteristic('heart_rate_measurement')

      bleDeviceRef.current = device
      bleCharacteristicRef.current = characteristic
      characteristic.removeEventListener('characteristicvaluechanged', handleBleMeasurement)
      characteristic.addEventListener('characteristicvaluechanged', handleBleMeasurement)

      await characteristic.startNotifications()

      setBleStatus('connected')
      setHasBleReconnectDevice(true)
      setBleDeviceName(displayName)
      setBleMessage(isReconnect ? `已重新连接 ${displayName}，等待心率数据通知。` : '已连接 BLE 心率设备，等待心率数据通知。')
    },
    [handleBleDisconnected, handleBleMeasurement]
  )

  const disconnectBleDevice = useCallback(
    async (message = 'BLE 连接已关闭。', clearDevice = true): Promise<void> => {
      const characteristic = bleCharacteristicRef.current
      const device = bleDeviceRef.current

      setBleStatus('idle')
      setBleMessage(message)

      if (clearDevice) {
        setBleDeviceName('')
        setHasBleReconnectDevice(false)
      } else if (device) {
        setBleDeviceName(getBleDeviceDisplayName(device))
        setHasBleReconnectDevice(true)
      }

      if (characteristic) {
        characteristic.removeEventListener('characteristicvaluechanged', handleBleMeasurement)

        try {
          await characteristic.stopNotifications?.()
        } catch (error) {
          console.warn('[HeartDock] failed to stop BLE notifications:', error)
        }
      }

      if (device) {
        if (clearDevice) {
          device.removeEventListener('gattserverdisconnected', handleBleDisconnected)
        }

        try {
          if (device.gatt?.connected) {
            isManualBleDisconnectRef.current = true
            device.gatt.disconnect?.()
          }
        } catch (error) {
          isManualBleDisconnectRef.current = false
          console.warn('[HeartDock] failed to disconnect BLE device:', error)
        }
      }

      bleCharacteristicRef.current = null

      if (clearDevice) {
        bleDeviceRef.current = null
        isManualBleDisconnectRef.current = false
      }
    },
    [handleBleDisconnected, handleBleMeasurement]
  )

  const handleConnectBleDevice = async (): Promise<void> => {
    const bluetooth = (navigator as NavigatorWithBluetooth).bluetooth

    if (!bluetooth) {
      setBleStatus('failed')
      setBleDeviceName('')
      setHasBleReconnectDevice(false)
      setBleMessage('当前环境不支持 Web Bluetooth。请确认 Electron / Chromium 环境和系统蓝牙支持。')
      return
    }

    try {
      setBleStatus('connecting')
      setBleMessage('正在请求 BLE 心率设备。请确认 Windows 蓝牙已开启，并让心率设备开启心率广播或标准 BLE Heart Rate Service。')

      const device = await bluetooth.requestDevice({
        filters: [{ services: ['heart_rate'] }],
        optionalServices: ['heart_rate']
      })

      await connectBleDevice(device, false)
    } catch (error) {
      if (sourceModeRef.current !== 'ble') {
        return
      }

      if (error instanceof Error && error.message.includes('User cancelled')) {
        setBleStatus('idle')
        setBleMessage(
          hasBleReconnectDevice
            ? '未选择新的 BLE 心率设备。可以重新连接上次设备，或确认其他设备正在广播心率服务后再选择。'
            : '未选择 BLE 心率设备。请确认 Windows 蓝牙已开启，设备正在广播心率服务，然后重新点击连接。'
        )
        return
      }

      setBleStatus('failed')

      if (error instanceof Error) {
        setBleMessage(`BLE 连接失败：${error.message}。请检查 Windows 蓝牙是否已开启，设备是否正在广播标准心率服务。`)
      } else {
        setBleMessage('BLE 连接失败：未知错误。请检查 Windows 蓝牙是否已开启，设备是否正在广播标准心率服务。')
      }
    }
  }

  const handleReconnectBleDevice = async (): Promise<void> => {
    const device = bleDeviceRef.current

    if (!device) {
      setHasBleReconnectDevice(false)
      setBleStatus('idle')
      setBleMessage('没有可重连的 BLE 心率设备。请点击“连接心率设备”重新选择设备。')
      return
    }

    try {
      await connectBleDevice(device, true)
    } catch (error) {
      if (sourceModeRef.current !== 'ble') {
        return
      }

      setBleStatus('failed')
      setHasBleReconnectDevice(true)

      const displayName = getBleDeviceDisplayName(device)

      if (error instanceof Error) {
        setBleMessage(`重新连接 ${displayName} 失败：${error.message}。请确认设备仍在附近、蓝牙已开启，并且心率广播仍处于开启状态。`)
      } else {
        setBleMessage(`重新连接 ${displayName} 失败：未知错误。请确认设备仍在附近、蓝牙已开启，并且心率广播仍处于开启状态。`)
      }
    }
  }

  const handleSourceModeChange = (sourceMode: HeartRateSourceMode): void => {
    sourceModeRef.current = sourceMode

    if (sourceMode === 'mock') {
      sourceRef.current = new MockHeartRateSource()
      setBpm(sourceRef.current.next())
    }

    if (config.heartRateSourceMode === 'ble' && sourceMode !== 'ble') {
      void disconnectBleDevice('已切换到其他数据源，BLE 连接已关闭。')
    }

    if (sourceMode === 'ble') {
      setBleStatus('idle')
      setBleDeviceName('')
      setHasBleReconnectDevice(false)
      setBleMessage('尚未连接 BLE 心率设备。请先开启 Windows 蓝牙，并确保心率设备正在广播标准心率服务。连接前心率将显示为 -- bpm。')
    }

    setConfig((current) => {
      if (sourceMode === 'manual') {
        const manualBpm = normalizeBpm(current.manualBpm)

        setBpm(manualBpm)
        setManualInput(String(manualBpm))

        return {
          ...current,
          heartRateSourceMode: sourceMode,
          manualBpm
        }
      }

      return {
        ...current,
        heartRateSourceMode: sourceMode
      }
    })
  }

  const handleManualInputChange = (value: string): void => {
    setManualInput(value)
  }

  const applyManualBpm = (): void => {
    const trimmed = manualInput.trim()

    if (!trimmed) {
      const fallback = normalizeBpm(config.manualBpm)
      setManualInput(String(fallback))
      setBpm(fallback)
      updateConfig('manualBpm', fallback)
      return
    }

    const parsed = Number(trimmed)

    if (!Number.isFinite(parsed)) {
      const fallback = normalizeBpm(config.manualBpm)
      setManualInput(String(fallback))
      setBpm(fallback)
      updateConfig('manualBpm', fallback)
      return
    }

    const nextBpm = normalizeBpm(parsed)

    setManualInput(String(nextBpm))
    setBpm(nextBpm)
    updateConfig('manualBpm', nextBpm)
  }

  const handleManualInputKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      applyManualBpm()
    }
  }

  const applyRefreshIntervalMs = (): void => {
    const trimmed = refreshIntervalInput.trim()

    if (!trimmed) {
      const fallback = normalizeRefreshIntervalMs(config.refreshIntervalMs)
      setRefreshIntervalInput(String(fallback))
      updateConfig('refreshIntervalMs', fallback)
      return
    }

    const parsed = Number(trimmed)

    if (!Number.isFinite(parsed)) {
      const fallback = normalizeRefreshIntervalMs(config.refreshIntervalMs)
      setRefreshIntervalInput(String(fallback))
      updateConfig('refreshIntervalMs', fallback)
      return
    }

    const nextRefreshIntervalMs = normalizeRefreshIntervalMs(parsed)

    setRefreshIntervalInput(String(nextRefreshIntervalMs))
    updateConfig('refreshIntervalMs', nextRefreshIntervalMs)
  }

  const handleRefreshIntervalStep = (delta: number): void => {
    const parsed = Number(refreshIntervalInput.trim())
    const currentValue = Number.isFinite(parsed)
      ? normalizeRefreshIntervalMs(parsed)
      : normalizeRefreshIntervalMs(config.refreshIntervalMs)
    const nextRefreshIntervalMs = normalizeRefreshIntervalMs(currentValue + delta)

    setRefreshIntervalInput(String(nextRefreshIntervalMs))
    updateConfig('refreshIntervalMs', nextRefreshIntervalMs)
  }

  const handleRefreshIntervalKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      applyRefreshIntervalMs()
    }
  }

  const handleOpenExternalLink = (url: string): void => {
    void window.heartdock.openExternal(url)
  }

  const dismissFirstRunNotice = (): void => {
    setIsFirstRunNoticeLeaving(true)

    window.setTimeout(() => {
      void window.heartdock.enterMainView().finally(() => {
        setShouldShowFirstRunNotice(false)
        setIsFirstRunNoticeLeaving(false)
      })
    }, 260)
  }

  const handleConfirmFirstRunNotice = (): void => {
    if (!canEnterFromStartup) {
      return
    }

    if (firstRunNoticeMode === 'required') {
      if (firstRunNoticeSecondsLeft > 0 || !firstRunNoticeAccepted) {
        return
      }

      localStorage.setItem(FIRST_RUN_NOTICE_KEY, 'accepted')
      dismissFirstRunNotice()
      return
    }

    dismissFirstRunNotice()
  }

  const handleAppearanceModeChange = (value: AppearanceMode): void => {
    setAppearanceMode(value)
    localStorage.setItem(APPEARANCE_MODE_KEY, value)
  }

  const handleToggleAppearanceMode = (): void => {
    handleAppearanceModeChange(appearanceMode === 'dark' ? 'light' : 'dark')
  }

  const handleShowFirstRunNoticeAgain = (): void => {
    localStorage.removeItem(FIRST_RUN_NOTICE_KEY)
    setFirstRunNoticeMode('required')
    setFirstRunNoticeAccepted(false)
    setFirstRunNoticeSecondsLeft(FIRST_RUN_NOTICE_SECONDS)
    setIsFirstRunNoticeLeaving(false)
    setShouldShowFirstRunNotice(true)
  }

  const completeOnboarding = (): void => {
    localStorage.setItem(ONBOARDING_TOUR_KEY, 'completed')
    setIsOnboardingActive(false)
    restoreOnboardingWindowBounds()
  }

  const handleShowOnboardingAgain = (): void => {
    localStorage.removeItem(ONBOARDING_TOUR_KEY)
    beginOnboardingTour()
  }

  const handleOnboardingNext = (): void => {
    if (onboardingStepIndex >= onboardingSteps.length - 1) {
      completeOnboarding()
      return
    }

    setOnboardingStepIndex((current) => Math.min(current + 1, onboardingSteps.length - 1))
  }

  const handleOnboardingPrevious = (): void => {
    setOnboardingStepIndex((current) => Math.max(current - 1, 0))
  }

  const handleManualCheckForUpdates = async (): Promise<void> => {
    setIsManualUpdateCheck(true)
    setIsManualUpdateDialogOpen(true)
    setIsUpdateDialogDismissed(false)
    setSettingsNotice('正在检查更新...')
    setUpdateSummary((current) => ({
      ...current,
      status: 'checking',
      message: '正在检查 HeartDock 更新...'
    }))

    try {
      const summary = await window.heartdock.checkForUpdates()
      setUpdateSummary(summary)
      setSettingsNotice(summary.message || (summary.status === 'available' ? '发现新版本。' : '检查更新完成。'))
    } catch (error) {
      const message = error instanceof Error ? error.message : '检查更新失败。'
      setSettingsNotice(message)
      setUpdateSummary({ ...defaultUpdateSummary, status: 'error', message })
    } finally {
      setIsManualUpdateCheck(false)
    }
  }

  const handleDownloadUpdate = async (): Promise<void> => {
    setIsUpdateDialogDismissed(false)
    const summary = await window.heartdock.downloadUpdate()
    setUpdateSummary(summary)
  }

  const handleInstallUpdate = (): void => {
    void window.heartdock.installUpdate()
  }

  const handleDismissUpdateDialog = (): void => {
    if (updateSummary.isMajorUpdate && hasActionableUpdate) {
      return
    }

    setIsManualUpdateDialogOpen(false)
    setIsUpdateDialogDismissed(true)
  }

  const buildDiagnosticsSnapshot = (): Record<string, unknown> => ({
    heartRateSource: config.heartRateSourceMode,
    bleMode: config.heartRateSourceMode === 'ble',
    bleStatus,
    pureDisplay: config.pureDisplay,
    enhancedTopmost: config.pureDisplay && config.alwaysOnTop,
    clickThrough: config.clickThrough,
    displayStylePreset: config.displayStylePreset,
    dynamicEffects: {
      heartbeatPulseEnabled: config.heartbeatPulseEnabled,
      smoothColorTransitionEnabled: config.smoothColorTransitionEnabled,
      highHeartRateAlertEnabled: config.highHeartRateAlertEnabled,
      highHeartRateAlertThreshold: config.highHeartRateAlertThreshold,
      lowHeartRateBreathEnabled: config.lowHeartRateBreathEnabled
    },
    configSummary: {
      showSettings: config.showSettings,
      alwaysOnTop: config.alwaysOnTop,
      fontSize: config.fontSize,
      backgroundOpacity: config.backgroundOpacity,
      colorMode: config.colorMode,
      glowLevel: config.glowLevel,
      colorRuleCount: config.colorRules.length,
      hasCustomBackgroundImage: Boolean(config.displayBackgroundImageEnabled),
      displayBackgroundImageFit: config.displayBackgroundImageFit,
      heartRateRecordingEnabled: config.heartRateRecordingEnabled,
      refreshIntervalMs: config.refreshIntervalMs
    },
    runtimeState: {
      bpm: shouldShowBlePlaceholder ? '--' : bpm,
      updateStatus: updateSummary.status,
      reportWindowMode: 'independent'
    }
  })

  const handleExportDiagnostics = async (): Promise<void> => {
    try {
      const result = await window.heartdock.exportDiagnostics(buildDiagnosticsSnapshot())

      setSettingsNotice(
        result
          ? `已导出诊断信息：${result.fileName}。反馈问题时可以把这个文件一起附上。`
          : '已取消导出诊断信息。'
      )
    } catch (error) {
      setSettingsNotice(error instanceof Error ? error.message : '导出诊断信息失败。')
    }
  }

  const showFloatingHelpTooltip = (
    event: ReactMouseEvent<HTMLElement> | ReactFocusEvent<HTMLElement>,
    text: string
  ): void => {
    const rect = event.currentTarget.getBoundingClientRect()
    const placement: FloatingHelpTooltip['placement'] = rect.top < 96 ? 'below' : 'above'
    const left = Math.min(window.innerWidth - 136, Math.max(136, rect.left + rect.width / 2))
    const top = placement === 'below' ? rect.bottom + 10 : rect.top - 10

    setFloatingHelpTooltip({ text, top, left, placement })
  }

  const hideFloatingHelpTooltip = (): void => {
    setFloatingHelpTooltip(null)
  }

  const renderHelpButton = (text: string) => (
    <button
      className="help-tooltip"
      type="button"
      aria-label={text}
      onMouseEnter={(event) => showFloatingHelpTooltip(event, text)}
      onMouseLeave={hideFloatingHelpTooltip}
      onFocus={(event) => showFloatingHelpTooltip(event, text)}
      onBlur={hideFloatingHelpTooltip}
    >
      ?
    </button>
  )

  const handleCloseWindow = (): void => {
    if (isClosing) {
      return
    }

    setIsClosing(true)
    void window.heartdock.setPureDisplayTopmost(false)
    void window.heartdock.setHitTestPassthrough(false)
    void window.heartdock.setClickThrough(false)

    window.setTimeout(() => {
      void window.heartdock.closeWindow()
    }, 180)
  }

  const showInteractionLockNotice = useCallback((): void => {
    setIsInteractionLockNoticeVisible(true)

    if (interactionLockNoticeTimerRef.current !== null) {
      window.clearTimeout(interactionLockNoticeTimerRef.current)
    }

    interactionLockNoticeTimerRef.current = window.setTimeout(() => {
      interactionLockNoticeTimerRef.current = null
      setIsInteractionLockNoticeVisible(false)
    }, 2200)
  }, [])

  const handleInteractionLockMouseDown = (event: ReactMouseEvent<HTMLDivElement>): void => {
    event.preventDefault()
    event.stopPropagation()
    showInteractionLockNotice()
  }

  const handleExportConfig = async (): Promise<void> => {
    try {
      const payload = {
        app: 'HeartDock',
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        config
      }
      const result = await window.heartdock.exportConfigFile(JSON.stringify(payload, null, 2))

      if (!result) {
        return
      }

      window.alert(`已导出配置文件：${result.fileName}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : '导出配置文件失败。'
      window.alert(message)
    }
  }

  const getConfigImportSummary = (nextConfig: HeartDockConfig, fileName: string): string => {
    const sourceLabel =
      sourceModeOptions.find((option) => option.value === nextConfig.heartRateSourceMode)?.label ??
      nextConfig.heartRateSourceMode
    const styleLabel =
      displayStylePresetOptions.find((option) => option.value === nextConfig.displayStylePreset)
        ?.label ?? nextConfig.displayStylePreset
    const sceneLabel = nextConfig.lastAppliedScenePreset
      ? scenePresets.find((preset) => preset.id === nextConfig.lastAppliedScenePreset)?.label ?? '未知预设'
      : '未记录'

    return [
      `文件：${fileName}`,
      `显示样式：${styleLabel}`,
      `数据源：${sourceLabel}`,
      `字体大小：${nextConfig.fontSize}`,
      `场景预设：${sceneLabel}`,
      `动态效果：${nextConfig.heartbeatPulseEnabled || nextConfig.smoothColorTransitionEnabled ? '已启用部分效果' : '未启用'}`,
      `纯享心率记录：${nextConfig.heartRateRecordingEnabled ? '开启' : '关闭'}`,
      '',
      '载入后会自动关闭纯享模式、鼠标禁止交互并断开 BLE，确保窗口保持可操作。'
    ].join('\n')
  }

  const handleImportConfig = async (): Promise<void> => {
    try {
      const result = await window.heartdock.importConfigFile()

      if (!result) {
        return
      }

      const parsed = JSON.parse(result.content) as unknown
      const importedConfig = normalizeConfig(getImportedConfigCandidate(parsed))
      const confirmed = window.confirm(`确认载入这个 HeartDock 配置？\n\n${getConfigImportSummary(importedConfig, result.fileName)}`)

      if (!confirmed) {
        return
      }

      const nextConfig: HeartDockConfig = {
        ...importedConfig,
        clickThrough: false,
        pureDisplay: false,
        showSettings: true
      }
      const nextBpm = normalizeBpm(nextConfig.manualBpm)

      void disconnectBleDevice('已载入配置文件，BLE 连接已关闭。')
      void window.heartdock.setPureDisplayTopmost(false)
      void window.heartdock.setHitTestPassthrough(false)
      void window.heartdock.setClickThrough(false)

      sourceModeRef.current = nextConfig.heartRateSourceMode
      normalWindowBoundsRef.current = null

      if (nextConfig.heartRateSourceMode === 'mock') {
        sourceRef.current = new MockHeartRateSource()
        setBpm(sourceRef.current.next())
      } else {
        setBpm(nextBpm)
      }

      if (nextConfig.heartRateSourceMode === 'ble') {
        setBleStatus('idle')
        setBleDeviceName('')
        setHasBleReconnectDevice(false)
        setBleMessage('已载入配置文件。请重新连接 BLE 心率设备后开始接收实时心率。')
      }

      setManualInput(String(nextBpm))
      setRefreshIntervalInput(String(normalizeRefreshIntervalMs(nextConfig.refreshIntervalMs)))
      setConfig(nextConfig)
      window.alert(`已载入配置文件：${result.fileName}`)
    } catch (error) {
      const message =
        error instanceof SyntaxError
          ? '配置文件不是有效的 JSON 文件。'
          : error instanceof Error
            ? error.message
            : '载入配置文件失败。'
      window.alert(message)
    }
  }

  const handleResetConfig = (): void => {
    const nextConfig = createDefaultConfig()
    const nextBpm = normalizeBpm(nextConfig.manualBpm)

    void disconnectBleDevice('已重置显示设置，BLE 连接已关闭。')

    sourceModeRef.current = nextConfig.heartRateSourceMode
    sourceRef.current = new MockHeartRateSource()
    normalWindowBoundsRef.current = null

    setBpm(nextBpm)
    setManualInput(String(nextBpm))
    setRefreshIntervalInput(String(normalizeRefreshIntervalMs(nextConfig.refreshIntervalMs)))
    setConfig(nextConfig)
  }

  const handleOpenResetConfigConfirm = (): void => {
    setIsResetConfigConfirmClosing(false)
    setIsResetConfigConfirmOpen(true)
  }

  const handleCloseResetConfigConfirm = (): void => {
    setIsResetConfigConfirmClosing(true)
    window.setTimeout(() => {
      setIsResetConfigConfirmOpen(false)
      setIsResetConfigConfirmClosing(false)
    }, 180)
  }

  const handleConfirmResetConfig = (): void => {
    handleResetConfig()
    handleCloseResetConfigConfirm()
  }

  const handleExportHeartRateReportPng = async (): Promise<void> => {
    if (!heartRateRecordReport) {
      return
    }

    setIsExportingHeartRateReport(true)

    try {
      const contentBase64 = createHeartRateReportPngBase64(heartRateRecordReport, configRef.current)
      const defaultFileName = `heartdock-heart-rate-${getTimestampFilePart(heartRateRecordReport.endedAt)}.png`
      const result = await window.heartdock.saveHeartRateReportPng(contentBase64, defaultFileName)

      if (!result) {
        setHeartRateRecordNotice('已取消导出 PNG，当前报告仍保留。')
        return
      }

      setHeartRateRecordNotice(`已导出 PNG 报告：${result.fileName}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : '导出 PNG 报告失败。'
      setHeartRateRecordNotice(message)
    } finally {
      setIsExportingHeartRateReport(false)
    }
  }

  const handleCloseHeartRateReport = (): void => {
    setIsHeartRateReportClosing(true)

    window.setTimeout(() => {
      setHeartRateRecordReport(null)
      setHeartRateRecordNotice('')
      setIsHeartRateReportClosing(false)
    }, 180)
  }

  return (
    <main
      className={`app-shell appearance-${appearanceMode} ${isPureDisplay ? 'pure-display-shell' : ''} ${
        isClosing ? 'is-closing' : ''
      } ${isWindowResizing ? 'is-window-resizing' : ''} ${
        isBootSplashVisible ? 'is-booting' : ''
      } ${
        shouldShowFirstRunNotice ? 'is-first-run-notice' : ''
      } ${isFirstRunNoticeLeaving ? 'is-first-run-leaving' : ''} ${
        isOnboardingActive ? 'is-onboarding-active' : ''
      } ${
        config.clickThrough ? 'is-interaction-locked' : ''
      }`}
    >
      {isBootSplashVisible && (
        <div className="boot-heart-splash" aria-hidden="true">
          <div className="boot-heart-logo">
            <span>♥</span>
            <strong>HeartDock</strong>
            <small>桌面心率悬浮窗</small>
          </div>
        </div>
      )}
      {floatingHelpTooltip && (
        <div
          className={`floating-help-tooltip is-${floatingHelpTooltip.placement}`}
          style={{
            top: floatingHelpTooltip.top,
            left: floatingHelpTooltip.left
          }}
          role="tooltip"
        >
          {floatingHelpTooltip.text}
        </div>
      )}
      {config.clickThrough && (
        <div
          className="interaction-lock-layer no-drag"
          onMouseDown={handleInteractionLockMouseDown}
          onMouseUp={handleInteractionLockMouseDown}
          onClick={handleInteractionLockMouseDown}
          onDoubleClick={handleInteractionLockMouseDown}
        >
          <div
            className={`interaction-lock-toast ${
              isInteractionLockNoticeVisible ? 'is-visible' : ''
            }`}
            role="status"
            aria-live="polite"
          >
            <strong>当前处于禁止交互状态</strong>
            <span>按 Ctrl + Shift + H 解锁 HeartDock。</span>
          </div>
        </div>
      )}
      {scenePresetToConfirm && (
        <div
          className={`scene-confirm-modal no-drag ${
            isScenePresetModalClosing ? 'is-leaving' : ''
          }`}
          role="dialog"
          aria-modal="true"
        >
          <div className="scene-confirm-panel">
            <div className="scene-confirm-heading">
              <span>应用场景预设</span>
              <button
                className="icon-button"
                type="button"
                aria-label="关闭预设确认"
                title="关闭预设确认"
                onClick={handleCloseScenePresetConfirm}
              >
                ×
              </button>
            </div>

            <div className="scene-confirm-body">
              <span className="scene-confirm-kicker">{scenePresetToConfirm.recommendedFor}</span>
              <strong>{scenePresetToConfirm.label}</strong>
              <p>{scenePresetToConfirm.description}</p>
              <ul>
                <li>会立即调整显示框样式、字号、颜色、发光和动态效果。</li>
                <li>不会修改当前心率来源，也不会自动进入纯享模式。</li>
                <li>应用后可以用“撤销上次预设”恢复本次应用前的显示配置。</li>
              </ul>
            </div>

            <div className="scene-confirm-actions">
              <button className="reset-button" type="button" onClick={handleCloseScenePresetConfirm}>
                取消
              </button>
              <button className="secondary-button" type="button" onClick={handleConfirmScenePreset}>
                应用预设
              </button>
            </div>
          </div>
        </div>
      )}
      {isResetConfigConfirmOpen && (
        <div
          className={`reset-confirm-modal no-drag ${
            isResetConfigConfirmClosing ? 'is-leaving' : ''
          }`}
          role="dialog"
          aria-modal="true"
          aria-labelledby="reset-config-title"
        >
          <div className="reset-confirm-panel">
            <div className="scene-confirm-heading">
              <span id="reset-config-title">重置显示设置</span>
              <button
                className="icon-button"
                type="button"
                aria-label="关闭重置确认"
                title="关闭重置确认"
                onClick={handleCloseResetConfigConfirm}
              >
                ×
              </button>
            </div>

            <div className="scene-confirm-body reset-confirm-body">
              <span className="scene-confirm-kicker">显示配置将恢复默认</span>
              <strong>确定要重置所有显示设置吗？</strong>
              <p>会恢复字号、颜色、显示样式、动态效果和窗口显示配置，并断开当前 BLE 连接。</p>
            </div>

            <div className="scene-confirm-actions">
              <button className="reset-button" type="button" onClick={handleCloseResetConfigConfirm}>
                取消
              </button>
              <button className="secondary-button" type="button" onClick={handleConfirmResetConfig}>
                确认重置
              </button>
            </div>
          </div>
        </div>
      )}
      {shouldShowUpdateDialog && (
        <div className="update-modal no-drag" role="dialog" aria-modal="true">
          <section className={`update-panel ${isUpdateCheckStatusDialog ? 'is-check-status' : ''}`}>
            <div className="update-heading">
              <div>
                <span>
                  {isUpdateCheckStatusDialog
                    ? '检查 HeartDock 更新'
                    : updateSummary.isMajorUpdate
                      ? '发现跨版本大更新'
                      : '发现新版本'}
                </span>
                <strong>
                  {updateSummary.currentVersion} →{' '}
                  {hasActionableUpdate ? updateSummary.latestVersion || '新版本' : updateDialogLatestVersion}
                </strong>
              </div>
              {(!updateSummary.isMajorUpdate || isUpdateCheckStatusDialog) && (
                <button
                  className="icon-button"
                  type="button"
                  aria-label="关闭更新窗口"
                  title="关闭更新窗口"
                  onClick={handleDismissUpdateDialog}
                >
                  ×
                </button>
              )}
            </div>

            {isUpdateCheckStatusDialog ? (
              <div className="update-version-box">
                <span className="update-version-icon" aria-hidden="true">
                  i
                </span>
                <div className="update-version-lines">
                  <span>
                    当前版本：<strong>{updateSummary.currentVersion}</strong>
                  </span>
                  <span>
                    最新版本：<strong>{updateDialogLatestVersion}</strong>
                    {updateSummary.status === 'checking' && <i className="update-spinner" aria-hidden="true" />}
                  </span>
                </div>
              </div>
            ) : (
              <p className="update-message">
                {updateSummary.isMajorUpdate
                  ? '该版本属于跨大版本更新，需要先更新后继续使用。'
                  : '建议更新到最新版本，以获得稳定性修复和体验优化。'}
              </p>
            )}

            {hasActionableUpdate && (
              <ul className="update-notes">
                {(updateSummary.releaseNotes.length > 0
                  ? updateSummary.releaseNotes
                  : ['包含稳定性修复和体验优化。']
                ).map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            )}

            {(updateSummary.status === 'downloading' || updateSummary.status === 'downloaded') && (
              <div className="update-progress" aria-label="更新下载进度">
                <span style={{ width: `${Math.max(4, updateSummary.progressPercent)}%` }} />
                <strong>{updateSummary.progressPercent}%</strong>
              </div>
            )}

            {updateSummary.message && (
              <p className={isUpdateCheckStatusDialog ? 'update-result-text' : 'update-status-text'}>
                {updateSummary.message}
              </p>
            )}

            <div className="update-actions">
              {hasActionableUpdate && (
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => handleOpenExternalLink(updateSummary.releasePageUrl)}
                >
                  打开发布页
                </button>
              )}
              {!updateSummary.isMajorUpdate && hasActionableUpdate && updateSummary.status === 'available' && (
                <button className="reset-button" type="button" onClick={handleDismissUpdateDialog}>
                  暂不更新
                </button>
              )}
              {isUpdateCheckStatusDialog ? (
                <button
                  className="primary-button"
                  type="button"
                  disabled={updateSummary.status === 'checking'}
                  onClick={handleDismissUpdateDialog}
                >
                  确定
                </button>
              ) : updateSummary.status === 'downloaded' ? (
                <button className="primary-button" type="button" onClick={handleInstallUpdate}>
                  重启安装
                </button>
              ) : (
                <button
                  className="primary-button"
                  type="button"
                  disabled={updateSummary.status === 'downloading'}
                  onClick={() => void handleDownloadUpdate()}
                >
                  {updateSummary.status === 'downloading' ? '正在下载...' : '立即更新'}
                </button>
              )}
            </div>
          </section>
        </div>
      )}
      {(heartRateRecordReport || heartRateRecordNotice) && (
        <div
          className={`heart-rate-report-modal no-drag ${
            isHeartRateReportClosing ? 'is-leaving' : ''
          }`}
          role="dialog"
          aria-modal="true"
        >
          <div className="heart-rate-report-panel">
            <div className="report-heading">
              <span>纯享心率记录</span>
              <button
                className="icon-button"
                type="button"
                aria-label="关闭心率报告"
                title="关闭心率报告"
                onClick={handleCloseHeartRateReport}
              >
                ×
              </button>
            </div>

            {heartRateRecordReport ? (
              <>
                <div className="report-summary-grid">
                  <div>
                    <span>记录时长</span>
                    <strong>{formatDuration(heartRateRecordReport.durationMs)}</strong>
                  </div>
                  <div>
                    <span>平均心率</span>
                    <strong>{heartRateRecordReport.averageBpm} bpm</strong>
                  </div>
                  <div>
                    <span>最高心率</span>
                    <strong>{heartRateRecordReport.maxBpm} bpm</strong>
                  </div>
                  <div>
                    <span>最低心率</span>
                    <strong>{heartRateRecordReport.minBpm} bpm</strong>
                  </div>
                  <div>
                    <span>有效样本</span>
                    <strong>{heartRateRecordReport.sampleCount}</strong>
                  </div>
                  <div>
                    <span>心率波动</span>
                    <strong>{heartRateRecordReport.maxBpm - heartRateRecordReport.minBpm} bpm</strong>
                  </div>
                </div>

                <div className="report-chart" aria-label="本次纯享心率时间线">
                  {heartRateReportChart && (
                    <svg viewBox="0 0 1000 220" role="img">
                      <polyline className="report-chart-grid-line" points="0,55 1000,55" />
                      <polyline className="report-chart-grid-line" points="0,110 1000,110" />
                      <polyline className="report-chart-grid-line" points="0,165 1000,165" />
                      <polyline className="report-chart-line" points={heartRateReportChart.pathPoints} />
                      {heartRateReportChart.markerPoints.map((point) => (
                        <circle
                          className={`report-chart-marker ${point.isMax ? 'is-max' : ''} ${
                            point.isMin ? 'is-min' : ''
                          }`}
                          key={point.key}
                          cx={point.x}
                          cy={point.y}
                          r={point.isMax || point.isMin ? 7 : 4}
                        />
                      ))}
                    </svg>
                  )}
                </div>

                {heartRateReportInsights && (
                  <div className="report-insight-grid">
                    <div className="report-insight-card is-trend">
                      <span>趋势</span>
                      <strong>{heartRateReportInsights.trendLabel}</strong>
                      <small>{heartRateReportInsights.trendDetail}</small>
                    </div>
                    <div className="report-insight-card is-stability">
                      <span>稳定度</span>
                      <strong>{heartRateReportInsights.stabilityLabel}</strong>
                      <small>{heartRateReportInsights.stabilityDetail}</small>
                    </div>
                    <div className="report-insight-card is-density">
                      <span>采样</span>
                      <strong>{heartRateReportInsights.densityLabel}</strong>
                      <small>{heartRateReportInsights.densityDetail}</small>
                    </div>
                  </div>
                )}

                <div className="report-detail-grid">
                  <p className="report-meta">
                    <span>记录时间</span>
                    <strong>
                      {formatDateTime(heartRateRecordReport.startedAt)} -{' '}
                      {formatDateTime(heartRateRecordReport.endedAt)}
                    </strong>
                  </p>
                  <p className="report-meta">
                    <span>峰值位置</span>
                    <strong>{heartRateReportInsights?.peakDetail}</strong>
                  </p>
                </div>

                <div className="report-zone-panel">
                  <span>区间分布</span>
                  {heartRateReportZones.map((zone) => (
                    <div className="report-zone-row" key={zone.label}>
                      <small>{zone.label} bpm</small>
                      <div className="report-zone-track">
                        <span
                          style={{
                            width: `${Math.max(zone.percent, zone.count > 0 ? 4 : 0)}%`,
                            backgroundColor: zone.color
                          }}
                        />
                      </div>
                      <strong>{zone.percent}%</strong>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="report-empty-message">{heartRateRecordNotice}</p>
            )}

            {heartRateRecordNotice && heartRateRecordReport && (
              <p className="report-status-message">{heartRateRecordNotice}</p>
            )}

            <div className="report-actions">
              {heartRateRecordReport && (
                <button
                  className="secondary-button"
                  type="button"
                  disabled={isExportingHeartRateReport}
                  onClick={() => void handleExportHeartRateReportPng()}
                >
                  {isExportingHeartRateReport ? '正在导出...' : '导出 PNG'}
                </button>
              )}

              <button className="reset-button" type="button" onClick={handleCloseHeartRateReport}>
                关闭报告
              </button>
            </div>
          </div>
        </div>
      )}
      {isPureDisplay ? (
        <section className="pure-display-view no-drag">
          <div
            className={`display-background-frame pure-display-frame ${displayStylePresetClass} ${
              hasDisplayFrame ? 'has-display-frame' : ''
            } ${hasDisplayBackgroundImage ? 'has-display-background' : ''} ${displayBackgroundFitClass} ${displayFrameStateClass}`}
          >
            {renderDisplayBackgroundImageLayer()}
            <div
              ref={pureHeartRef}
              className={`pure-heart-row heart-display-row ${displayGlowClass} ${displayEffectClass}`}
              aria-label="按住拖动位置，双击退出纯享模式"
              onMouseDown={handlePureDisplayMouseDown}
              onMouseLeave={() => {
                const latestConfig = configRef.current

                if (latestConfig.pureDisplay) {
                  void window.heartdock.setHitTestPassthrough(true)
                }
              }}
              onDoubleClick={handlePureDisplayDoubleClick}
            >
              {config.prefixText && (
                <span className="heart prefix-text pure-heart" style={{ color: bpmColor }}>
                  {config.prefixText}
                </span>
              )}
              <span
                key={config.heartbeatPulseEnabled ? bpmPulseKey : 'pure-bpm'}
                className="bpm pure-bpm"
                style={{ color: bpmColor, fontSize: config.fontSize }}
              >
                {displayBpm}
              </span>
              {config.unitText && <span className="unit pure-unit">{config.unitText}</span>}
            </div>
          </div>
        </section>
      ) : (
        <section
          ref={overlayCardRef}
          className="overlay-card"
          style={{
            backgroundColor: config.showSettings
              ? '#0f172a'
              : `rgba(15, 23, 42, ${config.backgroundOpacity})`
          }}
        >
          <div className="top-row">
            <div className="brand-cluster no-drag">
              <span className="badge brand-badge">
                <span className="brand-mark">♥</span>
                <span>HeartDock</span>
              </span>
              <button
                className="icon-button top-row-update-button"
                type="button"
                title="手动检查更新"
                aria-label="手动检查更新"
                disabled={isManualUpdateCheck}
                onClick={() => void handleManualCheckForUpdates()}
              >
                ↻
              </button>
            </div>

            <div className="window-actions no-drag">
              <button
                className="icon-button appearance-toggle-button"
                type="button"
                title={appearanceMode === 'dark' ? '切换到日间模式' : '切换到黑夜模式'}
                aria-label={appearanceMode === 'dark' ? '切换到日间模式' : '切换到黑夜模式'}
                onClick={handleToggleAppearanceMode}
              >
                <span aria-hidden="true">{appearanceMode === 'dark' ? '☀' : '☾'}</span>
              </button>

              <button
                className="icon-button close-button"
                type="button"
                title="关闭 HeartDock"
                onClick={handleCloseWindow}
              >
                ×
              </button>
            </div>
          </div>

          <div
            className={`display-background-frame normal-display-frame ${displayStylePresetClass} ${
              hasDisplayFrame ? 'has-display-frame' : ''
            } ${hasDisplayBackgroundImage ? 'has-display-background' : ''} ${displayBackgroundFitClass} ${displayFrameStateClass}`}
          >
            {renderDisplayBackgroundImageLayer()}
            <div className={`heart-row heart-display-row ${displayGlowClass} ${displayEffectClass}`}>
              {config.prefixText && (
                <span className="heart prefix-text" style={{ color: bpmColor }}>
                  {config.prefixText}
                </span>
              )}
              <span
                key={config.heartbeatPulseEnabled ? bpmPulseKey : 'normal-bpm'}
                className="bpm"
                style={{ color: bpmColor, fontSize: config.fontSize }}
              >
                {displayBpm}
              </span>
              {config.unitText && <span className="unit">{config.unitText}</span>}
            </div>
          </div>

          {config.showSettings && (
            <div className="settings-panel no-drag">
              <div className="setting-field" data-tour-id="tour-source">
                <span className="field-label">
                  数据源
                  {renderHelpButton('选择心率数据来自模拟、手动输入还是标准 BLE 心率设备。')}
                </span>
                {renderCustomSelect(
                  'source-mode',
                  config.heartRateSourceMode,
                  sourceModeOptions,
                  handleSourceModeChange,
                  '选择心率数据源'
                )}
              </div>

              {config.heartRateSourceMode === 'mock' && (
                <div className="source-panel">
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => updateConfig('mockPaused', !config.mockPaused)}
                  >
                    {config.mockPaused ? '继续模拟心率' : '暂停模拟心率'}
                  </button>
                  <p className="hint">
                    模拟模式会按照刷新间隔自动生成心率，适合测试悬浮窗样式和颜色变化。
                  </p>
                </div>
              )}

              {config.heartRateSourceMode === 'manual' && (
                <label>
                  手动心率
                  <input
                    type="number"
                    min="30"
                    max="240"
                    step="1"
                    value={manualInput}
                    onChange={(event) => handleManualInputChange(event.target.value)}
                    onBlur={applyManualBpm}
                    onKeyDown={handleManualInputKeyDown}
                  />
                </label>
              )}

              {config.heartRateSourceMode === 'manual' && (
                <p className="hint">手动模式会固定显示输入的 bpm，适合调试样式或临时展示。范围：30 - 240。</p>
              )}

              {config.heartRateSourceMode === 'ble' && (
                <div className="source-panel">
                  <div className="ble-status-row">
                    <span>连接状态</span>
                    <strong>{getBleStatusText()}</strong>
                  </div>

                  {bleDeviceName && (
                    <div className="ble-status-row">
                      <span>设备名称</span>
                      <strong>{bleDeviceName}</strong>
                    </div>
                  )}

                  {bleStatus === 'connected' ? (
                    <button
                      className="secondary-button danger-button"
                      type="button"
                      onClick={() => void disconnectBleDevice('BLE 连接已手动关闭。')}
                    >
                      断开 BLE 连接
                    </button>
                  ) : hasBleReconnectDevice ? (
                    <>
                      <button
                        className="secondary-button"
                        type="button"
                        disabled={bleStatus === 'connecting'}
                        onClick={handleReconnectBleDevice}
                      >
                        {bleStatus === 'connecting' ? '正在重连...' : '重新连接上次设备'}
                      </button>

                      <button
                        className="secondary-button"
                        type="button"
                        disabled={bleStatus === 'connecting'}
                        onClick={handleConnectBleDevice}
                      >
                        选择其他心率设备
                      </button>
                    </>
                  ) : (
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={bleStatus === 'connecting'}
                      onClick={handleConnectBleDevice}
                    >
                      {bleStatus === 'connecting' ? '正在连接...' : '连接心率设备'}
                    </button>
                  )}

                  <p className="hint">{bleMessage}</p>
                </div>
              )}

              <div className="quick-options" data-tour-id="tour-pure">
                <label className="option-card">
                  <input
                    type="checkbox"
                    checked={config.alwaysOnTop}
                    onChange={(event) => updateConfig('alwaysOnTop', event.target.checked)}
                  />
                  <span className="option-content">
                    <span className="option-title">始终置顶</span>
                    <span className="option-desc">让 HeartDock 保持在其他窗口上方。</span>
                  </span>
                  <span className="option-switch" aria-hidden="true" />
                </label>

                <label className="option-card option-card-primary">
                  <input
                    type="checkbox"
                    checked={config.pureDisplay}
                    onChange={() => void handleTogglePureDisplay()}
                  />
                  <span className="option-content">
                    <span className="option-title">纯享显示模式</span>
                    <span className="option-desc">隐藏设置面板，只保留心率本体显示。</span>
                  </span>
                  <span className="option-switch" aria-hidden="true" />
                </label>
              </div>

              <div className="settings-section scene-preset-section">
                <div className="section-heading">
                  <span>快速应用预设</span>
                  <small>从下拉菜单选择常见场景视觉组合。应用前会确认，并可撤销上一次预设。</small>
                </div>

                <div className="scene-preset-picker">
                  <div className="setting-field">
                    <span className="field-label">场景预设</span>
                    {renderCustomSelect(
                      'scene-preset',
                      selectedScenePresetId,
                      scenePresetOptions,
                      setSelectedScenePresetId,
                      '选择场景预设'
                    )}
                  </div>

                  <div className="scene-preset-preview">
                    <span>
                      {scenePresets.find((preset) => preset.id === selectedScenePresetId)?.recommendedFor}
                    </span>
                    <strong>
                      {scenePresets.find((preset) => preset.id === selectedScenePresetId)?.label}
                    </strong>
                    <small>
                      {scenePresets.find((preset) => preset.id === selectedScenePresetId)?.description}
                    </small>
                  </div>
                </div>

                <div className="scene-preset-actions">
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={handleOpenScenePresetConfirm}
                  >
                    预览并应用
                  </button>

                  <button
                    className="reset-button"
                    type="button"
                    disabled={!canUndoScenePreset}
                    onClick={handleUndoScenePreset}
                  >
                    撤销上次预设
                  </button>
                </div>
              </div>

              <p className="hint">
                纯享模式下可以按住心率本体拖动位置，双击心率区域退出纯享模式。设置页面右下角的斜纹手柄可以拖动调整窗口大小。
              </p>

              <div className="settings-section" data-tour-id="tour-display">
                <div className="section-heading">
                  <span>
                    显示样式
                    {renderHelpButton('这些设置会改变普通模式和纯享模式中的心率文字外观。')}
                  </span>
                  <small>自定义心率前缀、单位、颜色和发光效果。</small>
                </div>

                <label>
                  前缀标识
                  <input
                    type="text"
                    maxLength={8}
                    value={config.prefixText}
                    placeholder="例如 ♥ / HR / 心率"
                    onChange={(event) => handlePrefixTextChange(event.target.value)}
                  />
                </label>

                <label>
                  单位文字
                  <input
                    type="text"
                    maxLength={8}
                    value={config.unitText}
                    placeholder="例如 bpm / BPM / 次/分"
                    onChange={(event) => handleUnitTextChange(event.target.value)}
                  />
                </label>


                <div className="setting-field">
                  <span className="field-label">颜色模式</span>
                  {renderCustomSelect(
                    'color-mode',
                    config.colorMode,
                    colorModeOptions,
                    (value) => updateConfig('colorMode', value),
                    '选择心率颜色模式'
                  )}
                </div>

                {config.colorMode === 'fixed' && (
                  <div className="setting-field">
                    <span className="field-label">固定颜色</span>
                    <details className="color-editor-details">
                      <summary>
                        <span className="summary-color-dot" style={{ backgroundColor: config.fixedColor }} />
                        <span>{config.fixedColor}</span>
                        <span className="summary-hint">展开编辑</span>
                      </summary>
                      {renderColorControl(config.fixedColor, handleFixedColorChange, '固定心率颜色')}
                    </details>
                  </div>
                )}

                <div className="setting-field">
                  <span className="field-label">发光强度</span>
                  {renderCustomSelect(
                    'glow-level',
                    config.glowLevel,
                    glowLevelOptions,
                    (value) => updateConfig('glowLevel', value),
                    '选择心率发光强度'
                  )}
                </div>

                <div className="color-rules-editor">
                  <div className="color-rules-header">
                    <span className="color-rules-title">区间颜色规则</span>
                    <small>范围限制为 30 - 240 bpm，点击每段可展开编辑。</small>
                  </div>

                  {config.colorRules.map((rule, index) => (
                    <details
                      key={`color-rule-${index}`}
                      className="color-rule-card"
                      open={openColorRuleIndexes.includes(index)}
                      onToggle={(event) => handleColorRuleToggle(index, event.currentTarget.open)}
                    >
                      <summary>
                        <span className="summary-color-dot" style={{ backgroundColor: rule.color }} />
                        <span>
                          {rule.min} - {rule.max} bpm
                        </span>
                        <span className="summary-hex">{rule.color}</span>
                      </summary>

                      <div className="color-rule-card-body">
                        <div className="color-rule-range-inputs">
                          <label>
                            下限
                            {renderRangeControl(
                              rule.min,
                              (value) => handleColorRuleRangeChange(index, 'min', value),
                              (delta) => handleColorRuleRangeStep(index, 'min', delta),
                              `${rule.min} 到 ${rule.max} bpm 的下限`
                            )}
                          </label>

                          <label>
                            上限
                            {renderRangeControl(
                              rule.max,
                              (value) => handleColorRuleRangeChange(index, 'max', value),
                              (delta) => handleColorRuleRangeStep(index, 'max', delta),
                              `${rule.min} 到 ${rule.max} bpm 的上限`
                            )}
                          </label>
                        </div>

                        {renderColorControl(
                          rule.color,
                          (color) => handleColorRuleColorChange(index, color),
                          `${rule.min} 到 ${rule.max} bpm 区间颜色`
                        )}
                      </div>
                    </details>
                  ))}
                </div>

                <p className="hint">
                  区间范围和颜色只在“跟随心率区间”模式下生效；固定颜色模式会始终使用同一种颜色。
                </p>
              </div>

              <div className="settings-section">
                <div className="section-heading">
                  <span>显示框样式</span>
                </div>

                <div className="setting-field">
                  <span className="field-label">显示样式</span>
                  {renderCustomSelect(
                    'display-style-preset',
                    config.displayStylePreset === 'image-card' ? 'none' : config.displayStylePreset,
                    displayStylePresetOptions,
                    (value) => updateConfig('displayStylePreset', value),
                    '选择心率显示框样式'
                  )}
                </div>

              </div>

              <div className="settings-section" data-tour-id="tour-dynamic">
                <div className="section-heading">
                  <span>
                    动态显示
                    {renderHelpButton('控制心率变化时的动画和提醒效果，关闭可降低视觉干扰和性能开销。')}
                  </span>
                  <small>控制心率数字更新、颜色过渡和提醒动画；动画会遵守系统减少动态效果设置。</small>
                </div>

                <div className="quick-options dynamic-options">
                  <label className="option-card">
                    <input
                      type="checkbox"
                      checked={config.heartbeatPulseEnabled}
                      onChange={(event) => updateConfig('heartbeatPulseEnabled', event.target.checked)}
                    />
                    <span className="option-content">
                      <span className="option-title">心跳缩放</span>
                      <span className="option-desc">BPM 更新时轻微弹动，默认保持克制。</span>
                    </span>
                    <span className="option-switch" aria-hidden="true" />
                  </label>

                  <label className="option-card">
                    <input
                      type="checkbox"
                      checked={config.smoothColorTransitionEnabled}
                      onChange={(event) =>
                        updateConfig('smoothColorTransitionEnabled', event.target.checked)
                      }
                    />
                    <span className="option-content">
                      <span className="option-title">颜色平滑过渡</span>
                      <span className="option-desc">心率区间变化时减少突兀跳色。</span>
                    </span>
                    <span className="option-switch" aria-hidden="true" />
                  </label>

                  <label className="option-card">
                    <input
                      type="checkbox"
                      checked={config.highHeartRateAlertEnabled}
                      onChange={(event) =>
                        updateConfig('highHeartRateAlertEnabled', event.target.checked)
                      }
                    />
                    <span className="option-content">
                      <span className="option-title">高心率提醒</span>
                      <span className="option-desc">超过阈值时边框轻微闪烁。</span>
                    </span>
                    <span className="option-switch" aria-hidden="true" />
                  </label>

                  <label className="option-card">
                    <input
                      type="checkbox"
                      checked={config.lowHeartRateBreathEnabled}
                      onChange={(event) =>
                        updateConfig('lowHeartRateBreathEnabled', event.target.checked)
                      }
                    />
                    <span className="option-content">
                      <span className="option-title">低心率呼吸</span>
                      <span className="option-desc">低心率区间显示更慢的呼吸感。</span>
                    </span>
                    <span className="option-switch" aria-hidden="true" />
                  </label>
                </div>

                <label>
                  高心率提醒阈值
                  {renderRangeControl(
                    config.highHeartRateAlertThreshold,
                    (value) => {
                      if (!value.trim()) {
                        return
                      }

                      updateConfig('highHeartRateAlertThreshold', normalizeBpm(Number(value)))
                    },
                    (delta) =>
                      updateConfig(
                        'highHeartRateAlertThreshold',
                        normalizeBpm(config.highHeartRateAlertThreshold + delta)
                      ),
                    '高心率提醒阈值'
                  )}
                </label>
              </div>

              <div className="settings-section" data-tour-id="tour-recording">
                <div className="section-heading">
                  <span>
                    纯享心率记录
                    {renderHelpButton('开启后只记录本次纯享会话，退出纯享时会打开独立报告窗口。')}
                  </span>
                  <small>开启后，进入纯享模式开始记录，退出纯享时显示本次报告，不保存历史。</small>
                </div>

                <label className="option-card option-card-primary">
                  <input
                    type="checkbox"
                    checked={config.heartRateRecordingEnabled}
                    onChange={(event) =>
                      updateConfig('heartRateRecordingEnabled', event.target.checked)
                    }
                  />
                  <span className="option-content">
                    <span className="option-title">记录纯享心率</span>
                    <span className="option-desc">
                      每秒采样一次有效 BPM，退出纯享后可导出 PNG 报告。
                    </span>
                  </span>
                  <span className="option-switch" aria-hidden="true" />
                </label>
              </div>

              <label>
                字体大小
                <input
                  type="range"
                  min="36"
                  max="96"
                  value={config.fontSize}
                  onChange={(event) => updateConfig('fontSize', Number(event.target.value))}
                />
              </label>

              <label>
                模拟心率刷新间隔 ms
                <div className="range-field refresh-interval-field" aria-label="模拟心率刷新间隔">
                  <input
                    className="range-value-input refresh-interval-input"
                    type="text"
                    inputMode="numeric"
                    value={refreshIntervalInput}
                    onChange={(event) => {
                      const nextValue = event.target.value.trim()

                      if (/^\d{0,5}$/.test(nextValue)) {
                        setRefreshIntervalInput(nextValue)
                      }
                    }}
                    onBlur={applyRefreshIntervalMs}
                    onKeyDown={handleRefreshIntervalKeyDown}
                  />

                  <div className="range-action-row refresh-interval-actions">
                    <button
                      className="range-action-button"
                      type="button"
                      aria-label="减少 250 毫秒"
                      onClick={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        handleRefreshIntervalStep(-250)
                      }}
                    >
                      −250
                    </button>

                    <button
                      className="range-action-button"
                      type="button"
                      aria-label="增加 250 毫秒"
                      onClick={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        handleRefreshIntervalStep(250)
                      }}
                    >
                      +250
                    </button>
                  </div>
                </div>
              </label>

              <p className="hint">
                刷新间隔只影响模拟心率模式；手动输入和 BLE 实时心率不按这个间隔刷新。
              </p>

              <div className="click-through-status">
                <span>鼠标禁止交互</span>
                <strong>{config.clickThrough ? '已开启' : '已关闭'}</strong>
              </div>

              <p className="hint">
                开启后，HeartDock 会拦截鼠标点击，不会操作 HeartDock，也不会点到底层窗口；需要再次操作时，请按 Ctrl + Shift + H 解锁。
              </p>

              <div className="settings-section" data-tour-id="tour-tools">
                <div className="section-heading">
                  <span>
                    工具与维护
                    {renderHelpButton('这里用于检查更新、导出诊断信息，以及备份或恢复配置。')}
                  </span>
                  <small>检查更新、导出诊断信息，或备份当前显示和数据源设置。</small>
                </div>

                <div className="config-file-actions">
                  <button
                    className="secondary-button compact-tool-button"
                    type="button"
                    onClick={() => void handleExportDiagnostics()}
                  >
                    导出诊断信息
                  </button>
                  <button
                    className="secondary-button compact-tool-button"
                    type="button"
                    onClick={() => void handleExportConfig()}
                  >
                    导出配置
                  </button>

                  <button
                    className="secondary-button compact-tool-button"
                    type="button"
                    onClick={() => void handleImportConfig()}
                  >
                    载入配置
                  </button>
                </div>

                <p className="hint">
                  载入配置时会自动关闭纯享模式和鼠标禁止交互；反馈问题时可以附带诊断信息文件。
                </p>
                {settingsNotice && <p className="settings-status-message">{settingsNotice}</p>}
              </div>

              <div className="project-links-panel">
                <div className="section-heading">
                  <span>项目与反馈</span>
                  <small>HeartDock 是完全免费、开源的桌面心率悬浮窗软件。</small>
                </div>

                <div className="project-link-grid">
                  <button
                    className="project-link-card"
                    type="button"
                    onClick={() => handleOpenExternalLink(SOURCE_CODE_URL)}
                  >
                    <span className="project-link-icon">⌘</span>
                    <span>
                      <strong>源代码 GitHub</strong>
                      <small>查看源码、Release 和项目进度。</small>
                    </span>
                  </button>

                  <button
                    className="project-link-card"
                    type="button"
                    onClick={() => handleOpenExternalLink(FEEDBACK_URL)}
                  >
                    <span className="project-link-icon">↗</span>
                    <span>
                      <strong>反馈 Bug / 期待功能</strong>
                      <small>打开 GitHub Issue 页面提交建议。</small>
                    </span>
                  </button>
                </div>

                <div className="project-maintenance-actions">
                  <button
                    className="secondary-button first-run-reset-button"
                    type="button"
                    onClick={handleShowFirstRunNoticeAgain}
                  >
                    重新查看首次启动说明
                  </button>
                  <button
                    className="secondary-button first-run-reset-button"
                    type="button"
                    onClick={handleShowOnboardingAgain}
                  >
                    重新打开新手引导
                  </button>
                  <button
                    className="reset-button first-run-reset-button"
                    type="button"
                    onClick={handleOpenResetConfigConfirm}
                  >
                    重置显示设置
                  </button>
                </div>
              </div>
            </div>
          )}
          <button
            className="resize-handle no-drag"
            type="button"
            aria-label="拖动调整窗口大小"
            title="拖动调整窗口大小"
            onMouseDown={(event) => void handleWindowResizeMouseDown(event)}
          >
            <span className="resize-handle-label">调整大小</span>
          </button>
        </section>
      )}
      {isOnboardingActive && currentOnboardingStep && (
        <div className="onboarding-layer no-drag" role="dialog" aria-modal="true">
          {onboardingRect && (
            <span
              className="onboarding-target-ring"
              style={{
                top: onboardingRect.top - 8,
                left: onboardingRect.left - 8,
                width: onboardingRect.width + 16,
                height: onboardingRect.height + 16
              }}
            />
          )}
          <section
            className="onboarding-card"
            style={
              onboardingRect
                ? {
                    top: Math.min(window.innerHeight - 232, onboardingRect.top + onboardingRect.height + 16),
                    left: Math.min(window.innerWidth - 360, Math.max(18, onboardingRect.left))
                  }
                : undefined
            }
          >
            <span className="onboarding-step-count">
              {onboardingStepIndex + 1} / {onboardingSteps.length}
            </span>
            <strong>{currentOnboardingStep.title}</strong>
            <p>{currentOnboardingStep.body}</p>
            <div className="onboarding-actions onboarding-actions-single">
              <button className="primary-button onboarding-next-button" type="button" onClick={handleOnboardingNext}>
                {onboardingStepIndex >= onboardingSteps.length - 1 ? '完成' : '下一步'}
              </button>
            </div>
          </section>
        </div>
      )}
      {shouldShowFirstRunNotice && (
        <div
          className={`first-run-notice-backdrop ${isFirstRunNoticeLeaving ? 'is-leaving' : ''}`}
          role="dialog"
          aria-modal="true"
        >
          <section ref={firstRunNoticeCardRef} className="first-run-notice-card">
            <button
              className="first-run-close-button"
              type="button"
              aria-label="关闭 HeartDock"
              title="关闭 HeartDock"
              onClick={handleCloseWindow}
            >
              ×
            </button>

            <div className="first-run-notice-badge">
              <span className="brand-mark">♥</span>
              <span>HeartDock</span>
            </div>

            <div className="first-run-notice-content">
              <h1>欢迎使用 HeartDock</h1>
              <p>
                HeartDock 是一个面向 Windows 的桌面心率悬浮窗工具，当前作为完全免费、开源的软件提供。
                你可以查看源代码、参与反馈，也可以提出你期待的新功能。
              </p>

              <p className="first-run-notice-developer">开发人员：HHS3188</p>

              <div className="first-run-ble-note">
                <strong>真实心率设备连接提示</strong>
                <p>
                  如果想读取真实心率，请确认手表、心率带或其他设备支持标准 BLE 心率广播，电脑支持蓝牙并已经打开。
                  进入主界面后，将数据源切换为“BLE 心率设备（实验）”，再点击连接心率设备即可选择设备。
                </p>
              </div>

              <div className="first-run-progress-shell" aria-hidden="true">
                <span style={{ width: `${Math.min(100, Math.max(0, firstRunNoticeProgress))}%` }} />
              </div>

              <div className="first-run-notice-link-grid">
                <button
                  className="first-run-notice-link-card"
                  type="button"
                  onClick={() => handleOpenExternalLink(SOURCE_CODE_URL)}
                >
                  <strong>源代码 GitHub</strong>
                  <small>{SOURCE_CODE_URL}</small>
                </button>

                <button
                  className="first-run-notice-link-card"
                  type="button"
                  onClick={() => handleOpenExternalLink(FEEDBACK_URL)}
                >
                  <strong>反馈 Bug / 期待功能</strong>
                  <small>{FEEDBACK_URL}</small>
                </button>
              </div>

              <p className="first-run-notice-hint">
                {firstRunNoticeMode === 'required'
                  ? `首次启动需要等待 ${FIRST_RUN_NOTICE_SECONDS} 秒后确认阅读。启动检查更新至少等待 ${STARTUP_UPDATE_GATE_SECONDS} 秒。`
                  : '欢迎回来。HeartDock 会先完成启动更新检查，再允许进入主界面。'}
              </p>

              <div className="startup-update-status">
                <span>
                  {startupGateSecondsLeft > 0
                    ? `启动检查中，${startupGateSecondsLeft} 秒后可继续`
                    : updateSummary.message || '启动检查已完成'}
                </span>
                <strong>
                  {updateSummary.status === 'checking'
                    ? '检查更新'
                    : updateSummary.status === 'available'
                      ? '有新版本'
                      : updateSummary.status === 'downloaded'
                        ? '已下载'
                        : '可进入'}
                </strong>
              </div>
            </div>

            <div className="first-run-notice-actions">
              {firstRunNoticeMode === 'required' ? (
                <>
                  <label
                    className={`notice-confirm-row ${
                      firstRunNoticeSecondsLeft > 0 || !canEnterFromStartup ? 'is-disabled' : ''
                    }`}
                  >
                    <input
                      type="checkbox"
                      disabled={firstRunNoticeSecondsLeft > 0 || !canEnterFromStartup}
                      checked={firstRunNoticeAccepted}
                      onChange={(event) => setFirstRunNoticeAccepted(event.target.checked)}
                    />
                    <span>
                      {!canEnterFromStartup
                        ? '请等待启动更新检查完成'
                        : firstRunNoticeSecondsLeft > 0
                        ? `请先阅读说明，${firstRunNoticeSecondsLeft} 秒后可确认`
                        : '我已详细阅读并理解以上说明'}
                    </span>
                  </label>

                  <button
                    className="primary-button first-run-enter-button"
                    type="button"
                    disabled={firstRunNoticeSecondsLeft > 0 || !firstRunNoticeAccepted || !canEnterFromStartup}
                    onClick={handleConfirmFirstRunNotice}
                  >
                    进入 HeartDock
                  </button>
                </>
              ) : (
                <button
                  className="primary-button first-run-enter-button"
                  type="button"
                  disabled={!canEnterFromStartup}
                  onClick={handleConfirmFirstRunNotice}
                >
                  进入 HeartDock
                </button>
              )}
            </div>
          </section>
        </div>
      )}

    </main>
  )
}

export default App
