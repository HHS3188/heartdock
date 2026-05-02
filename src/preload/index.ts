import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('heartdock', {
  setAlwaysOnTop: (enabled: boolean) => ipcRenderer.invoke('overlay:set-always-on-top', enabled),
  setClickThrough: (enabled: boolean) => ipcRenderer.invoke('overlay:set-click-through', enabled),
  getClickThrough: () => ipcRenderer.invoke('overlay:get-click-through'),
  closeWindow: () => ipcRenderer.invoke('overlay:close-window'),
  onClickThroughChanged: (callback: (enabled: boolean) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, enabled: boolean) => callback(enabled)
    ipcRenderer.on('overlay:click-through-changed', listener)

    return () => {
      ipcRenderer.removeListener('overlay:click-through-changed', listener)
    }
  }
})