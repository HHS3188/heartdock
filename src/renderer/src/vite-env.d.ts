/// <reference types="vite/client" />

interface HeartDockApi {
  setAlwaysOnTop: (enabled: boolean) => Promise<boolean>
  setClickThrough: (enabled: boolean) => Promise<boolean>
  getClickThrough: () => Promise<boolean>
  onClickThroughChanged: (callback: (enabled: boolean) => void) => () => void
}

interface Window {
  heartdock: HeartDockApi
}
