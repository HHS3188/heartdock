import { app, BrowserWindow, globalShortcut, ipcMain } from 'electron'
import { join } from 'node:path'

let overlayWindow: BrowserWindow | null = null
let clickThrough = false

function setOverlayAlwaysOnTop(value: boolean): boolean {
  overlayWindow?.setAlwaysOnTop(value)
  return value
}

function setOverlayClickThrough(value: boolean): boolean {
  clickThrough = value
  overlayWindow?.setIgnoreMouseEvents(value, { forward: true })
  return value
}

function notifyClickThroughChanged(value: boolean): void {
  if (!overlayWindow) return

  // 兼容可能存在的新旧事件名
  overlayWindow.webContents.send('click-through-changed', value)
  overlayWindow.webContents.send('overlay:click-through-changed', value)
}

function registerIpcHandlers(): void {
  // 当前 renderer / preload 正在调用的新通道名
  ipcMain.handle('overlay:set-always-on-top', (_event, value: boolean) => {
    return setOverlayAlwaysOnTop(value)
  })

  ipcMain.handle('overlay:set-click-through', (_event, value: boolean) => {
    return setOverlayClickThrough(value)
  })

  ipcMain.handle('overlay:get-click-through', () => {
    return clickThrough
  })

  // 兼容旧通道名，防止前面代码残留
  ipcMain.handle('set-always-on-top', (_event, value: boolean) => {
    return setOverlayAlwaysOnTop(value)
  })

  ipcMain.handle('set-click-through', (_event, value: boolean) => {
    return setOverlayClickThrough(value)
  })

  ipcMain.handle('get-click-through', () => {
    return clickThrough
  })
}

function createOverlayWindow(): void {
  overlayWindow = new BrowserWindow({
    width: 520,
    height: 320,
    minWidth: 320,
    minHeight: 180,
    frame: false,
    transparent: false,
    backgroundColor: '#202124',
    alwaysOnTop: true,
    resizable: true,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      devTools: true
    }
  })

  overlayWindow.once('ready-to-show', () => {
    overlayWindow?.show()
    overlayWindow?.focus()
  })

  overlayWindow.webContents.on('did-finish-load', () => {
    console.log('[HeartDock] renderer loaded')
  })

  overlayWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error('[HeartDock] renderer failed to load:', errorCode, errorDescription, validatedURL)
  })

  const rendererUrl = process.env.ELECTRON_RENDERER_URL || 'http://localhost:5173/'

  if (!app.isPackaged) {
    console.log('[HeartDock] loading dev renderer:', rendererUrl)
    overlayWindow.loadURL(rendererUrl)
  } else {
    overlayWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  overlayWindow.on('closed', () => {
    overlayWindow = null
  })
}

app.whenReady().then(() => {
  registerIpcHandlers()
  createOverlayWindow()

  globalShortcut.register('CommandOrControl+Shift+H', () => {
    const nextValue = !clickThrough
    setOverlayClickThrough(nextValue)
    notifyClickThroughChanged(nextValue)

    console.log('[HeartDock] click-through:', nextValue)
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createOverlayWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})