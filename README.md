# HeartDock

HeartDock 是一个面向 Windows 的可自定义桌面心率悬浮窗工具。

它基于 Electron + React 构建，目标是提供一个轻量、清爽、可定制的心率显示窗口，适合桌面显示、直播、录屏叠加和日常观察心率变化。

当前项目仍处于早期预发布阶段，但已经支持模拟心率、手动输入心率，以及实验性的标准 BLE 心率设备读取。

---

## 功能特性

- 桌面心率悬浮窗
- 窗口始终置顶
- 模拟心率数据源
- 手动输入心率数据源
- 实验性 BLE 心率设备数据源
- 支持标准 BLE Heart Rate Service
- 支持实时显示 BLE 心率数据
- 支持连接 / 断开 BLE 心率设备
- 支持显示 BLE 连接状态
- 支持清理部分 BLE 设备名称乱码
- 自定义字体大小
- 自定义刷新间隔
- 根据 BPM 心率区间改变颜色
- 背景透明度控制
- 可选点击穿透模式
- 纯享心率显示模式
- 本地配置持久化
- 主题预设切换
- 中文设置界面
- 窗口位置和尺寸保存
- 适合 GitHub 项目管理的基础结构

---

## 当前状态

HeartDock 当前处于 v0.1.x 早期预发布阶段。  
目前已经完成基础桌面悬浮窗、主题预设、窗口状态保存、实验性 BLE 心率读取和纯享心率显示模式。

| 版本 | 状态 | 说明 |
|---|---|---|
| v0.1.1 | 已发布 | 模拟心率悬浮窗和基础样式设置 |
| v0.1.2 | 已发布 | 补充主题预设说明，优化中文界面和交互说明 |
| v0.1.3 | 已发布 | 优化桌面使用体验，保存窗口位置和尺寸，增加关闭按钮 |
| v0.1.4 | 已发布 | 修复窗口状态保存和恢复逻辑 |
| v0.1.5 | 已发布 | 增加心率数据源模式，支持模拟和手动输入 |
| v0.1.6 | 已发布 | 增加实验性 BLE 心率数据源，支持标准 BLE 心率读取 |
| v0.1.7 | 已发布 | 新增纯享心率显示模式，优化透明窗口和显示体验 |
| v0.2.0 | 计划中 | 进一步完善 BLE 连接稳定性、重连提示和设备兼容性 |
| v0.3.0 | 计划中 | 优化纯享模式、点击穿透和目标窗口显示体验 |
| v1.0.0 | 计划中 | 稳定 Windows 发布版本 |

---

## 推荐开发环境

如果你想从源码运行或参与开发，建议使用以下环境：

- Windows 10 / Windows 11
- Node.js 22 LTS
- Git
- 支持 BLE 的 Windows 设备

---

## 本地运行说明

安装依赖：

```bash
npm install
```

启动开发模式：

```bash
npm run dev
```

如果依赖安装完成并启动成功，HeartDock 会以 Electron 窗口形式运行。

---

## 数据源模式

HeartDock 当前支持三种心率数据源：

| 数据源 | 说明 |
|---|---|
| 模拟心率 | 自动生成模拟 BPM，适合测试界面样式和颜色变化 |
| 手动输入 | 固定显示用户输入的 BPM，适合调试、演示或临时展示 |
| BLE 心率设备（实验） | 通过 Web Bluetooth 连接标准 BLE 心率设备并读取实时心率 |

BLE 模式目前优先支持标准蓝牙心率服务：

- Heart Rate Service: `0x180D`
- Heart Rate Measurement: `0x2A37`

如果设备支持标准 BLE Heart Rate Service，HeartDock 有机会直接读取实时心率。  
如果设备使用厂商私有协议、需要认证密钥，或者不广播标准心率服务，当前版本可能无法直接读取。

---

## 纯享心率显示模式

纯享模式用于正式桌面显示、直播或录屏叠加。

开启后会隐藏设置面板、顶部标识、设置按钮和关闭按钮，只保留：

- 心率图标
- BPM 数字
- `bpm` 单位

纯享模式会尽量保持背景透明，只显示心率本体。  
可以通过双击心率显示区域退出纯享模式。

---

## 快捷键

| 快捷键 | 功能 |
|---|---|
| Ctrl + Shift + H | 开启 / 关闭点击穿透模式 |

如果开启了点击穿透模式，鼠标点击会穿过悬浮窗，无法直接点击悬浮窗界面。  
可以使用 `Ctrl + Shift + H` 关闭点击穿透模式。

---

## Electron 依赖下载问题

在中国大陆或网络不稳定环境下，`npm install` 可能会卡在 Electron 依赖安装阶段。

常见错误包括：

```text
RequestError: read ECONNRESET
node_modules/electron
node install.js
```

这通常不是项目代码问题，而是 Electron 安装时需要额外下载二进制文件，下载过程被中断了。

可以尝试设置 npm 和 Electron 镜像：

```bash
npm config set registry https://registry.npmmirror.com
npm config set electron_mirror https://npmmirror.com/mirrors/electron/
npm config set electron_builder_binaries_mirror https://npmmirror.com/mirrors/electron-builder-binaries/
```

如果已经装到一半失败，建议关闭残留进程并重新安装：

```bash
taskkill /F /IM node.exe
taskkill /F /IM electron.exe
rmdir /s /q node_modules
npm install
```

如果还是卡在 Electron 下载，可以在当前命令行窗口临时设置镜像后再安装：

```bash
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
npm install
```

如果 `node_modules` 删除失败，通常是文件被 VS Code、资源管理器、杀毒软件或残留进程占用。  
可以关闭相关程序后重试，必要时重启电脑再执行安装。

---

## 当前限制

HeartDock 当前优先支持以下场景：

- 桌面悬浮显示
- 普通窗口上方显示
- 无边框全屏窗口场景
- 直播 / 录屏画面叠加

当前仍存在以下限制：

- BLE 心率数据源仍为实验功能
- 暂不保证所有 BLE 设备都能连接
- 暂未支持 BLE 自动重连
- 暂未提供正式 Windows 安装包
- 独占全屏程序上方显示不保证可用
- 透明窗口和点击穿透在不同 Windows 环境下可能存在差异

更多说明见：

[docs/overlay-limitations.md](docs/overlay-limitations.md)

---

## 开发路线

当前计划如下：

1. 完成 v0.1.x 起步项目和 GitHub 工作流
2. 完善桌面悬浮窗基础体验
3. 增加主题预设和中文设置界面
4. 增加窗口位置 / 尺寸保存
5. 增加模拟、手动和 BLE 心率数据源
6. 增加纯享心率显示模式
7. 优化透明窗口、点击穿透和显示区域交互
8. 增强 BLE 连接稳定性和设备兼容性
9. 提供 Windows 安装包
10. 增加目标窗口跟随模式
11. 打包稳定 Windows 发布版本

详细路线见：

[docs/roadmap.md](docs/roadmap.md)

---

## License / 许可证

本项目使用 **GNU Affero General Public License v3.0 only** 开源许可证。

HeartDock 遵循 GNU AGPL v3.0 协议发布。  
如果你修改、分发本项目，或者将修改后的版本作为网络服务提供给他人使用，需要遵守 AGPL v3.0 的相关条款，并按要求开放对应源码。

详情请查看 [LICENSE](LICENSE)。
