# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Start Electron dev mode (Vite HMR for renderer)
npm run typecheck    # TypeScript type checking (tsc --noEmit)
npm run build        # Typecheck + production build
npm run dist         # Build + electron-builder (produces Windows NSIS installer)
```

There are no tests yet. `npm run typecheck` is the only pre-commit validation.

## Architecture

HeartDock is a **Windows desktop heart-rate overlay** built with Electron + React + TypeScript + Vite (`electron-vite`).

### Three-layer Electron structure

| Layer | Entry | Role |
|-------|-------|------|
| **Main** | `src/main/index.ts` | Creates the transparent frameless overlay `BrowserWindow`, IPC handlers, window state persistence, custom `heartdock://` protocol, global shortcut (`Ctrl+Shift+H` for click-through) |
| **Preload** | `src/preload/index.ts` | Exposes `window.heartdock` API via `contextBridge` — all main↔renderer communication goes through IPC invoke calls here |
| **Renderer** | `src/renderer/src/` | Single-page React app (no router), rendered into the transparent overlay window |

### Renderer structure

The renderer is a **single large `App.tsx` component** (~2000 lines) that owns all state. There is no component decomposition — everything lives in one file.

- `src/renderer/src/main.tsx` — ReactDOM entry point
- `src/renderer/src/App.tsx` — Entire application: BPM display, settings panel, pure-display mode, BLE connection, first-run notice, color rules editor, display style presets
- `src/renderer/src/config.ts` — `HeartDockConfig` interface, defaults, normalizers, and `localStorage`-based `loadConfig()`/`saveConfig()`
- `src/renderer/src/core/MockHeartRateSource.ts` — Simple mock BPM generator (random walk between 55-165)
- `src/renderer/src/styles.css` — All styles (~3500 lines), display style presets, light/dark themes, first-run notice, etc.

### Data flow

```
Heart rate source (mock/manual/BLE) → React state (bpm, config) → Overlay UI (heart row + display frame)
                                                                 → Settings panel (config mutations → saveConfig → localStorage)
```

### Heart rate source modes

1. **Mock** — `MockHeartRateSource` generates random BPM on a configurable interval
2. **Manual** — Fixed BPM from user input (30-240 range)
3. **BLE** — Web Bluetooth API (`navigator.bluetooth.requestDevice`) requesting `heart_rate` service. Parses standard BLE Heart Rate Measurement characteristic (`0x2A37`). Supports reconnect to last device in the same session. **Experimental.**

### Window behavior

- Frameless, transparent (`#00000000`), always-on-top
- Window state (position/size) saved to `{userData}/window-state.json` on a 300ms debounce
- Window size clamped to min 720×680 / max 1440×1080
- Custom resize handle in the bottom-right corner (calls `setWindowBounds` IPC)
- Click-through mode toggles `setIgnoreMouseEvents`; in pure-display mode, only the heart-rate row area is interactive

### Key renderer states

- **Settings view** (`showSettings: true`) — Full settings panel with data source, colors, display presets, etc.
- **Pure display mode** (`pureDisplay: true`) — Only the heart-rate row visible, window adjusts to `max-content` size, draggable by holding the BPM area, double-click to exit
- **First-run notice** — Shown on first launch (15-second mandatory wait with countdown and confirmation checkbox), then as a splash screen on subsequent launches

### Config persistence

All user settings stored in `localStorage` under key `heartdock.config.v1`. See `src/renderer/src/config.ts` for the full `HeartDockConfig` interface and all normalizer functions (each clamps values to valid ranges).

### Custom protocol

Main process registers `heartdock://` protocol for serving user-uploaded background images from `{userData}/assets/`. Only allowed file extensions: `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`.

### Build & distribution

- `electron-builder` configured in `package.json` under `"build"` key
- Output: Windows NSIS installer (`release/HeartDock Setup X.Y.Z.exe`)
- App ID: `dev.heartdock.app`, uses `build/icon.ico` as icon
- No code signing certificate

## Project constraints

- Windows-only (no macOS/Linux support planned for near term)
- Chinese-language UI (all labels, hints, and messages are in Chinese)
- AGPL-3.0-only license — modified versions distributed or used as a network service must release source
- BLE heart rate support is for **standard** BLE Heart Rate Service only (no vendor-proprietary protocols or authentication)
