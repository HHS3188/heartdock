import { app, BrowserWindow, dialog, globalShortcut, ipcMain, net, protocol, screen, shell, type OpenDialogOptions } from 'electron'
import electronUpdater, { type ProgressInfo, type UpdateInfo } from 'electron-updater'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { arch, platform, release } from 'node:os'
import { basename, extname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const { autoUpdater } = electronUpdater

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

interface HeartRateReportWindowPayload {
  report: unknown
  notice: string
  config: unknown
  versionLabel: string
  generatedAt: number
}

interface DiagnosticsExportResult {
  fileName: string
  filePath: string
}

interface UpdateSummary {
  status:
    | 'idle'
    | 'checking'
    | 'not-available'
    | 'available'
    | 'downloading'
    | 'downloaded'
    | 'error'
    | 'unsupported'
  currentVersion: string
  latestVersion: string
  releaseName: string
  releaseNotes: string[]
  releaseDate: string
  releasePageUrl: string
  isMajorUpdate: boolean
  progressPercent: number
  message: string
}

let overlayWindow: BrowserWindow | null = null
let heartRateReportWindow: BrowserWindow | null = null
let latestHeartRateReportPayload: HeartRateReportWindowPayload | null = null
let shouldRestoreOverlayAfterReportClose = false
let overlayAlwaysOnTop = true
let pureDisplayTopmost = false
let clickThrough = false
let hitTestPassthrough = false
let clickThroughHotkeyLocked = false
let clickThroughHotkeyUnlockTimer: ReturnType<typeof setTimeout> | null = null
let pureDisplayTopmostTimer: ReturnType<typeof setInterval> | null = null
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
  height: 820
}

const MAX_WINDOW_STATE: WindowState = {
  width: 1120,
  height: 820
}

const BACKGROUND_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif'])
const CONFIG_FILE_MAX_BYTES = 1024 * 1024
const HEART_RATE_REPORT_PNG_MAX_BYTES = 8 * 1024 * 1024
const DIAGNOSTICS_FILE_MAX_BYTES = 1024 * 1024
const PURE_DISPLAY_TOPMOST_REINFORCE_MS = 1200
const UPDATE_CHECK_TIMEOUT_MS = 8000
const WINDOW_CLAMP_HORIZONTAL_VISIBLE_RATIO = 0.1
const WINDOW_CLAMP_VERTICAL_VISIBLE_RATIO = 0.05
const HEART_RATE_REPORT_WINDOW_STATE: WindowState = {
  width: 960,
  height: 760
}
const RUNTIME_EVENT_LIMIT = 80

const runtimeEvents: string[] = []
let lastUpdateSummary: UpdateSummary = createUpdateSummary('idle')
let updateDownloadedReady = false

function isAllowedExternalUrl(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false
  }

  try {
    const parsedUrl = new URL(value)

    if (parsedUrl.protocol !== 'https:' || parsedUrl.hostname !== 'github.com') {
      return false
    }

    return (
      parsedUrl.pathname === '/HHS3188/heartdock' ||
      parsedUrl.pathname === '/HHS3188/heartdock/issues/new' ||
      parsedUrl.pathname === '/HHS3188/heartdock/releases' ||
      parsedUrl.pathname === '/HHS3188/heartdock/releases/latest' ||
      parsedUrl.pathname.startsWith('/HHS3188/heartdock/releases/tag/')
    )
  } catch {
    return false
  }
}

function recordRuntimeEvent(message: string): void {
  const timestamp = new Date().toISOString()
  runtimeEvents.push(`${timestamp} ${message}`)

  if (runtimeEvents.length > RUNTIME_EVENT_LIMIT) {
    runtimeEvents.splice(0, runtimeEvents.length - RUNTIME_EVENT_LIMIT)
  }
}

function getRecentRuntimeEvents(): string[] {
  return runtimeEvents.slice(-20)
}

function createUpdateSummary(status: UpdateSummary['status'], partial: Partial<UpdateSummary> = {}): UpdateSummary {
  return {
    status,
    currentVersion: app.getVersion(),
    latestVersion: '',
    releaseName: '',
    releaseNotes: [],
    releaseDate: '',
    releasePageUrl: 'https://github.com/HHS3188/heartdock/releases/latest',
    isMajorUpdate: false,
    progressPercent: 0,
    message: '',
    ...partial
  }
}

function getMajorVersion(value: string): number {
  const match = value.match(/^v?(\d+)/)
  return match ? Number(match[1]) : 0
}

function isMajorVersionUpdate(latestVersion: string): boolean {
  return getMajorVersion(latestVersion) >= 1 && getMajorVersion(latestVersion) > getMajorVersion(app.getVersion())
}

function stripReleaseNoteText(value: unknown): string {
  if (typeof value !== 'string') {
    return ''
  }

  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/[#*_`>-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function summarizeReleaseNotes(info: UpdateInfo): string[] {
  const releaseNotes = info.releaseNotes
  const rawNotes = Array.isArray(releaseNotes)
    ? releaseNotes.map((item) => stripReleaseNoteText(typeof item === 'string' ? item : item?.note))
    : stripReleaseNoteText(releaseNotes)
        .split(/\r?\n/)
        .map((line) => stripReleaseNoteText(line))

  const notes = rawNotes.filter(Boolean).slice(0, 3)

  return notes.length > 0 ? notes : ['包含稳定性修复和体验优化。']
}

function getReleasePageUrl(version: string): string {
  return version
    ? `https://github.com/HHS3188/heartdock/releases/tag/v${version.replace(/^v/, '')}`
    : 'https://github.com/HHS3188/heartdock/releases/latest'
}

function getUpdateSummaryFromInfo(status: UpdateSummary['status'], info: UpdateInfo): UpdateSummary {
  return createUpdateSummary(status, {
    latestVersion: info.version,
    releaseName: info.releaseName || `HeartDock v${info.version}`,
    releaseNotes: summarizeReleaseNotes(info),
    releaseDate: info.releaseDate || '',
    releasePageUrl: getReleasePageUrl(info.version),
    isMajorUpdate: isMajorVersionUpdate(info.version)
  })
}

function sendUpdateSummary(summary: UpdateSummary): UpdateSummary {
  lastUpdateSummary = summary

  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send('overlay:update-status-changed', summary)
  }

  return summary
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

function getConfigExportDefaultPath(): string {
  const now = new Date()
  const timestamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0')
  ].join('-')

  return join(app.getPath('documents'), `heartdock-config-${timestamp}.json`)
}

async function exportConfigFile(content: unknown): Promise<ConfigFileSaveResult | null> {
  if (typeof content !== 'string' || content.length === 0) {
    throw new Error('配置内容为空，无法导出。')
  }

  if (Buffer.byteLength(content, 'utf8') > CONFIG_FILE_MAX_BYTES) {
    throw new Error('配置内容过大，无法导出。')
  }

  const dialogOptions = {
    title: '导出 HeartDock 配置文件',
    defaultPath: getConfigExportDefaultPath(),
    filters: [
      {
        name: 'JSON 配置文件',
        extensions: ['json']
      }
    ]
  }

  const result = overlayWindow
    ? await dialog.showSaveDialog(overlayWindow, dialogOptions)
    : await dialog.showSaveDialog(dialogOptions)

  if (result.canceled || !result.filePath) {
    return null
  }

  writeFileSync(result.filePath, content, 'utf8')

  return {
    fileName: basename(result.filePath),
    filePath: result.filePath
  }
}

async function importConfigFile(): Promise<ConfigFileOpenResult | null> {
  const dialogOptions: OpenDialogOptions = {
    title: '载入 HeartDock 配置文件',
    properties: ['openFile'],
    filters: [
      {
        name: 'JSON 配置文件',
        extensions: ['json']
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

  if (extname(sourcePath).toLowerCase() !== '.json') {
    throw new Error('不支持的配置文件格式。请选择 .json 文件。')
  }

  const content = readFileSync(sourcePath, 'utf8')

  if (Buffer.byteLength(content, 'utf8') > CONFIG_FILE_MAX_BYTES) {
    throw new Error('配置文件过大，无法载入。')
  }

  return {
    content,
    fileName: basename(sourcePath)
  }
}

function getSafePngFileName(value: unknown): string {
  if (typeof value !== 'string') {
    return 'heartdock-heart-rate-report.png'
  }

  const safeName = basename(value)
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120)

  if (!safeName) {
    return 'heartdock-heart-rate-report.png'
  }

  return safeName.toLowerCase().endsWith('.png') ? safeName : `${safeName}.png`
}

async function saveHeartRateReportPng(
  contentBase64: unknown,
  defaultFileName: unknown,
  parentWindow: BrowserWindow | null = overlayWindow
): Promise<HeartRateReportPngSaveResult | null> {
  if (typeof contentBase64 !== 'string' || contentBase64.length === 0) {
    throw new Error('报告图片内容为空，无法导出。')
  }

  const content = contentBase64.replace(/^data:image\/png;base64,/, '')
  const imageBuffer = Buffer.from(content, 'base64')

  if (imageBuffer.length === 0) {
    throw new Error('报告图片内容无效，无法导出。')
  }

  if (imageBuffer.length > HEART_RATE_REPORT_PNG_MAX_BYTES) {
    throw new Error('报告图片过大，无法导出。')
  }

  const dialogOptions = {
    title: '导出 HeartDock 心率报告',
    defaultPath: join(app.getPath('pictures'), getSafePngFileName(defaultFileName)),
    filters: [
      {
        name: 'PNG 图片',
        extensions: ['png']
      }
    ]
  }

  const result = parentWindow && !parentWindow.isDestroyed()
    ? await dialog.showSaveDialog(parentWindow, dialogOptions)
    : await dialog.showSaveDialog(dialogOptions)

  if (result.canceled || !result.filePath) {
    return null
  }

  writeFileSync(result.filePath, imageBuffer)

  return {
    fileName: basename(result.filePath),
    filePath: result.filePath
  }
}

function getDiagnosticsExportDefaultPath(): string {
  const now = new Date()
  const timestamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0')
  ].join('-')

  return join(app.getPath('documents'), `heartdock-diagnostics-${timestamp}.json`)
}

async function exportDiagnostics(
  rendererSnapshot: unknown,
  parentWindow: BrowserWindow | null = overlayWindow
): Promise<DiagnosticsExportResult | null> {
  const payload = {
    app: 'HeartDock',
    exportedAt: new Date().toISOString(),
    appVersion: app.getVersion(),
    platform: {
      os: platform(),
      arch: arch(),
      release: release()
    },
    runtime: {
      electron: process.versions.electron,
      node: process.versions.node,
      chrome: process.versions.chrome
    },
    update: lastUpdateSummary,
    recentRuntimeEvents: getRecentRuntimeEvents(),
    rendererSnapshot
  }
  const content = JSON.stringify(payload, null, 2)

  if (Buffer.byteLength(content, 'utf8') > DIAGNOSTICS_FILE_MAX_BYTES) {
    throw new Error('诊断信息过大，无法导出。')
  }

  const dialogOptions = {
    title: '导出 HeartDock 诊断信息',
    defaultPath: getDiagnosticsExportDefaultPath(),
    filters: [
      {
        name: 'JSON 诊断信息',
        extensions: ['json']
      }
    ]
  }

  const result = parentWindow && !parentWindow.isDestroyed()
    ? await dialog.showSaveDialog(parentWindow, dialogOptions)
    : await dialog.showSaveDialog(dialogOptions)

  if (result.canceled || !result.filePath) {
    return null
  }

  writeFileSync(result.filePath, content, 'utf8')
  recordRuntimeEvent('diagnostics exported')

  return {
    fileName: basename(result.filePath),
    filePath: result.filePath
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

function clampWindowStateToVisibleWorkArea(state: WindowState): WindowState {
  const fallbackWorkArea = screen.getPrimaryDisplay().workArea
  const fallbackX = Math.round(fallbackWorkArea.x + (fallbackWorkArea.width - state.width) / 2)
  const fallbackY = Math.round(fallbackWorkArea.y + (fallbackWorkArea.height - state.height) / 2)
  const windowBounds: WindowBounds = {
    x: state.x ?? fallbackX,
    y: state.y ?? fallbackY,
    width: state.width,
    height: state.height
  }
  const targetDisplay =
    screen
      .getAllDisplays()
      .map((display) => ({
        display,
        visibleArea: getIntersectionArea(windowBounds, display.workArea)
      }))
      .sort((first, second) => second.visibleArea - first.visibleArea)[0]?.display ??
    screen.getPrimaryDisplay()
  const workArea = targetDisplay.workArea || fallbackWorkArea
  const maxX = workArea.x + workArea.width - state.width
  const maxY = workArea.y + workArea.height - state.height

  return {
    ...state,
    x: clampNumber(
      state.x ?? fallbackX,
      workArea.x,
      Math.max(workArea.x, maxX),
      Math.round(workArea.x + (workArea.width - state.width) / 2)
    ),
    y: clampNumber(
      state.y ?? fallbackY,
      workArea.y,
      Math.max(workArea.y, maxY),
      Math.round(workArea.y + (workArea.height - state.height) / 2)
    )
  }
}

function getMaxWindowSizeForWorkArea(workArea: Electron.Rectangle): Pick<WindowBounds, 'width' | 'height'> {
  return {
    width: Math.min(MAX_WINDOW_STATE.width, Math.max(MIN_WINDOW_STATE.width, workArea.width)),
    height: Math.min(MAX_WINDOW_STATE.height, Math.max(MIN_WINDOW_STATE.height, workArea.height))
  }
}

function clampWindowBoundsToVisibleWorkArea(bounds: WindowBounds, preserveSize = false): WindowBounds {
  const targetDisplay =
    screen
      .getAllDisplays()
      .map((display) => ({
        display,
        visibleArea: getIntersectionArea(bounds, display.workArea)
      }))
      .sort((first, second) => second.visibleArea - first.visibleArea)[0]?.display ??
    screen.getPrimaryDisplay()
  const workArea = targetDisplay.workArea
  const maxWindowSize = getMaxWindowSizeForWorkArea(workArea)
  const nextWidth = preserveSize
    ? Math.round(bounds.width)
    : clampNumber(bounds.width, MIN_WINDOW_STATE.width, maxWindowSize.width, DEFAULT_WINDOW_STATE.width)
  const nextHeight = preserveSize
    ? Math.round(bounds.height)
    : clampNumber(
        bounds.height,
        MIN_WINDOW_STATE.height,
        maxWindowSize.height,
        DEFAULT_WINDOW_STATE.height
      )
  const minVisibleWidth = Math.min(nextWidth, Math.max(1, nextWidth * WINDOW_CLAMP_HORIZONTAL_VISIBLE_RATIO))
  const minVisibleHeight = Math.min(nextHeight, Math.max(1, nextHeight * WINDOW_CLAMP_VERTICAL_VISIBLE_RATIO))
  const minX = workArea.x - nextWidth + minVisibleWidth
  const maxX = workArea.x + workArea.width - minVisibleWidth
  const minY = workArea.y - nextHeight + minVisibleHeight
  const maxY = workArea.y + workArea.height - minVisibleHeight

  return {
    x: clampNumber(bounds.x, minX, Math.max(minX, maxX), workArea.x),
    y: clampNumber(bounds.y, minY, Math.max(minY, maxY), workArea.y),
    width: nextWidth,
    height: nextHeight
  }
}

function hasWindowBoundsChanged(first: WindowBounds, second: WindowBounds): boolean {
  return (
    first.x !== second.x ||
    first.y !== second.y ||
    first.width !== second.width ||
    first.height !== second.height
  )
}

function clampBrowserWindowToVisibleWorkArea(
  window: BrowserWindow | null,
  afterClamp?: () => void,
  preserveSize = false
): boolean {
  if (!window || window.isDestroyed()) {
    return false
  }

  const bounds = window.getBounds()
  const nextBounds = clampWindowBoundsToVisibleWorkArea(bounds, preserveSize)
  const didChange = hasWindowBoundsChanged(bounds, nextBounds)

  if (didChange) {
    window.setBounds(nextBounds, false)
    afterClamp?.()
  }

  return didChange
}

function sanitizeWindowState(state: WindowState): WindowState {
  const normalizedSize = getNormalizedWindowSize(state)
  const normalizedState: WindowState = {
    ...state,
    ...normalizedSize
  }

  if (isWindowStateVisible(normalizedState)) {
    return clampWindowStateToVisibleWorkArea(normalizedState)
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

function getRendererUrlWithView(view: string): string {
  const rendererUrl = process.env.ELECTRON_RENDERER_URL || 'http://localhost:5173/'
  const parsedUrl = new URL(rendererUrl)
  parsedUrl.searchParams.set('view', view)

  return parsedUrl.toString()
}

function loadRenderer(window: BrowserWindow, view?: string): void {
  if (!app.isPackaged) {
    const rendererUrl = view ? getRendererUrlWithView(view) : process.env.ELECTRON_RENDERER_URL || 'http://localhost:5173/'
    console.log('[HeartDock] loading dev renderer:', rendererUrl)
    window.loadURL(rendererUrl)
    return
  }

  if (view) {
    window.loadFile(join(__dirname, '../renderer/index.html'), {
      query: { view }
    })
    return
  }

  window.loadFile(join(__dirname, '../renderer/index.html'))
}

function createHeartRateReportWindow(): BrowserWindow {
  const state = centerInPrimaryDisplay(
    HEART_RATE_REPORT_WINDOW_STATE.width,
    HEART_RATE_REPORT_WINDOW_STATE.height
  )

  const window = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: 860,
    minHeight: 680,
    title: 'HeartDock 心率记录报告',
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    autoHideMenuBar: true,
    show: false,
    icon: getApplicationIconPath(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      devTools: true
    }
  })

  window.once('ready-to-show', () => {
    window.show()
    window.focus()
  })

  window.on('closed', () => {
    heartRateReportWindow = null
    if (shouldRestoreOverlayAfterReportClose && overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.show()
      overlayWindow.focus()
    }
    shouldRestoreOverlayAfterReportClose = false
  })

  window.on('resize', () => {
    clampBrowserWindowToVisibleWorkArea(window, undefined, false)
  })

  window.on('move', () => {
    clampBrowserWindowToVisibleWorkArea(window, undefined, true)
  })

  loadRenderer(window, 'heart-rate-report')
  recordRuntimeEvent('heart rate report window opened')

  return window
}

function openHeartRateReportWindow(payload: HeartRateReportWindowPayload): boolean {
  latestHeartRateReportPayload = payload
  shouldRestoreOverlayAfterReportClose = Boolean(overlayWindow && !overlayWindow.isDestroyed())

  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.hide()
  }

  if (!heartRateReportWindow || heartRateReportWindow.isDestroyed()) {
    heartRateReportWindow = createHeartRateReportWindow()
    return true
  }

  heartRateReportWindow.webContents.send('overlay:heart-rate-report-payload-changed', payload)
  heartRateReportWindow.show()
  heartRateReportWindow.focus()
  return true
}

function closeHeartRateReportWindow(): void {
  if (heartRateReportWindow && !heartRateReportWindow.isDestroyed()) {
    heartRateReportWindow.close()
  }
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

function applyMouseIgnoreState(): void {
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    return
  }

  try {
    if (hitTestPassthrough) {
      overlayWindow.setIgnoreMouseEvents(true, { forward: true })
    } else {
      overlayWindow.setIgnoreMouseEvents(false)
    }
  } catch (error) {
    console.error('[HeartDock] failed to update click-through:', error)
  }
}

function stopPureDisplayTopmostTimer(): void {
  if (!pureDisplayTopmostTimer) {
    return
  }

  clearInterval(pureDisplayTopmostTimer)
  pureDisplayTopmostTimer = null
}

function reinforcePureDisplayTopmost(): void {
  if (!overlayAlwaysOnTop || !pureDisplayTopmost || !overlayWindow || overlayWindow.isDestroyed()) {
    return
  }

  try {
    overlayWindow.setAlwaysOnTop(true, 'screen-saver')
    overlayWindow.moveTop()
  } catch (error) {
    console.error('[HeartDock] failed to reinforce pure display topmost:', error)
  }
}

function updatePureDisplayTopmostTimer(): void {
  if (!overlayAlwaysOnTop || !pureDisplayTopmost) {
    stopPureDisplayTopmostTimer()
    return
  }

  if (pureDisplayTopmostTimer) {
    return
  }

  pureDisplayTopmostTimer = setInterval(reinforcePureDisplayTopmost, PURE_DISPLAY_TOPMOST_REINFORCE_MS)
}

function applyOverlayAlwaysOnTop(): void {
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    return
  }

  try {
    if (!overlayAlwaysOnTop) {
      overlayWindow.setAlwaysOnTop(false)
      return
    }

    if (pureDisplayTopmost) {
      overlayWindow.setAlwaysOnTop(true, 'screen-saver')
      overlayWindow.moveTop()
      return
    }

    overlayWindow.setAlwaysOnTop(true)
  } catch (error) {
    console.error('[HeartDock] failed to update always-on-top:', error)
  }
}

function setOverlayAlwaysOnTop(value: boolean): boolean {
  overlayAlwaysOnTop = value
  applyOverlayAlwaysOnTop()
  updatePureDisplayTopmostTimer()

  return value
}

function setPureDisplayTopmost(value: boolean): boolean {
  pureDisplayTopmost = value
  applyOverlayAlwaysOnTop()
  updatePureDisplayTopmostTimer()

  return value
}

function setOverlayClickThrough(value: boolean): boolean {
  if (value === clickThrough) {
    return value
  }

  clickThrough = value

  applyMouseIgnoreState()
  recordRuntimeEvent(`click-through set to ${value}`)
  return value
}

function setOverlayHitTestPassthrough(value: boolean): boolean {
  const nextValue = value

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

function configureAutoUpdater(): void {
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false

  autoUpdater.on('checking-for-update', () => {
    sendUpdateSummary(createUpdateSummary('checking', { message: '正在检查更新...' }))
    recordRuntimeEvent('checking for updates')
  })

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    updateDownloadedReady = false
    sendUpdateSummary(getUpdateSummaryFromInfo('available', info))
    recordRuntimeEvent(`update available: ${info.version}`)
  })

  autoUpdater.on('update-not-available', (info: UpdateInfo) => {
    updateDownloadedReady = false
    sendUpdateSummary(
      createUpdateSummary('not-available', {
        latestVersion: info.version || app.getVersion(),
        message: '当前已经是最新版本。'
      })
    )
    recordRuntimeEvent('update not available')
  })

  autoUpdater.on('download-progress', (progress: ProgressInfo) => {
    sendUpdateSummary(
      createUpdateSummary('downloading', {
        ...lastUpdateSummary,
        status: 'downloading',
        progressPercent: Math.max(0, Math.min(100, Math.round(progress.percent))),
        message: '正在下载更新...'
      })
    )
  })

  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    updateDownloadedReady = true
    sendUpdateSummary(
      createUpdateSummary('downloaded', {
        ...getUpdateSummaryFromInfo('downloaded', info),
        progressPercent: 100,
        message: '更新已下载，重启后安装。'
      })
    )
    recordRuntimeEvent(`update downloaded: ${info.version}`)
  })

  autoUpdater.on('error', (error) => {
    updateDownloadedReady = false
    sendUpdateSummary(
      createUpdateSummary('error', {
        message: error instanceof Error ? error.message : '检查更新失败。'
      })
    )
    recordRuntimeEvent(`update error: ${error instanceof Error ? error.message : String(error)}`)
  })
}

async function checkForUpdates(): Promise<UpdateSummary> {
  if (!app.isPackaged) {
    return sendUpdateSummary(
      createUpdateSummary('unsupported', {
        message: '开发模式不会自动下载更新，打包安装后可使用。'
      })
    )
  }

  sendUpdateSummary(createUpdateSummary('checking', { message: '正在检查更新...' }))

  try {
    const checkPromise = autoUpdater.checkForUpdates()
    const timeoutPromise = new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), UPDATE_CHECK_TIMEOUT_MS)
    })
    const result = await Promise.race([checkPromise, timeoutPromise])

    if (!result) {
      return sendUpdateSummary(
        createUpdateSummary('error', {
          message: '检查更新超时，请稍后在设置页手动检查。'
        })
      )
    }

    const info = result.updateInfo

    if (info.version && info.version !== app.getVersion()) {
      return sendUpdateSummary(getUpdateSummaryFromInfo('available', info))
    }

    return sendUpdateSummary(
      createUpdateSummary('not-available', {
        latestVersion: info.version || app.getVersion(),
        message: '当前已经是最新版本。'
      })
    )
  } catch (error) {
    return sendUpdateSummary(
      createUpdateSummary('error', {
        message: error instanceof Error ? error.message : '检查更新失败。'
      })
    )
  }
}

async function downloadUpdate(): Promise<UpdateSummary> {
  if (!app.isPackaged) {
    return sendUpdateSummary(
      createUpdateSummary('unsupported', {
        message: '开发模式不会自动下载更新，打包安装后可使用。'
      })
    )
  }

  try {
    sendUpdateSummary(
      createUpdateSummary('downloading', {
        ...lastUpdateSummary,
        status: 'downloading',
        message: '正在下载更新...'
      })
    )
    await autoUpdater.downloadUpdate()
    return lastUpdateSummary
  } catch (error) {
    return sendUpdateSummary(
      createUpdateSummary('error', {
        message: error instanceof Error ? error.message : '下载更新失败。'
      })
    )
  }
}

function installDownloadedUpdate(): boolean {
  if (!updateDownloadedReady) {
    return false
  }

  recordRuntimeEvent('installing downloaded update')
  autoUpdater.quitAndInstall(false, true)
  return true
}

function registerIpcHandlers(): void {
  ipcMain.handle('overlay:set-always-on-top', (_event, value: boolean) => {
    return setOverlayAlwaysOnTop(value)
  })

  ipcMain.handle('overlay:set-pure-display-topmost', (_event, value: boolean) => {
    return setPureDisplayTopmost(value)
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

  ipcMain.handle('overlay:check-for-updates', () => {
    return checkForUpdates()
  })

  ipcMain.handle('overlay:get-update-status', () => {
    return lastUpdateSummary
  })

  ipcMain.handle('overlay:download-update', () => {
    return downloadUpdate()
  })

  ipcMain.handle('overlay:install-update', () => {
    return installDownloadedUpdate()
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

  ipcMain.handle('overlay:export-config-file', (_event, content: unknown) => {
    return exportConfigFile(content)
  })

  ipcMain.handle('overlay:import-config-file', () => {
    return importConfigFile()
  })

  ipcMain.handle(
    'overlay:save-heart-rate-report-png',
    (event, contentBase64: unknown, defaultFileName: unknown) => {
      return saveHeartRateReportPng(
        contentBase64,
        defaultFileName,
        BrowserWindow.fromWebContents(event.sender)
      )
    }
  )

  ipcMain.handle('overlay:open-heart-rate-report-window', (_event, payload: HeartRateReportWindowPayload) => {
    return openHeartRateReportWindow(payload)
  })

  ipcMain.handle('overlay:get-heart-rate-report-payload', () => {
    return latestHeartRateReportPayload
  })

  ipcMain.handle('overlay:close-heart-rate-report-window', () => {
    closeHeartRateReportWindow()
  })

  ipcMain.handle('overlay:export-diagnostics', (event, rendererSnapshot: unknown) => {
    return exportDiagnostics(rendererSnapshot, BrowserWindow.fromWebContents(event.sender))
  })

  ipcMain.handle('overlay:move-window-by', (_event, deltaX: number, deltaY: number) => {
    if (!overlayWindow || overlayWindow.isDestroyed()) {
      return false
    }

    if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) {
      return false
    }

    const bounds = overlayWindow.getBounds()
    const nextBounds = clampWindowBoundsToVisibleWorkArea(
      {
        ...bounds,
        x: bounds.x + Math.round(deltaX),
        y: bounds.y + Math.round(deltaY)
      },
      true
    )

    overlayWindow.setBounds(nextBounds, false)

    scheduleSaveWindowState()

    return true
  })

  ipcMain.handle('overlay:clamp-window-to-visible-area', () => {
    return clampBrowserWindowToVisibleWorkArea(overlayWindow, scheduleSaveWindowState, true)
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

      const maxWindowSize = getMaxWindowSizeForWorkArea(screen.getPrimaryDisplay().workArea)

      const nextWidth = clampNumber(
        bounds.width,
        MIN_WINDOW_STATE.width,
        maxWindowSize.width,
        DEFAULT_WINDOW_STATE.width
      )
      const nextHeight = clampNumber(
        bounds.height,
        MIN_WINDOW_STATE.height,
        maxWindowSize.height,
        DEFAULT_WINDOW_STATE.height
      )
      const nextBounds = clampWindowBoundsToVisibleWorkArea(
        {
          x: Math.round(bounds.x),
          y: Math.round(bounds.y),
          width: nextWidth,
          height: nextHeight
        },
        true
      )

      overlayWindow.setBounds(nextBounds, false)
      scheduleSaveWindowState()

      return true
    }
  )

  ipcMain.handle('set-always-on-top', (_event, value: boolean) => {
    return setOverlayAlwaysOnTop(value)
  })

  ipcMain.handle('set-pure-display-topmost', (_event, value: boolean) => {
    return setPureDisplayTopmost(value)
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
    clampBrowserWindowToVisibleWorkArea(overlayWindow, scheduleSaveWindowState, false)
    scheduleSaveWindowState()
  })

  overlayWindow.on('move', () => {
    clampBrowserWindowToVisibleWorkArea(overlayWindow, scheduleSaveWindowState, true)
    scheduleSaveWindowState()
  })

  overlayWindow.on('close', () => {
    setPureDisplayTopmost(false)
    closeHeartRateReportWindow()
    flushWindowState()
  })

  loadRenderer(overlayWindow)

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
  configureAutoUpdater()
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
  stopPureDisplayTopmostTimer()
  globalShortcut.unregisterAll()
})
