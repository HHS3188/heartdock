import { useEffect, useMemo, useRef, useState } from 'react'
import { HeartDockConfig, loadConfig, saveConfig } from './config'
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

  return (
    <main className="app-shell">
      <section
        className="overlay-card"
        style={{
          backgroundColor: `rgba(15, 23, 42, ${config.backgroundOpacity})`
        }}
      >
        <div className="top-row">
          <span className="badge">MOCK</span>
          <button
            className="icon-button no-drag"
            type="button"
            title="Show or hide settings"
            onClick={() => updateConfig('showSettings', !config.showSettings)}
          >
            ⚙
          </button>
        </div>

        <div className="heart-row">
          <span className="heart" style={{ color: bpmColor }}>♥</span>
          <span className="bpm" style={{ color: bpmColor, fontSize: config.fontSize }}>
            {bpm}
          </span>
          <span className="unit">bpm</span>
        </div>

        {config.showSettings && (
          <div className="settings-panel no-drag">
            <label>
              Font size
              <input
                type="range"
                min="36"
                max="96"
                value={config.fontSize}
                onChange={(event) => updateConfig('fontSize', Number(event.target.value))}
              />
            </label>

            <label>
              Refresh ms
              <input
                type="number"
                min="250"
                step="250"
                value={config.refreshIntervalMs}
                onChange={(event) => updateConfig('refreshIntervalMs', Number(event.target.value))}
              />
            </label>

            <label>
              Background
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
              Always on top
            </label>

            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={config.clickThrough}
                onChange={(event) => updateConfig('clickThrough', event.target.checked)}
              />
              Click-through
            </label>

            <p className="hint">Click-through enabled? Press Ctrl + Shift + H to turn it off.</p>
          </div>
        )}
      </section>
    </main>
  )
}

export default App
