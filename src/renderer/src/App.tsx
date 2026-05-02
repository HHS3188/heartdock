import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import {
  HeartDockConfig,
  HeartRateSourceMode,
  ThemePresetId,
  applyThemePreset,
  createDefaultConfig,
  loadConfig,
  normalizeBpm,
  saveConfig,
  themePresets
} from './config'
import { MockHeartRateSource } from './core/MockHeartRateSource'

type BleConnectionStatus = 'idle' | 'connecting' | 'connected' | 'failed'

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

function App() {
  const initialConfigRef = useRef<HeartDockConfig | null>(null)

  if (initialConfigRef.current === null) {
    initialConfigRef.current = loadConfig()
  }

  const sourceRef = useRef(new MockHeartRateSource())
  const [bpm, setBpm] = useState(() => normalizeBpm(initialConfigRef.current?.manualBpm ?? 78))
  const [config, setConfig] = useState<HeartDockConfig>(() => initialConfigRef.current ?? loadConfig())
  const [manualInput, setManualInput] = useState(() =>
    String(normalizeBpm(initialConfigRef.current?.manualBpm ?? 78))
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
    saveConfig(config)
  }, [config])

  useEffect(() => {
    setManualInput(String(normalizeBpm(config.manualBpm)))
  }, [config.manualBpm])

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

    const timer = window.setInterval(() => {
      setBpm(sourceRef.current.next())
    }, config.refreshIntervalMs)

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

  const handleConnectBleDevice = (): void => {
    setBleStatus('failed')
    setBleDeviceName('')
    setBleMessage('BLE 连接功能将在下一步接入 Web Bluetooth。当前版本已先预留连接入口和状态显示。')
  }

  const handleSourceModeChange = (sourceMode: HeartRateSourceMode): void => {
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

  const handleResetConfig = (): void => {
    const confirmed = window.confirm('确定要重置所有显示设置吗？')

    if (!confirmed) return

    const nextConfig = createDefaultConfig()
    const nextBpm = normalizeBpm(nextConfig.manualBpm)

    setBpm(nextBpm)
    setManualInput(String(nextBpm))
    setBleStatus('idle')
    setBleDeviceName('')
    setBleMessage('尚未连接 BLE 心率设备。')
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

                <button
                  className="secondary-button"
                  type="button"
                  disabled={bleStatus === 'connecting'}
                  onClick={handleConnectBleDevice}
                >
                  {bleStatus === 'connecting' ? '正在连接...' : '连接心率设备'}
                </button>

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
                step="250"
                value={config.refreshIntervalMs}
                onChange={(event) => updateConfig('refreshIntervalMs', Number(event.target.value))}
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