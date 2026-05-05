import { app, BrowserWindow, dialog, globalShortcut, ipcMain, net, protocol, screen, shell, type OpenDialogOptions } from 'electron'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

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

interface DisplayBackgroundImageResult {
  assetFileName: string
  fileName: string
  url: string
}

let overlayWindow: BrowserWindow | null = null
let clickThrough = false
let hitTestPassthrough = false
let clickThroughHotkeyLocked = false
let clickThroughHotkeyUnlockTimer: ReturnType<typeof setTimeout> | null = null
let isStartupView = true
let saveWindowStateTimer: ReturnType<typeof setTimeout> | null = null
let bluetoothSelectionTimer: ReturnType<typeof setTimeout> | null = null

const MIN_WINDOW_STATE: WindowState = {
  width: 720,
  height: 680
}

const DEFAULT_WINDOW_STATE: WindowState = {
  width: 1080,
  height: 860
}

const STARTUP_WINDOW_STATE: WindowState = {
  width: 1120,
  height: 920
}

const MAX_WINDOW_STATE: WindowState = {
  width: 1440,
  height: 1080
}

const BACKGROUND_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif'])

const ALLOWED_EXTERNAL_URLS = new Set([
  'https://github.com/HHS3188/heartdock',
  'https://github.com/HHS3188/heartdock/issues/new'
])

function isAllowedExternalUrl(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false
  }

  try {
    const parsedUrl = new URL(value)

    return parsedUrl.protocol === 'https:' && ALLOWED_EXTERNAL_URLS.has(parsedUrl.toString())
  } catch {
    return false
  }
}


protocol.registerSchemesAsPrivileged([
  {
    scheme: 'heartdock',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      bypassCSP: true,
      stream: true
    }
  }
])

function getWindowStatePath(): string {
  return join(app.getPath('userData'), 'window-state.json')
}

function getApplicationIconPath(): string | undefined {
  const iconPath = join(app.getAppPath(), 'build', 'icon.ico')

  return existsSync(iconPath) ? iconPath : undefined
}

function getAssetDirectory(): string {
  return join(app.getPath('userData'), 'assets')
}

function getDisplayBackgroundImageUrl(assetFileName: string): string {
  return 'heartdock://asset/' + encodeURIComponent(assetFileName)
}

function isSupportedBackgroundImagePath(filePath: string): boolean {
  return BACKGROUND_IMAGE_EXTENSIONS.has(extname(filePath).toLowerCase())
}

function getSafeAssetFileName(filePath: string): string {
  const extension = extname(filePath).toLowerCase()
  const rawName = basename(filePath, extension)
  const safeName =
    rawName
      .replace(/[^a-zA-Z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'background'

  return safeName + '-' + Date.now() + extension
}

function registerHeartDockProtocol(): void {
  protocol.handle('heartdock', (request) => {
    const parsedUrl = new URL(request.url)

    if (parsedUrl.hostname !== 'asset') {
      return new Response('Not found', { status: 404 })
    }

    const assetFileName = decodeURIComponent(parsedUrl.pathname.replace(/^\/+/, ''))

    if (
      !assetFileName ||
      basename(assetFileName) !== assetFileName ||
      !BACKGROUND_IMAGE_EXTENSIONS.has(extname(assetFileName).toLowerCase())
    ) {
      return new Response('Bad request', { status: 400 })
    }

    const filePath = join(getAssetDirectory(), assetFileName)

    if (!existsSync(filePath)) {
      return new Response('Not found', { status: 404 })
    }

    return net.fetch(pathToFileURL(filePath).toString())
  })
}

async function selectDisplayBackgroundImage(): Promise<DisplayBackgroundImageResult | null> {
  const dialogOptions: OpenDialogOptions = {
    title: '选择心率背景图片',
    properties: ['openFile'],
    filters: [
      {
        name: '图片文件',
        extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif']
      }
    ]
  }

  const result = overlayWindow
    ? await dialog.showOpenDialog(overlayWindow, dialogOptions)
    : await dialog.showOpenDialog(dialogOptions)

  if (result.canceled || !result.filePaths[0]) {
    return null
  }

  const sourcePath = result.filePaths[0]

  if (!isSupportedBackgroundImagePath(sourcePath)) {
    throw new Error('不支持的图片格式。请选择 png、jpg、jpeg、webp 或 gif 图片。')
  }

  const assetDirectory = getAssetDirectory()
  mkdirSync(assetDirectory, { recursive: true })

  const assetFileName = getSafeAssetFileName(sourcePath)
  const targetPath = join(assetDirectory, assetFileName)

  copyFileSync(sourcePath, targetPath)

  return {
    assetFileName,
    fileName: basename(sourcePath),
    url: getDisplayBackgroundImageUrl(assetFileName)
  }
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return fallback
  }

  return Math.min(Math.max(Math.round(value), min), max)
}

function getNormalizedWindowSize(state: WindowState): Pick<WindowState, 'width' | 'height'> {
  const primaryWorkArea = screen.getPrimaryDisplay().workArea
  const maxWindowWidth = Math.min(
    MAX_WINDOW_STATE.width,
    Math.max(MIN_WINDOW_STATE.width, primaryWorkArea.width)
  )
  const maxWindowHeight = Math.min(
    MAX_WINDOW_STATE.height,
    Math.max(MIN_WINDOW_STATE.height, primaryWorkArea.height)
  )

  return {
    width: clampNumber(
      state.width,
      MIN_WINDOW_STATE.width,
      maxWindowWidth,
      DEFAULT_WINDOW_STATE.width
    ),
    height: clampNumber(
      state.height,
      MIN_WINDOW_STATE.height,
      maxWindowHeight,
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

function getStartupWindowState(): WindowState {
  const primaryWorkArea = screen.getPrimaryDisplay().workArea
  const width = clampNumber(
    STARTUP_WINDOW_STATE.width,
    MIN_WINDOW_STATE.width,
    Math.min(MAX_WINDOW_STATE.width, Math.max(MIN_WINDOW_STATE.width, primaryWorkArea.width)),
    STARTUP_WINDOW_STATE.width
  )
  const height = clampNumber(
    STARTUP_WINDOW_STATE.height,
    MIN_WINDOW_STATE.height,
    Math.min(MAX_WINDOW_STATE.height, Math.max(MIN_WINDOW_STATE.height, primaryWorkArea.height)),
    STARTUP_WINDOW_STATE.height
  )

  return centerInPrimaryDisplay(width, height)
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
  if (isStartupView) return

  const state = getCurrentWindowState()

  if (!state) return

  try {
    writeFileSync(getWindowStatePath(), JSON.stringify(state, null, 2), 'utf-8')
  } catch (error) {
    console.error('[HeartDock] failed to save window state:', error)
  }
}

function scheduleSaveWindowState(): void {
  if (isStartupView) return

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

function showStartupViewAndUseFixedSize(): boolean {
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    return false
  }

  isStartupView = true

  if (saveWindowStateTimer) {
    clearTimeout(saveWindowStateTimer)
    saveWindowStateTimer = null
  }

  const startupWindowState = getStartupWindowState()

  overlayWindow.setBounds(
    {
      width: startupWindowState.width,
      height: startupWindowState.height,
      x: startupWindowState.x,
      y: startupWindowState.y
    },
    false
  )

  return true
}

function enterMainViewAndRestoreWindowState(): boolean {
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    return false
  }

  isStartupView = false

  const windowState = loadWindowState()
  overlayWindow.setBounds(
    {
      width: windowState.width,
      height: windowState.height,
      x: windowState.x,
      y: windowState.y
    },
    false
  )

  return true
}

function setOverlayAlwaysOnTop(value: boolean): boolean {
  overlayWindow?.setAlwaysOnTop(value)
  return value
}

function applyMouseIgnoreState(): void {
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    return
  }

  try {
    if (!clickThrough && hitTestPassthrough) {
      overlayWindow.setIgnoreMouseEvents(true, { forward: true })
    } else {
      overlayWindow.setIgnoreMouseEvents(false)
    }
  } catch (error) {
    console.error('[HeartDock] failed to update click-through:', error)
  }
}

function setOverlayClickThrough(value: boolean): boolean {
  if (value === clickThrough) {
    return value
  }

  clickThrough = value

  if (clickThrough) {
    hitTestPassthrough = false
  }

  applyMouseIgnoreState()
  return value
}

function setOverlayHitTestPassthrough(value: boolean): boolean {
  const nextValue = clickThrough ? false : value

  if (nextValue === hitTestPassthrough) {
    return nextValue
  }

  hitTestPassthrough = nextValue
  applyMouseIgnoreState()

  return nextValue
}

function notifyClickThroughChanged(value: boolean): void {
  if (!overlayWindow) return

  overlayWindow.webContents.send('click-through-changed', value)
  overlayWindow.webContents.send('overlay:click-through-changed', value)
}

function animateOverlayWindowOpacity(from: number, to: number, durationMs: number): void {
  const window = overlayWindow

  if (!window || window.isDestroyed()) {
    return
  }

  const startedAt = Date.now()
  const frameMs = 16
  const distance = to - from

  window.setOpacity(from)

  const timer = setInterval(() => {
    if (!window || window.isDestroyed()) {
      clearInterval(timer)
      return
    }

    const progress = Math.min((Date.now() - startedAt) / durationMs, 1)
    const easedProgress = 1 - Math.pow(1 - progress, 3)

    window.setOpacity(from + distance * easedProgress)

    if (progress >= 1) {
      window.setOpacity(to)
      clearInterval(timer)
    }
  }, frameMs)
}

function registerIpcHandlers(): void {
  ipcMain.handle('overlay:set-always-on-top', (_event, value: boolean) => {
    return setOverlayAlwaysOnTop(value)
  })

  ipcMain.handle('overlay:set-click-through', (_event, value: boolean) => {
    return setOverlayClickThrough(value)
  })

  ipcMain.handle('overlay:set-hit-test-passthrough', (_event, value: boolean) => {
    return setOverlayHitTestPassthrough(value)
  })

  ipcMain.handle('overlay:get-click-through', () => {
    return clickThrough
  })

  ipcMain.handle('overlay:close-window', () => {
    overlayWindow?.close()
  })

  ipcMain.handle('overlay:open-external', async (_event, url: string) => {
    if (!isAllowedExternalUrl(url)) {
      return false
    }

    await shell.openExternal(url)
    return true
  })

  ipcMain.handle('overlay:show-startup-view', () => {
    return showStartupViewAndUseFixedSize()
  })

  ipcMain.handle('overlay:enter-main-view', () => {
    return enterMainViewAndRestoreWindowState()
  })

  ipcMain.handle('overlay:select-display-background-image', () => {
    return selectDisplayBackgroundImage()
  })

  ipcMain.handle('overlay:move-window-by', (_event, deltaX: number, deltaY: number) => {
    if (!overlayWindow || overlayWindow.isDestroyed()) {
      return false
    }

    if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) {
      return false
    }

    const bounds = overlayWindow.getBounds()

    overlayWindow.setBounds(
      {
        ...bounds,
        x: bounds.x + Math.round(deltaX),
        y: bounds.y + Math.round(deltaY)
      },
      false
    )

    scheduleSaveWindowState()

    return true
  })

  ipcMain.handle('overlay:get-window-bounds', () => {
    if (!overlayWindow || overlayWindow.isDestroyed()) {
      return null
    }

    return overlayWindow.getBounds()
  })

  ipcMain.handle(
    'overlay:set-window-bounds',
    (_event, bounds: { x: number; y: number; width: number; height: number }) => {
      if (!overlayWindow || overlayWindow.isDestroyed()) {
        return false
      }

      if (
        !Number.isFinite(bounds.x) ||
        !Number.isFinite(bounds.y) ||
        !Number.isFinite(bounds.width) ||
        !Number.isFinite(bounds.height)
      ) {
        return false
      }

      const primaryWorkArea = screen.getPrimaryDisplay().workArea
      const maxWindowWidth = Math.min(
        MAX_WINDOW_STATE.width,
        Math.max(MIN_WINDOW_STATE.width, primaryWorkArea.width)
      )
      const maxWindowHeight = Math.min(
        MAX_WINDOW_STATE.height,
        Math.max(MIN_WINDOW_STATE.height, primaryWorkArea.height)
      )

      const nextBounds = {
        x: Math.round(bounds.x),
        y: Math.round(bounds.y),
        width: clampNumber(bounds.width, MIN_WINDOW_STATE.width, maxWindowWidth, DEFAULT_WINDOW_STATE.width),
        height: clampNumber(bounds.height, MIN_WINDOW_STATE.height, maxWindowHeight, DEFAULT_WINDOW_STATE.height)
      }

      overlayWindow.setBounds(nextBounds, false)
      scheduleSaveWindowState()

      return true
    }
  )

  ipcMain.handle('set-always-on-top', (_event, value: boolean) => {
    return setOverlayAlwaysOnTop(value)
  })

  ipcMain.handle('set-click-through', (_event, value: boolean) => {
    return setOverlayClickThrough(value)
  })

  ipcMain.handle('set-hit-test-passthrough', (_event, value: boolean) => {
    return setOverlayHitTestPassthrough(value)
  })

  ipcMain.handle('get-click-through', () => {
    return clickThrough
  })
}

function unlockClickThroughHotkey(): void {
  if (clickThroughHotkeyUnlockTimer) {
    clearTimeout(clickThroughHotkeyUnlockTimer)
    clickThroughHotkeyUnlockTimer = null
  }

  clickThroughHotkeyLocked = false
}

function scheduleClickThroughHotkeyUnlock(): void {
  if (clickThroughHotkeyUnlockTimer) {
    clearTimeout(clickThroughHotkeyUnlockTimer)
  }

  clickThroughHotkeyUnlockTimer = setTimeout(() => {
    clickThroughHotkeyUnlockTimer = null
    clickThroughHotkeyLocked = false
  }, 1200)
}

function createOverlayWindow(): void {
  isStartupView = true
  const startupWindowState = getStartupWindowState()

  overlayWindow = new BrowserWindow({
    width: startupWindowState.width,
    height: startupWindowState.height,
    x: startupWindowState.x,
    y: startupWindowState.y,
    minWidth: MIN_WINDOW_STATE.width,
    minHeight: MIN_WINDOW_STATE.height,
    maxWidth: MAX_WINDOW_STATE.width,
    maxHeight: MAX_WINDOW_STATE.height,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    alwaysOnTop: true,
    resizable: true,
    show: false,
    autoHideMenuBar: true,
    icon: getApplicationIconPath(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      devTools: true
    }
  })

  overlayWindow.setOpacity(0)

  overlayWindow.once('ready-to-show', () => {
    overlayWindow?.show()
    overlayWindow?.focus()
    animateOverlayWindowOpacity(0, 1, 160)
  })

  overlayWindow.webContents.on('did-finish-load', () => {
    console.log('[HeartDock] renderer loaded')
  })

  overlayWindow.webContents.on('select-bluetooth-device', (event, deviceList, callback) => {
    event.preventDefault()

    const selectedDevice = deviceList.find((device) => Boolean(device.deviceName)) ?? deviceList[0]

    if (selectedDevice) {
      if (bluetoothSelectionTimer) {
        clearTimeout(bluetoothSelectionTimer)
        bluetoothSelectionTimer = null
      }

      console.log(
        '[HeartDock] selected BLE device:',
        selectedDevice.deviceName || selectedDevice.deviceId
      )

      callback(selectedDevice.deviceId)
      return
    }

    if (bluetoothSelectionTimer) {
      return
    }

    bluetoothSelectionTimer = setTimeout(() => {
      bluetoothSelectionTimer = null
      console.log('[HeartDock] no BLE heart rate device found, cancelling bluetooth selection')
      callback('')
    }, 8000)
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
  if (process.platform === 'win32') {
    app.setAppUserModelId('dev.heartdock.app')
  }

  registerHeartDockProtocol()
  registerIpcHandlers()
  createOverlayWindow()

  globalShortcut.register('CommandOrControl+Shift+H', () => {
    if (clickThroughHotkeyLocked) {
      scheduleClickThroughHotkeyUnlock()
      return
    }

    clickThroughHotkeyLocked = true
    scheduleClickThroughHotkeyUnlock()

    const nextValue = !clickThrough
    const applied = setOverlayClickThrough(nextValue)
    if (applied === nextValue) {
      notifyClickThroughChanged(nextValue)
      console.log('[HeartDock] click-through:', nextValue)
    }
  })

  if (overlayWindow) {
    overlayWindow.webContents.on('before-input-event', (_event, input) => {
      if (input.type === 'keyUp' && (input.key === 'Control' || input.key === 'Shift' || input.key === 'h' || input.key === 'H')) {
        unlockClickThroughHotkey()
      }
    })
  }

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
  unlockClickThroughHotkey()
  globalShortcut.unregisterAll()
})
