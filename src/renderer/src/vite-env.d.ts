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

interface HeartDockApi {
  setAlwaysOnTop: (enabled: boolean) => Promise<boolean>
  setClickThrough: (enabled: boolean) => Promise<boolean>
  setHitTestPassthrough: (enabled: boolean) => Promise<boolean>
  getClickThrough: () => Promise<boolean>
  closeWindow: () => Promise<void>
  showStartupView: () => Promise<boolean>
  enterMainView: () => Promise<boolean>
  openExternal: (url: string) => Promise<boolean>
  getWindowBounds: () => Promise<HeartDockWindowBounds | null>
  setWindowBounds: (bounds: HeartDockWindowBounds) => Promise<boolean>
  moveWindowBy: (deltaX: number, deltaY: number) => Promise<boolean>
  selectDisplayBackgroundImage: () => Promise<DisplayBackgroundImageResult | null>
  onClickThroughChanged: (callback: (enabled: boolean) => void) => () => void
}

interface Window {
  heartdock: HeartDockApi
}
