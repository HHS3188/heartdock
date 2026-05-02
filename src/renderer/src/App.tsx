import { useEffect, useMemo, useRef, useState } from 'react'
import {
  HeartDockConfig,
  ThemePresetId,
  applyThemePreset,
  loadConfig,
  saveConfig,
  themePresets
} from './config'
import { MockHeartRateSource } from './core/MockHeartRateSource'

function getColorForBpm(bpm: number, config: HeartDockConfig): string {
  const rule = config.colorRules.find((item) => bpm >= item.min && bpm <= item.max)
  return rule?.color ?? '#ffffff'
}

function App() {
  const sourceRef = useRef(new MockHeartRateSource())
  const [bpm, setBpm] = useState(78)
  const [config, setConfig] = useState<HeartDockConfig>(() => loadConfig())

  const bpmColor = useMemo(() => getColorForBpm(bpm, config), [bpm, config])
  const currentTheme = useMemo(
    () => themePresets.find((theme) => theme.id === config.themePresetId) ?? themePresets[0],
    [config.themePresetId]
  )

  useEffect(() => {
    saveConfig(config)
  }, [config])

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
    const timer = window.setInterval(() => {
      setBpm(sourceRef.current.next())
    }, config.refreshIntervalMs)

    return () => window.clearInterval(timer)
  }, [config.refreshIntervalMs])

  const updateConfig = <K extends keyof HeartDockConfig>(key: K, value: HeartDockConfig[K]): void => {
    setConfig((current) => ({ ...current, [key]: value }))
  }

  const handleThemeChange = (themeId: ThemePresetId): void => {
    setConfig((current) => applyThemePreset(current, themeId))
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
          <span className="badge">模拟</span>
          <button
            className="icon-button no-drag"
            type="button"
            title="显示或隐藏设置"
            onClick={() => updateConfig('showSettings', !config.showSettings)}
          >
            ⚙
          </button>
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
          </div>
        )}
      </section>
    </main>
  )
}

export default App