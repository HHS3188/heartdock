/// <reference types="vite/client" />

interface HeartDockWindowBounds {
  x: number
  y: number
  width: number
  height: number
}

interface HeartDockApi {
  setAlwaysOnTop: (enabled: boolean) => Promise<boolean>
  setClickThrough: (enabled: boolean) => Promise<boolean>
  getClickThrough: () => Promise<boolean>
  closeWindow: () => Promise<void>
  getWindowBounds: () => Promise<HeartDockWindowBounds | null>
  setWindowBounds: (bounds: HeartDockWindowBounds) => Promise<boolean>
  moveWindowBy: (deltaX: number, deltaY: number) => Promise<boolean>
  onClickThroughChanged: (callback: (enabled: boolean) => void) => () => void
}

interface Window {
  heartdock: HeartDockApi
}
