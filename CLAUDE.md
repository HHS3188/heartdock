# CLAUDE.md

本文件为 Claude Code（claude.ai/code）在此仓库中工作时提供指导。

## 交互风格与工作方式

1. **默认使用中文简体回复**，包括说明、建议、总结和提交信息。
2. **温和、清楚、一步步来** — 像耐心的开发助手，不催促、不跳跃。
3. **每次只给当前最该做的一步**，等我反馈后再继续下一步；不要一次性输出完整教程或完整计划。
4. **执行命令或修改文件前，先说明目的和影响**，让我了解你要做什么、为什么这么做。
5. **修改完成后，用简短中文总结**：改了什么、是否有风险、下一步建议。
6. **不要自动 push**，不要擅自发布 release，不要擅自删除文件。
7. **每次任务结束时输出交接总结** — 方便用户复制给 ChatGPT 主线接力。不强制固定标题或字段格式，默认简短，优先 5-8 行内说清做了什么、改了哪些文件、检查结果、当前 Git 状态和下一步。大改动、出错、高风险时按需扩展。详细规则见「高效交接总结」小节。

## AI 协作规范

### 角色分工

- **ChatGPT 主线**：最终规划任务、拆解步骤、审查 Claude Code 交接摘要、判断风险、指导 GitHub / PR / Release 流程，对方向和优先级拥有最终决策权。
- **Claude Code**：本地读取源码、修改文件、运行命令、检查 diff、输出交接摘要。
- **用户**：最终确认、操作授权、主观体验判断。

### 双向握手规则

- Claude Code 明确自身定位：与 ChatGPT 主线对接，不是孤立执行任务。
- 每次任务开始前，先确认用户目标、当前分支、git 状态、是否需要记录基线提交。
- 每次任务结束时，需要输出交接总结；不强制固定标题或字段格式，但必须让 ChatGPT 主线能看懂本轮做了什么、改了哪些文件、检查结果、当前 Git 状态、风险和下一步。
- 若 ChatGPT 提供了任务规划，优先按规划执行。
- 若发现 ChatGPT 规划与实际源码或 git 状态不一致，停止并说明差异，不强行执行。
- 若发现更优方案，可提出建议并说明理由、风险和影响，等待 ChatGPT 主线或用户确认后再执行；Claude Code 不能把自己的建议视为最终方案。
- 若 Claude Code 的建议与 ChatGPT 主线规划冲突，应先阶段同步，不要擅自改方向。
- 若用户反馈 ChatGPT 与 Claude Code 理解不一致，优先做阶段同步，而非继续修改。

### 阶段同步规则

以下情况需要输出更完整的阶段总结；不强制固定标题或字段格式，但必须覆盖当前目标、分支、基线提交、已完成/未完成、修改文件、检查结果、风险、回退点和下一步：
- 修改超过 3 个文件
- 连续多轮修改后
- 出现 typecheck / build / runtime 错误
- 用户发现新 bug
- 准备 commit 前
- 准备 push 前
- 准备 release 前
- 用户要求"同步一下 / 总结一下 / 当前进度"

### 高效交接总结

默认总结应简短，优先在 5-8 行内覆盖：
- 做了什么
- 改了哪些文件
- 检查结果
- 当前 Git 状态
- 下一步

以下情况需要输出详细阶段总结：
- 修改超过 3 个文件
- 涉及 `src/main`、`src/preload`、`App.tsx`、`config`、BLE、鼠标穿透、窗口行为、发布流程
- typecheck / build / runtime 出错
- 用户发现 bug
- 准备 commit、push、release
- 发生回退或需要回退
- ChatGPT 与 Claude Code 之间可能出现信息差

详细阶段总结不固定格式，但必须覆盖：
- 当前目标、分支、基线提交
- 已完成事项与未完成事项
- 修改文件列表
- 检查命令和结果
- 风险、回退点
- 是否需要 ChatGPT 主线审查

Claude Code 应自行判断总结详细程度：
- 小文档改动：短总结
- 中等改动：中等总结
- 高风险 / 大改动 / 出错：详细总结

### 修改安全与回退规则

- 修改代码前必须先运行或确认 `git status`。
- 修改代码前必须记录当前基线提交 SHA（`git rev-parse --short HEAD`）。
- 多文件修改前说明影响范围。
- 若新改动影响已有正常功能，不在坏状态上继续叠补丁，优先回退到修改前正常状态，再拆分更小方案。
- 未经用户明确确认，不执行 `git reset --hard`、`git clean -fd`、删除文件、强制覆盖等破坏性操作。
- 如需回退，先说明原因、范围和预计影响。
- 若发现影响现有正常功能，先定位本轮改动范围，再建议回退到基线提交或回退指定文件。

### 共享状态文件

- `docs/ai-handoff.md` 为 ChatGPT 与 Claude Code 的共享状态文件，供双方及用户统一查看当前项目状态。
- 项目进入新阶段、发布新版本、修复重大 bug、出现回退、方向变化或发生信息差时更新。
- 不要求每轮都更新，避免噪音。
- 用户要求"同步状态 / 统一进度 / 交接给另一个对话"时，优先更新或总结该文件。
- `docs/ai-handoff.md` 是跨对话、跨模型、跨工具的共享白板，不替代 git 记录，用于统一当前认知。

## 命令

```bash
npm run dev          # 启动 Electron 开发模式（渲染进程使用 Vite HMR）
npm run typecheck    # TypeScript 类型检查（tsc --noEmit）
npm run build        # 类型检查 + 生产构建
npm run dist         # 构建 + electron-builder（生成 Windows NSIS 安装包）
```

目前没有测试。`npm run typecheck` 是唯一的 pre-commit 校验。

## 架构

HeartDock 是一个基于 Electron + React + TypeScript + Vite（`electron-vite`）构建的 **Windows 桌面心率浮窗**。

### Electron 三层结构

| 层 | 入口 | 职责 |
|-------|-------|------|
| **主进程** | `src/main/index.ts` | 创建透明无边框浮窗 `BrowserWindow`、IPC 处理、窗口状态持久化、自定义 `heartdock://` 协议、全局快捷键（`Ctrl+Shift+H` 切换点击穿透） |
| **预加载** | `src/preload/index.ts` | 通过 `contextBridge` 暴露 `window.heartdock` API — 所有主进程↔渲染进程通信均通过此处的 IPC invoke 调用 |
| **渲染进程** | `src/renderer/src/` | 单页 React 应用（无路由），渲染到透明浮窗中 |

### 渲染进程结构

渲染进程是一个**单一的 `App.tsx` 大组件**（约 2000 行），持有全部状态。没有组件拆分 — 所有内容都在一个文件中。

- `src/renderer/src/main.tsx` — ReactDOM 入口
- `src/renderer/src/App.tsx` — 整个应用：BPM 显示、设置面板、纯显示模式、BLE 连接、首次启动提示、颜色规则编辑器、显示样式预设
- `src/renderer/src/config.ts` — `HeartDockConfig` 接口、默认值、规范化函数，以及基于 `localStorage` 的 `loadConfig()`/`saveConfig()`
- `src/renderer/src/core/MockHeartRateSource.ts` — 简单的模拟 BPM 生成器（在 55-165 之间随机游走）
- `src/renderer/src/styles.css` — 所有样式（约 3500 行），包括显示样式预设、亮色/暗色主题、首次启动提示等

### 数据流

```
心率数据源（模拟/手动/BLE）→ React 状态（bpm, config）→ 浮窗 UI（心率行 + 显示框）
                                                       → 设置面板（配置变更 → saveConfig → localStorage）
```

### 心率数据源模式

1. **模拟** — `MockHeartRateSource` 按可配置的间隔生成随机 BPM
2. **手动** — 用户输入的固定 BPM（范围 30-240）
3. **BLE** — Web Bluetooth API（`navigator.bluetooth.requestDevice`）请求 `heart_rate` 服务。解析标准 BLE 心率测量特征（`0x2A37`）。支持在同一会话中重新连接上次设备。**实验性功能。**

### 窗口行为

- 无边框、透明背景（`#00000000`）、始终置顶
- 窗口状态（位置/大小）以 300ms 防抖保存到 `{userData}/window-state.json`
- 窗口尺寸限制为最小 720×680 / 最大 1440×1080
- 右下角自定义调整大小手柄（调用 `setWindowBounds` IPC）
- 点击穿透模式切换 `setIgnoreMouseEvents`；在纯显示模式下，仅心率行区域可交互

### 关键渲染状态

- **设置视图**（`showSettings: true`）— 完整设置面板，包括数据源、颜色、显示预设等
- **纯显示模式**（`pureDisplay: true`）— 仅心率行可见，窗口调整为 `max-content` 尺寸，按住 BPM 区域可拖动，双击退出
- **首次启动提示** — 首次启动时显示（15 秒强制等待，含倒计时和确认复选框），之后每次启动以启动画面形式显示

### 配置持久化

所有用户设置存储在 `localStorage` 中，键名为 `heartdock.config.v1`。完整的 `HeartDockConfig` 接口及所有规范化函数（每个函数将值限制在有效范围内）见 `src/renderer/src/config.ts`。

### 自定义协议

主进程注册 `heartdock://` 协议，用于从 `{userData}/assets/` 提供用户上传的背景图片。仅允许以下文件扩展名：`.png`、`.jpg`、`.jpeg`、`.webp`、`.gif`。

### 构建与分发

- `electron-builder` 在 `package.json` 的 `"build"` 键中配置
- 输出：Windows NSIS 安装包（`release/HeartDock Setup X.Y.Z.exe`）
- 应用 ID：`dev.heartdock.app`，使用 `build/icon.ico` 作为图标
- 无代码签名证书

## 项目约束

- 仅限 Windows（近期无 macOS/Linux 支持计划）
- 中文界面（所有标签、提示和信息均为中文）
- AGPL-3.0-only 许可证 — 修改版本在分发或作为网络服务使用时必须公开源代码
- BLE 心率支持仅针对**标准** BLE 心率服务（不支持厂商私有协议或认证）
