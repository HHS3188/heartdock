/// <reference types="vite/client" />

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

interface HeartDockApi {
  setAlwaysOnTop: (enabled: boolean) => Promise<boolean>
  setPureDisplayTopmost: (enabled: boolean) => Promise<boolean>
  setClickThrough: (enabled: boolean) => Promise<boolean>
  setHitTestPassthrough: (enabled: boolean) => Promise<boolean>
  getClickThrough: () => Promise<boolean>
  closeWindow: () => Promise<void>
  showStartupView: () => Promise<boolean>
  enterMainView: () => Promise<boolean>
  openExternal: (url: string) => Promise<boolean>
  checkForUpdates: () => Promise<UpdateSummary>
  getUpdateStatus: () => Promise<UpdateSummary>
  downloadUpdate: () => Promise<UpdateSummary>
  installUpdate: () => Promise<boolean>
  getWindowBounds: () => Promise<HeartDockWindowBounds | null>
  setWindowBounds: (bounds: HeartDockWindowBounds) => Promise<boolean>
  moveWindowBy: (deltaX: number, deltaY: number) => Promise<boolean>
  clampWindowToVisibleArea: () => Promise<boolean>
  selectDisplayBackgroundImage: () => Promise<DisplayBackgroundImageResult | null>
  exportConfigFile: (content: string) => Promise<ConfigFileSaveResult | null>
  importConfigFile: () => Promise<ConfigFileOpenResult | null>
  saveHeartRateReportPng: (
    contentBase64: string,
    defaultFileName: string
  ) => Promise<HeartRateReportPngSaveResult | null>
  openHeartRateReportWindow: (payload: unknown) => Promise<boolean>
  getHeartRateReportPayload: () => Promise<unknown | null>
  closeHeartRateReportWindow: () => Promise<void>
  exportDiagnostics: (snapshot: unknown) => Promise<DiagnosticsExportResult | null>
  onUpdateStatusChanged: (callback: (summary: UpdateSummary) => void) => () => void
  onHeartRateReportPayloadChanged: (callback: (payload: unknown) => void) => () => void
  onClickThroughChanged: (callback: (enabled: boolean) => void) => () => void
}

interface Window {
  heartdock: HeartDockApi
}
