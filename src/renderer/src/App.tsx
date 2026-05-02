import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
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
    initialConfigRef.current = loadConfig()
  }

  const sourceRef = useRef(new MockHeartRateSource())
  const sourceModeRef = useRef<HeartRateSourceMode>(initialConfigRef.current.heartRateSourceMode)
  const bleDeviceRef = useRef<BleDevice | null>(null)
  const bleCharacteristicRef = useRef<BleCharacteristic | null>(null)

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
  const [bleMessage, setBleMessage] = useState('尚未连接 BLE 心率设备。')

  const bpmColor = useMemo(() => getColorForBpm(bpm, config), [bpm, config])
  const currentTheme = useMemo(
    () => themePresets.find((theme) => theme.id === config.themePresetId) ?? themePresets[0],
    [config.themePresetId]
  )

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
    window.heartdock.setClickThrough(config.clickThrough)
  }, [config.clickThrough])

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
    setBleStatus('idle')
    setBleMessage('BLE 设备已断开连接。可以重新点击连接心率设备。')
    bleCharacteristicRef.current = null
    bleDeviceRef.current = null
  }, [])

  const disconnectBleDevice = useCallback(
    async (message = 'BLE 连接已关闭。'): Promise<void> => {
      const characteristic = bleCharacteristicRef.current
      const device = bleDeviceRef.current

      setBleStatus('idle')
      setBleDeviceName('')
      setBleMessage(message)

      if (characteristic) {
        characteristic.removeEventListener('characteristicvaluechanged', handleBleMeasurement)

        try {
          await characteristic.stopNotifications?.()
        } catch (error) {
          console.warn('[HeartDock] failed to stop BLE notifications:', error)
        }
      }

      if (device) {
        device.removeEventListener('gattserverdisconnected', handleBleDisconnected)

        try {
          if (device.gatt?.connected) {
            device.gatt.disconnect?.()
          }
        } catch (error) {
          console.warn('[HeartDock] failed to disconnect BLE device:', error)
        }
      }

      bleCharacteristicRef.current = null
      bleDeviceRef.current = null
    },
    [handleBleDisconnected, handleBleMeasurement]
  )

  const handleConnectBleDevice = async (): Promise<void> => {
    const bluetooth = (navigator as NavigatorWithBluetooth).bluetooth

    if (!bluetooth) {
      setBleStatus('failed')
      setBleDeviceName('')
      setBleMessage('当前环境不支持 Web Bluetooth。请确认 Electron / Chromium 环境和系统蓝牙支持。')
      return
    }

    try {
      await disconnectBleDevice('正在准备重新连接 BLE 心率设备。')

      setBleStatus('connecting')
      setBleMessage('正在请求 BLE 心率设备，请确保设备已开启心率广播或标准心率服务。')

      const device = await bluetooth.requestDevice({
        filters: [{ services: ['heart_rate'] }],
        optionalServices: ['heart_rate']
      })

      if (sourceModeRef.current !== 'ble') {
        return
      }

      bleDeviceRef.current = device
      setBleDeviceName(getBleDeviceDisplayName(device))
      setBleMessage('已选择设备，正在连接 GATT 服务。')

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

      bleCharacteristicRef.current = characteristic
      characteristic.addEventListener('characteristicvaluechanged', handleBleMeasurement)

      await characteristic.startNotifications()

      setBleStatus('connected')
      setBleMessage('已连接 BLE 心率设备，等待心率数据通知。')
    } catch (error) {
      if (sourceModeRef.current !== 'ble') {
        return
      }

      setBleStatus('failed')

      if (error instanceof Error) {
        setBleMessage(`BLE 连接失败：${error.message}`)
      } else {
        setBleMessage('BLE 连接失败：未知错误。')
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
      setBleMessage('尚未连接 BLE 心率设备。')
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

    setBpm(nextBpm)
    setManualInput(String(nextBpm))
    setRefreshIntervalInput(String(normalizeRefreshIntervalMs(nextConfig.refreshIntervalMs)))
    setConfig(nextConfig)
  }

  return (
    <main className="app-shell">
      <section
        className="overlay-card"
        style={{
          backgroundColor: `rgba(15, 23, 42, ${config.backgroundOpacity})`
        }}
      >
        <div className="top-row">
          <span className="badge">{getSourceLabel(config.heartRateSourceMode)}</span>

          <div className="window-actions no-drag">
            <button
              className="icon-button"
              type="button"
              title="显示或隐藏设置"
              onClick={() => updateConfig('showSettings', !config.showSettings)}
            >
              ⚙
            </button>

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
            {bpm}
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
              刷新间隔 ms
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

            <label>
              背景透明度
              <input
                type="range"
                min="0"
                max="0.8"
                step="0.02"
                value={config.backgroundOpacity}
                onChange={(event) => updateConfig('backgroundOpacity', Number(event.target.value))}
              />
            </label>

            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={config.alwaysOnTop}
                onChange={(event) => updateConfig('alwaysOnTop', event.target.checked)}
              />
              始终置顶
            </label>

            <div className="click-through-status">
              <span>点击穿透</span>
              <strong>{config.clickThrough ? '已开启' : '已关闭'}</strong>
            </div>

            <p className="hint">
              点击穿透开启后，鼠标会穿过悬浮窗，无法直接点击此窗口。请使用 Ctrl + Shift + H 开启或关闭点击穿透。
            </p>

            <button className="reset-button" type="button" onClick={handleResetConfig}>
              重置显示设置
            </button>
          </div>
        )}
      </section>
    </main>
  )
}

export default App
