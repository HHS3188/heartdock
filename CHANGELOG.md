# Changelog

## 0.6.0

- 增强纯享模式置顶能力，尽量覆盖全屏 / 无边框全屏应用
- 优化纯享模式拖动跟手度，减少高频窗口移动 IPC
- 新增极光流光框、极简描边框、心电监护框显示样式
- 新增配置文件导出和载入能力
- 载入配置时自动关闭纯享模式、鼠标禁止交互和 BLE 连接，避免误锁窗口
- 增强配置 normalize 校验，降低坏配置文件导致异常 UI 状态的风险

## 0.1.0

Initial starter version.

- Add Electron + React + TypeScript project structure
- Add transparent overlay window
- Add mock heart rate source
- Add configurable font size, refresh interval, opacity, and color rules
- Add click-through toggle
- Add documentation and GitHub workflow
