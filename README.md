# HeartDock

HeartDock is a customizable desktop heart rate overlay for Windows.

The current version is a **v0.1 starter project**. It uses a mock heart rate source first, so the desktop overlay, settings, GitHub workflow, and project structure can be built before dealing with Bluetooth and Mi Band authentication.

## Features

- Transparent desktop heart rate overlay
- Always-on-top window
- Mock heart rate data source
- Custom font size
- Custom refresh interval
- BPM-based color rules
- Background opacity control
- Optional click-through mode
- Local config persistence
- GitHub-ready project structure

## Current status

This project is currently in early development.

| Version | Status | Description |
|---|---|---|
| v0.1.0 | In progress | Mock heart rate overlay and basic style settings |
| v0.2.0 | Planned | Standard BLE heart rate device support |
| v0.3.0 | Planned | Mi Band research and experimental adapter |
| v0.4.0 | Planned | Target-window follow mode |
| v1.0.0 | Planned | Stable Windows release |

## Development

Install dependencies:

```bash
npm install
```

Start the development app:

```bash
npm run dev
```

Run TypeScript check:

```bash
npm run typecheck
```

Build the app:

```bash
npm run build
```

Create a Windows installer:

```bash
npm run dist
```

## Hotkeys

| Hotkey | Action |
|---|---|
| Ctrl + Shift + H | Toggle click-through mode |

If click-through mode is enabled, mouse clicks will pass through the overlay. Use `Ctrl + Shift + H` to disable it again.

## Overlay limitations

HeartDock currently focuses on desktop, normal windows, and borderless fullscreen scenarios. Exclusive fullscreen support is experimental and not guaranteed.

See [docs/overlay-limitations.md](docs/overlay-limitations.md).

## Mi Band support

Mi Band support is planned, but it is not included in v0.1. The first public version uses mock data so that the project structure and desktop overlay can be completed first.

See [docs/mi-band-notes.md](docs/mi-band-notes.md).

## License

MIT
