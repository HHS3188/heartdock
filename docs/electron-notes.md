\# Electron 开发注意事项



本文记录 HeartDock 在 Electron 开发过程中已经遇到的问题、当前解决方案和后续维护建议。



HeartDock 使用 Electron 主要是为了快速实现 Windows 桌面悬浮窗、透明窗口、鼠标禁止交互、纯享模式局部 hit-test、BLE 心率读取和本地桌面交互。Electron 开发效率高，但在透明窗口、窗口缩放、依赖下载和安全边界方面有一些需要长期注意的地方。



\---



\## 1. 为什么 HeartDock 使用透明无边框窗口



HeartDock 的核心显示方式是桌面心率悬浮窗，尤其是纯享显示模式需要做到：



\- 只显示心率图标、BPM 数字和单位

\- 隐藏普通设置面板和窗口装饰

\- 背景尽量完全透明

\- 可以覆盖在桌面、直播、录屏或其他窗口上



因此当前主窗口使用了 Electron 的透明无边框窗口能力，主进程中大致包含以下配置：



```ts

frame: false,

transparent: true,

backgroundColor: '#00000000',

hasShadow: false,

alwaysOnTop: true,

resizable: true
