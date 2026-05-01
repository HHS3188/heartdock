# Overlay limitations

HeartDock v0.1 uses a normal transparent always-on-top Electron window.

This is suitable for:

- desktop overlay
- normal application windows
- maximized windows
- many borderless fullscreen windows

It may not work reliably over:

- exclusive fullscreen games
- applications that use protected rendering
- apps with anti-cheat or anti-overlay systems
- system-level secure desktops

## Project policy

HeartDock should not promise universal fullscreen overlay support.

Recommended wording:

> HeartDock focuses on desktop, normal-window, and borderless-fullscreen overlay scenarios. Exclusive fullscreen support is experimental and not guaranteed.
