# Changelog

## 0.9.0

- 新增启动红心动画和启动页更新检查 gate
- 新增分步新手引导，覆盖数据源、显示区、纯享模式、动态显示、记录导出和系统工具
- 新增主要设置项帮助提示
- 新增基于 `electron-updater` 的 GitHub Release 自动更新基础能力
- 新增更新弹窗、下载进度、发布页跳转和设置页手动检查更新入口
- 优化鼠标禁止交互与透明窗口局部 hit-test，透明空白区域尽量不再挡住底层窗口
- 将纯享心率记录报告改为独立窗口，避免被主设置窗口尺寸压缩
- 新增脱敏诊断信息 JSON 导出
- 同步 v0.9.0 发布文档、路线图和已知风险说明

## 0.7.0

- 新增 6 个场景预设：直播叠加、游戏极简、桌面陪伴、二次元贴纸、心电监护、办公低调
- 新增应用内场景预设确认弹窗，并支持撤销上次预设
- 新增像素游戏框、赛博扫描框、软萌云朵框显示样式
- 新增心跳缩放、颜色平滑过渡、高心率提醒和低心率呼吸动态显示选项
- 新增纯享模式心率记录，退出纯享模式时展示本次心率报告
- 新增心率记录 PNG 报告导出
- 优化心率报告弹窗布局、按钮对齐和区间分布展示
- 优化配置导出默认文件名，加入日期时间

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
