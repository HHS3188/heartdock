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
  HeartDockConfig,
  HeartRateSourceMode,
  ThemePresetId,
  applyThemePreset,
  createDefaultConfig,
  loadConfig,
  normalizeBpm,
  normalizeRefreshIntervalMs,
  saveConfig,
  themePresets
} from './config'
import { MockHeartRateSource } from './core/MockHeartRateSource'

type BleConnectionStatus = 'idle' | 'connecting' | 'connected' | 'failed'

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
  const rule = config.colorRules.find((item) => bpm >= item.min && bpm <= item.max)
  return rule?.color ?? '#ffffff'
}

function getSourceLabel(sourceMode: HeartRateSourceMode): string {
  if (sourceMode === 'manual') {
    return '手动'
  }

  if (sourceMode === 'ble') {
    return 'BLE'
  }

  return '模拟'
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

  const shouldShowBlePlaceholder =
    config.heartRateSourceMode === 'ble' && bleStatus !== 'connected'

  const displayBpm = shouldShowBlePlaceholder ? '--' : String(bpm)

  const bpmColor = useMemo(
    () => (shouldShowBlePlaceholder ? '#94a3b8' : getColorForBpm(bpm, config)),
    [bpm, config, shouldShowBlePlaceholder]
  )
  const currentTheme = useMemo(
    () => themePresets.find((theme) => theme.id === config.themePresetId) ?? themePresets[0],
    [config.themePresetId]
  )
  const isPureDisplay = config.pureDisplay

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
    if (config.pureDisplay) {
      return
    }

    window.heartdock.setClickThrough(config.clickThrough)
  }, [config.clickThrough, config.pureDisplay])

  useEffect(() => {
    if (!config.pureDisplay) {
      return
    }

    let isHeartInteractive = false

    const updatePureDisplayHitTest = (event: MouseEvent): void => {
      const rect = pureHeartRef.current?.getBoundingClientRect()

      if (!rect) {
        return
      }

      const isInsideHeart =
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom

      if (isInsideHeart === isHeartInteractive) {
        return
      }

      isHeartInteractive = isInsideHeart
      window.heartdock.setClickThrough(!isInsideHeart)
    }

    window.heartdock.setClickThrough(true)
    window.addEventListener('mousemove', updatePureDisplayHitTest)

    return () => {
      window.removeEventListener('mousemove', updatePureDisplayHitTest)
      window.heartdock.setClickThrough(config.clickThrough)
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

  const handleThemeChange = (themeId: ThemePresetId): void => {
    setConfig((current) => applyThemePreset(current, themeId))
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

    const handleMouseUp = (): void => {
      pureDragStateRef.current.isDragging = false

      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)

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

    const characteristic = event.target as BleCharacteristic | null
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
            ref={pureHeartRef}
            className="pure-heart-row"
            title="按住拖动位置，双击退出纯享模式"
            onMouseDown={handlePureDisplayMouseDown}
            onDoubleClick={handlePureDisplayDoubleClick}
            onMouseEnter={() => window.heartdock.setClickThrough(false)}
            onMouseLeave={() => {
              if (!pureDragStateRef.current.isDragging) {
                window.heartdock.setClickThrough(true)
              }
            }}
          >
            <span className="heart pure-heart" style={{ color: bpmColor }}>
              ♥
            </span>
            <span className="bpm pure-bpm" style={{ color: bpmColor, fontSize: config.fontSize }}>
              {displayBpm}
            </span>
            <span className="unit pure-unit">bpm</span>
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
            <span className="badge">{getSourceLabel(config.heartRateSourceMode)}</span>

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

          <div className="heart-row">
            <span className="heart" style={{ color: bpmColor }}>
              ♥
            </span>
            <span className="bpm" style={{ color: bpmColor, fontSize: config.fontSize }}>
              {displayBpm}
            </span>
            <span className="unit">bpm</span>
          </div>

          {config.showSettings && (
            <div className="settings-panel no-drag">
              <label>
                数据源
                <select
                  value={config.heartRateSourceMode}
                  onChange={(event) => handleSourceModeChange(event.target.value as HeartRateSourceMode)}
                >
                  <option value="mock">模拟心率</option>
                  <option value="manual">手动输入</option>
                  <option value="ble">BLE 心率设备（实验）</option>
                </select>
              </label>

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

              <label>
                主题预设
                <select
                  value={config.themePresetId}
                  onChange={(event) => handleThemeChange(event.target.value as ThemePresetId)}
                >
                  {themePresets.map((theme) => (
                    <option key={theme.id} value={theme.id}>
                      {theme.name}
                    </option>
                  ))}
                </select>
              </label>

              <p className="hint">{currentTheme.description}</p>

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
                <input
                  type="number"
                  min="250"
                  max="10000"
                  step="250"
                  value={refreshIntervalInput}
                  onChange={(event) => setRefreshIntervalInput(event.target.value)}
                  onBlur={applyRefreshIntervalMs}
                  onKeyDown={handleRefreshIntervalKeyDown}
                />
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
