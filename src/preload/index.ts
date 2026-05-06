import { contextBridge, ipcRenderer } from 'electron'

interface HeartDockWindowBounds {
  x: number
  y: number
  width: number
  height: number
}

interface DisplayBackgroundImageResult {
  assetFileName: string
  fileName: string
  url: string
}

interface ConfigFileOpenResult {
  content: string
  fileName: string
}

interface ConfigFileSaveResult {
  fileName: string
  filePath: string
}

interface HeartRateReportPngSaveResult {
  fileName: string
  filePath: string
}

contextBridge.exposeInMainWorld('heartdock', {
  setAlwaysOnTop: (enabled: boolean) => ipcRenderer.invoke('overlay:set-always-on-top', enabled),
  setPureDisplayTopmost: (enabled: boolean) =>
    ipcRenderer.invoke('overlay:set-pure-display-topmost', enabled),
  setClickThrough: (enabled: boolean) => ipcRenderer.invoke('overlay:set-click-through', enabled),
  setHitTestPassthrough: (enabled: boolean) =>
    ipcRenderer.invoke('overlay:set-hit-test-passthrough', enabled),
  getClickThrough: () => ipcRenderer.invoke('overlay:get-click-through'),
  closeWindow: () => ipcRenderer.invoke('overlay:close-window'),
  showStartupView: (): Promise<boolean> => ipcRenderer.invoke('overlay:show-startup-view'),
  enterMainView: (): Promise<boolean> => ipcRenderer.invoke('overlay:enter-main-view'),
  openExternal: (url: string): Promise<boolean> => ipcRenderer.invoke('overlay:open-external', url),
  getWindowBounds: () => ipcRenderer.invoke('overlay:get-window-bounds'),
  setWindowBounds: (bounds: HeartDockWindowBounds) =>
    ipcRenderer.invoke('overlay:set-window-bounds', bounds),
  moveWindowBy: (deltaX: number, deltaY: number) =>
    ipcRenderer.invoke('overlay:move-window-by', deltaX, deltaY),
  selectDisplayBackgroundImage: (): Promise<DisplayBackgroundImageResult | null> =>
    ipcRenderer.invoke('overlay:select-display-background-image'),
  exportConfigFile: (content: string): Promise<ConfigFileSaveResult | null> =>
    ipcRenderer.invoke('overlay:export-config-file', content),
  importConfigFile: (): Promise<ConfigFileOpenResult | null> =>
    ipcRenderer.invoke('overlay:import-config-file'),
  saveHeartRateReportPng: (
    contentBase64: string,
    defaultFileName: string
  ): Promise<HeartRateReportPngSaveResult | null> =>
    ipcRenderer.invoke('overlay:save-heart-rate-report-png', contentBase64, defaultFileName),
  onClickThroughChanged: (callback: (enabled: boolean) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, enabled: boolean) => callback(enabled)
    ipcRenderer.on('overlay:click-through-changed', listener)

    return () => {
      ipcRenderer.removeListener('overlay:click-through-changed', listener)
    }
  }
})
