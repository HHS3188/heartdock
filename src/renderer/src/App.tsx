import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
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
  createDefaultConfig,
  loadConfig,
  normalizeBpm,
  normalizeColor,
  normalizeDisplayBackgroundImageOpacity,
  normalizeDisplayText,
  normalizeRefreshIntervalMs,
  saveConfig
} from './config'
import { MockHeartRateSource } from './core/MockHeartRateSource'

type BleConnectionStatus = 'idle' | 'connecting' | 'connected' | 'failed'

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
  { value: 'kawaii', label: '二次元贴纸风', description: '粉蓝渐变、爱心和星星点缀，偏可爱风。' }
]

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

function App() {
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
  const normalWindowBoundsRef = useRef<HeartDockWindowBounds | null>(null)
  const pureDragStateRef = useRef({
    isDragging: false,
    lastScreenX: 0,
    lastScreenY: 0,
    totalDeltaX: 0,
    totalDeltaY: 0
  })

  const pureDragMovedRef = useRef(false)
  const windowResizeStateRef = useRef({
    isResizing: false,
    startScreenX: 0,
    startScreenY: 0,
    startBounds: null as HeartDockWindowBounds | null
  })

  const [bpm, setBpm] = useState(() => normalizeBpm(initialConfigRef.current?.manualBpm ?? 78))
  const [config, setConfig] = useState<HeartDockConfig>(() => initialConfigRef.current ?? loadConfig())
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

  const [openColorRuleIndexes, setOpenColorRuleIndexes] = useState<number[]>([])

  const [openSelectId, setOpenSelectId] = useState<string | null>(null)

  const shouldShowBlePlaceholder =
    config.heartRateSourceMode === 'ble' && bleStatus !== 'connected'

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

  useEffect(() => {
    sourceModeRef.current = config.heartRateSourceMode
  }, [config.heartRateSourceMode])

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
    if (config.pureDisplay && !config.clickThrough) {
      return
    }

    window.heartdock.setClickThrough(config.clickThrough)
  }, [config.clickThrough, config.pureDisplay])

  useEffect(() => {
    if (!config.pureDisplay || config.clickThrough) {
      return
    }

    const setTemporaryClickThrough = (enabled: boolean): void => {
      void window.heartdock.setClickThrough(enabled)
    }

    const updatePureHeartHitTest = (event: MouseEvent): void => {
      const rect = pureHeartRef.current?.getBoundingClientRect()

      if (!rect) {
        setTemporaryClickThrough(true)
        return
      }

      const isInsideHeart =
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom

      setTemporaryClickThrough(!isInsideHeart)
    }

    const handleWindowMouseLeave = (): void => {
      setTemporaryClickThrough(true)
    }

    setTemporaryClickThrough(true)
    window.addEventListener('mousemove', updatePureHeartHitTest)
    window.addEventListener('mouseleave', handleWindowMouseLeave)

    return () => {
      window.removeEventListener('mousemove', updatePureHeartHitTest)
      window.removeEventListener('mouseleave', handleWindowMouseLeave)
      void window.heartdock.setClickThrough(config.clickThrough)
    }
  }, [config.clickThrough, config.pureDisplay])

  useEffect(() => {
    const unsubscribe = window.heartdock.onClickThroughChanged((enabled) => {
      setConfig((current) => ({ ...current, clickThrough: enabled }))
    })

    return unsubscribe
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
    if (pureDragMovedRef.current) {
      return
    }

    void handleTogglePureDisplay()
  }

  const handlePureDisplayMouseDown = (event: ReactMouseEvent<HTMLDivElement>): void => {
    if (event.button !== 0) {
      return
    }

    event.preventDefault()

    pureDragStateRef.current = {
      isDragging: true,
      lastScreenX: event.screenX,
      lastScreenY: event.screenY,
      totalDeltaX: 0,
      totalDeltaY: 0
    }

    window.heartdock.setClickThrough(false)

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

      void window.heartdock.moveWindowBy(deltaX, deltaY)
    }

    const handleMouseUp = (upEvent: MouseEvent): void => {
      pureDragStateRef.current.isDragging = false

      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)

      if (config.pureDisplay && !config.clickThrough) {
        const rect = pureHeartRef.current?.getBoundingClientRect()
        const isInsideHeart = Boolean(
          rect &&
            upEvent.clientX >= rect.left &&
            upEvent.clientX <= rect.right &&
            upEvent.clientY >= rect.top &&
            upEvent.clientY <= rect.bottom
        )

        void window.heartdock.setClickThrough(!isInsideHeart)
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
      startBounds: bounds
    }

    const handleMouseMove = (moveEvent: MouseEvent): void => {
      const resizeState = windowResizeStateRef.current

      if (!resizeState.isResizing || !resizeState.startBounds) {
        return
      }

      const deltaX = moveEvent.screenX - resizeState.startScreenX
      const deltaY = moveEvent.screenY - resizeState.startScreenY

      const nextBounds: HeartDockWindowBounds = {
        ...resizeState.startBounds,
        width: resizeState.startBounds.width + deltaX,
        height: resizeState.startBounds.height + deltaY
      }

      void window.heartdock.setWindowBounds(nextBounds)
    }

    const handleMouseUp = (): void => {
      windowResizeStateRef.current.isResizing = false
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

  const handleResetConfig = (): void => {
    const confirmed = window.confirm('确定要重置所有显示设置吗？')

    if (!confirmed) return

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

  return (
    <main className={`app-shell ${isPureDisplay ? 'pure-display-shell' : ''}`}>
      {isPureDisplay ? (
        <section className="pure-display-view no-drag">
          <div
            className={`display-background-frame pure-display-frame ${displayStylePresetClass} ${
              hasDisplayFrame ? 'has-display-frame' : ''
            } ${hasDisplayBackgroundImage ? 'has-display-background' : ''} ${displayBackgroundFitClass}`}
          >
            {renderDisplayBackgroundImageLayer()}
            <div
              ref={pureHeartRef}
              className={`pure-heart-row heart-display-row ${displayGlowClass}`}
              aria-label="按住拖动位置，双击退出纯享模式"
              onMouseDown={handlePureDisplayMouseDown}
              onMouseLeave={() => {
                if (config.pureDisplay && !config.clickThrough) {
                  void window.heartdock.setClickThrough(true)
                }
              }}
              onDoubleClick={handlePureDisplayDoubleClick}
            >
              {config.prefixText && (
                <span className="heart prefix-text pure-heart" style={{ color: bpmColor }}>
                  {config.prefixText}
                </span>
              )}
              <span className="bpm pure-bpm" style={{ color: bpmColor, fontSize: config.fontSize }}>
                {displayBpm}
              </span>
              {config.unitText && <span className="unit pure-unit">{config.unitText}</span>}
            </div>
          </div>
        </section>
      ) : (
        <section
          className="overlay-card"
          style={{
            backgroundColor: config.showSettings
              ? '#0f172a'
              : `rgba(15, 23, 42, ${config.backgroundOpacity})`
          }}
        >
          <div className="top-row">
            <span className="badge brand-badge">
              <span className="brand-mark">♥</span>
              <span>HeartDock</span>
            </span>

            <div className="window-actions no-drag">
              <button
                className="icon-button close-button"
                type="button"
                title="关闭 HeartDock"
                onClick={() => window.heartdock.closeWindow()}
              >
                ×
              </button>
            </div>
          </div>

          <div
            className={`display-background-frame normal-display-frame ${displayStylePresetClass} ${
              hasDisplayFrame ? 'has-display-frame' : ''
            } ${hasDisplayBackgroundImage ? 'has-display-background' : ''} ${displayBackgroundFitClass}`}
          >
            {renderDisplayBackgroundImageLayer()}
            <div className={`heart-row heart-display-row ${displayGlowClass}`}>
              {config.prefixText && (
                <span className="heart prefix-text" style={{ color: bpmColor }}>
                  {config.prefixText}
                </span>
              )}
              <span className="bpm" style={{ color: bpmColor, fontSize: config.fontSize }}>
                {displayBpm}
              </span>
              {config.unitText && <span className="unit">{config.unitText}</span>}
            </div>
          </div>

          {config.showSettings && (
            <div className="settings-panel no-drag">
              <div className="setting-field">
                <span className="field-label">数据源</span>
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

              <div className="quick-options">
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

              <p className="hint">
                纯享模式下可以按住心率本体拖动位置，双击心率区域退出纯享模式。设置页面右下角的斜纹手柄可以拖动调整窗口大小。
              </p>

              <div className="settings-section">
                <div className="section-heading">
                  <span>显示样式</span>
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
                <span>鼠标穿透交互</span>
                <strong>{config.clickThrough ? '已开启' : '已关闭'}</strong>
              </div>

              <p className="hint">
                开启后，鼠标点击会穿过 HeartDock，直接操作下方窗口；需要再次操作 HeartDock 时，请按 Ctrl + Shift + H 关闭。
              </p>

              <button className="reset-button" type="button" onClick={handleResetConfig}>
                重置显示设置
              </button>
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
    </main>
  )
}

export default App