import { app, BrowserWindow, globalShortcut, ipcMain, screen } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

interface WindowState {
  width: number
  height: number
  x?: number
  y?: number
}

interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
}

let overlayWindow: BrowserWindow | null = null
let clickThrough = false
let saveWindowStateTimer: ReturnType<typeof setTimeout> | null = null

const MIN_WINDOW_STATE: WindowState = {
  width: 520,
  height: 420
}

const DEFAULT_WINDOW_STATE: WindowState = {
  width: 760,
  height: 560
}

function getWindowStatePath(): string {
  return join(app.getPath('userData'), 'window-state.json')
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return fallback
  }

  return Math.min(Math.max(Math.round(value), min), max)
}

function getNormalizedWindowSize(state: WindowState): Pick<WindowState, 'width' | 'height'> {
  const primaryWorkArea = screen.getPrimaryDisplay().workArea

  return {
    width: clampNumber(
      state.width,
      MIN_WINDOW_STATE.width,
      Math.max(MIN_WINDOW_STATE.width, primaryWorkArea.width),
      DEFAULT_WINDOW_STATE.width
    ),
    height: clampNumber(
      state.height,
      MIN_WINDOW_STATE.height,
      Math.max(MIN_WINDOW_STATE.height, primaryWorkArea.height),
      DEFAULT_WINDOW_STATE.height
    )
  }
}

function centerInPrimaryDisplay(width: number, height: number): WindowState {
  const primaryWorkArea = screen.getPrimaryDisplay().workArea

  return {
    width,
    height,
    x: Math.round(primaryWorkArea.x + (primaryWorkArea.width - width) / 2),
    y: Math.round(primaryWorkArea.y + (primaryWorkArea.height - height) / 2)
  }
}

function getIntersectionArea(first: WindowBounds, second: WindowBounds): number {
  const left = Math.max(first.x, second.x)
  const top = Math.max(first.y, second.y)
  const right = Math.min(first.x + first.width, second.x + second.width)
  const bottom = Math.min(first.y + first.height, second.y + second.height)

  const width = Math.max(0, right - left)
  const height = Math.max(0, bottom - top)

  return width * height
}

function isWindowStateVisible(state: WindowState): boolean {
  if (typeof state.x !== 'number' || typeof state.y !== 'number') {
    return false
  }

  const windowBounds: WindowBounds = {
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height
  }

  return screen.getAllDisplays().some((display) => {
    const visibleArea = getIntersectionArea(windowBounds, display.workArea)
    const minimumVisibleArea = Math.min(120, state.width) * Math.min(80, state.height)

    return visibleArea >= minimumVisibleArea
  })
}

function sanitizeWindowState(state: WindowState): WindowState {
  const normalizedSize = getNormalizedWindowSize(state)
  const normalizedState: WindowState = {
    ...state,
    ...normalizedSize
  }

  if (isWindowStateVisible(normalizedState)) {
    return normalizedState
  }

  return centerInPrimaryDisplay(normalizedSize.width, normalizedSize.height)
}

function loadWindowState(): WindowState {
  const statePath = getWindowStatePath()

  if (!existsSync(statePath)) {
    return centerInPrimaryDisplay(DEFAULT_WINDOW_STATE.width, DEFAULT_WINDOW_STATE.height)
  }

  try {
    const raw = readFileSync(statePath, 'utf-8')
    const parsedState = JSON.parse(raw) as WindowState

    return sanitizeWindowState({
      ...DEFAULT_WINDOW_STATE,
      ...parsedState
    })
  } catch {
    return centerInPrimaryDisplay(DEFAULT_WINDOW_STATE.width, DEFAULT_WINDOW_STATE.height)
  }
}

function getCurrentWindowState(): WindowState | null {
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    return null
  }

  const bounds = overlayWindow.getBounds()

  return {
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y
  }
}

function saveWindowStateSync(): void {
  const state = getCurrentWindowState()

  if (!state) return

  try {
    writeFileSync(getWindowStatePath(), JSON.stringify(state, null, 2), 'utf-8')
  } catch (error) {
    console.error('[HeartDock] failed to save window state:', error)
  }
}

function scheduleSaveWindowState(): void {
  if (saveWindowStateTimer) {
    clearTimeout(saveWindowStateTimer)
  }

  saveWindowStateTimer = setTimeout(() => {
    saveWindowStateTimer = null
    saveWindowStateSync()
  }, 300)
}

function flushWindowState(): void {
  if (saveWindowStateTimer) {
    clearTimeout(saveWindowStateTimer)
    saveWindowStateTimer = null
  }

  saveWindowStateSync()
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
    minWidth: MIN_WINDOW_STATE.width,
    minHeight: MIN_WINDOW_STATE.height,
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
  
  overlayWindow.webContents.on('select-bluetooth-device', (event, deviceList, callback) => {
  event.preventDefault()

  const selectedDevice = deviceList.find((device) => Boolean(device.deviceName)) ?? deviceList[0]

  if (!selectedDevice) {
    return
  }

  console.log(
    '[HeartDock] selected BLE device:',
    selectedDevice.deviceName || selectedDevice.deviceId
  )

  callback(selectedDevice.deviceId)
})

  overlayWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error('[HeartDock] renderer failed to load:', errorCode, errorDescription, validatedURL)
  })

  overlayWindow.on('resize', () => {
    scheduleSaveWindowState()
  })

  overlayWindow.on('move', () => {
    scheduleSaveWindowState()
  })

  overlayWindow.on('close', () => {
    flushWindowState()
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