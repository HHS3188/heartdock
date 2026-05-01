# Architecture

HeartDock is split into four simple layers.

```text
Heart rate source → State → Overlay UI → Config
```

## 1. Heart rate source

A heart rate source provides BPM values.

Current source:

- `MockHeartRateSource`: generates fake heart rate values for UI development.

Planned sources:

- `StandardBleHeartRateSource`: reads standard BLE heart rate devices.
- `MiBandHeartRateSource`: experimental Mi Band adapter.
- `WebSocketHeartRateSource`: accepts BPM values from external apps.

## 2. State

The renderer keeps the current BPM, connection state, and user config.

## 3. Overlay UI

The overlay window is created by Electron. The UI is rendered with React.

Important window behavior:

- transparent background
- frameless window
- always-on-top mode
- optional click-through mode

## 4. Config

The current starter version stores user config in `localStorage`.

A future version may move config persistence to a JSON file managed by the Electron main process.
