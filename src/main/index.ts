import { app, BrowserWindow, globalShortcut, ipcMain } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

interface WindowState {
  width: number
  height: number
  x?: number
  y?: number
}

let overlayWindow: BrowserWindow | null = null
let clickThrough = false

const DEFAULT_WINDOW_STATE: WindowState = {
  width: 760,
  height: 560
}

function getWindowStatePath(): string {
  return join(app.getPath('userData'), 'window-state.json')
}

function loadWindowState(): WindowState {
  const statePath = getWindowStatePath()

  if (!existsSync(statePath)) {
    return DEFAULT_WINDOW_STATE
  }

  try {
    const raw = readFileSync(statePath, 'utf-8')
    return {
      ...DEFAULT_WINDOW_STATE,
      ...JSON.parse(raw)
    }
  } catch {
    return DEFAULT_WINDOW_STATE
  }
}

function saveWindowState(): void {
  if (!overlayWindow) return

  const bounds = overlayWindow.getBounds()
  const state: WindowState = {
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y
  }

  writeFileSync(getWindowStatePath(), JSON.stringify(state, null, 2))
}

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

  overlayWindow.webContents.send('click-through-changed', value)
  overlayWindow.webContents.send('overlay:click-through-changed', value)
}

function registerIpcHandlers(): void {
  ipcMain.handle('overlay:set-always-on-top', (_event, value: boolean) => {
    return setOverlayAlwaysOnTop(value)
  })

  ipcMain.handle('overlay:set-click-through', (_event, value: boolean) => {
    return setOverlayClickThrough(value)
  })

  ipcMain.handle('overlay:get-click-through', () => {
    return clickThrough
  })

  ipcMain.handle('overlay:close-window', () => {
    overlayWindow?.close()
  })

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
  const windowState = loadWindowState()

  overlayWindow = new BrowserWindow({
    width: windowState.width,
    height: windowState.height,
    x: windowState.x,
    y: windowState.y,
    minWidth: 520,
    minHeight: 420,
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

  overlayWindow.on('resize', () => {
    saveWindowState()
  })

  overlayWindow.on('move', () => {
    saveWindowState()
  })

  overlayWindow.on('close', () => {
    saveWindowState()
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