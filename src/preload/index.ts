import { contextBridge, ipcRenderer } from 'electron'

interface HeartDockWindowBounds {
  x: number
  y: number
  width: number
  height: number
}

contextBridge.exposeInMainWorld('heartdock', {
  setAlwaysOnTop: (enabled: boolean) => ipcRenderer.invoke('overlay:set-always-on-top', enabled),
  setClickThrough: (enabled: boolean) => ipcRenderer.invoke('overlay:set-click-through', enabled),
  getClickThrough: () => ipcRenderer.invoke('overlay:get-click-through'),
  closeWindow: () => ipcRenderer.invoke('overlay:close-window'),
  getWindowBounds: () => ipcRenderer.invoke('overlay:get-window-bounds'),
  setWindowBounds: (bounds: HeartDockWindowBounds) =>
    ipcRenderer.invoke('overlay:set-window-bounds', bounds),
  moveWindowBy: (deltaX: number, deltaY: number) =>
    ipcRenderer.invoke('overlay:move-window-by', deltaX, deltaY),
  onClickThroughChanged: (callback: (enabled: boolean) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, enabled: boolean) => callback(enabled)
    ipcRenderer.on('overlay:click-through-changed', listener)

    return () => {
      ipcRenderer.removeListener('overlay:click-through-changed', listener)
    }
  }
})
