# HeartDock v0.5.1 Release Notes

## 概述

v0.5.1 是 v0.5.0 之后的稳定性修复版本。

## 主要修复

### 修复/缓解鼠标穿透关闭时偶发退出（#48）

在部分 Windows 环境下，通过 `Ctrl + Shift + H` 切换鼠标穿透状态时可能偶发退出。v0.5.1 进行了以下稳定性修复：

- **主进程** `setOverlayClickThrough` 增加同值跳过，避免重复调用 `setIgnoreMouseEvents`
- **主进程** 增加 200ms 最小切换间隔，防止快速 toggle 导致窗口不稳定
- **渲染进程** 纯享模式 hit-test 增加去重，只在状态变化时发送 IPC，减少重复调用

修复后用户测试未再复现退出。

## 下载

- `HeartDock Setup 0.5.1.exe`

## 说明

- 本版本不改变鼠标穿透的原有语义：开启穿透后点击仍会落到底层窗口，这是预期行为。
- 如需"不响应 HeartDock 且不点到底层窗口"的效果，这是 #54 交互锁定模式的需求，将在后续版本单独设计。
- BLE 心率设备仍为实验性功能。
- 仅支持 Windows。

## 关联 Issue

- [#48](https://github.com/HHS3188/heartdock/issues/48) 鼠标穿透关闭时偶发退出（已修复）

---

HeartDock 是完全免费、开源的桌面心率悬浮窗软件，遵循 AGPL-3.0-only 许可证。
