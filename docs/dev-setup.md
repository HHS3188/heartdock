# 开发环境与依赖安装说明

本文说明如何在本地从源码运行 HeartDock，并整理 Electron 依赖安装失败时的常见处理方法。

HeartDock 基于 Electron、React、TypeScript 和 Vite 构建。  
如果只是未来使用 Windows 安装包，普通用户不需要安装 Node.js 或 npm。  
如果要从源码运行、调试或参与开发，则需要配置开发环境。

---

## 1. 推荐开发环境

建议使用以下环境：

- Windows 10 / Windows 11
- Node.js 22 LTS
- Git
- 支持 BLE 的 Windows 设备

安装 Node.js 时通常会自动安装 npm，因此一般不需要单独安装 npm。

可以用以下命令检查版本：

```bash
node -v
npm -v
git --version
```

如果能正常输出版本号，就说明基础环境可用。

---

## 2. 获取项目源码

如果是第一次下载项目，可以使用：

```bash
git clone https://github.com/HHS3188/heartdock.git
cd heartdock
```

如果已经有项目目录，进入项目根目录即可。

项目根目录通常应该能看到：

```text
package.json
README.md
src
docs
```

如果命令行当前不在项目根目录，可以切换到项目路径，例如：

```bash
cd /d E:\heartdock-starter-v0.1.1-fixed\heartdock-starter-v0.1.1
```

---

## 3. 安装依赖

在项目根目录执行：

```bash
npm install
```

这一步会根据 `package.json` 下载项目需要的依赖。

如果网络正常，安装完成后就可以启动开发模式。

---

## 4. 启动开发模式

执行：

```bash
npm run dev
```

启动成功后，HeartDock 会以 Electron 窗口形式运行。

---

## 5. 类型检查

开发或提交 PR 前，建议执行：

```bash
npm run typecheck
```

这一步会检查 TypeScript 类型错误。  
如果这里报错，通常说明代码类型、接口声明或文件引用存在问题，需要先修复再提交。

---

## 6. Electron 依赖为什么容易下载失败

Electron 的 npm 包安装时，不只是下载普通 JavaScript 依赖，还会额外下载 Electron 二进制文件。

在中国大陆或网络不稳定环境下，可能出现：

```text
RequestError: read ECONNRESET
node_modules/electron
node install.js
```

这通常不是项目代码问题，而是 Electron 二进制下载失败。

常见原因包括：

- GitHub 连接不稳定
- Electron 下载源连接失败
- 网络代理或 VPN 不稳定
- 下载中途被重置
- 杀毒软件或系统权限干扰安装过程

---

## 7. 推荐镜像配置

如果 `npm install` 下载 Electron 失败，可以先设置 npm 和 Electron 镜像：

```bash
npm config set registry https://registry.npmmirror.com
npm config set electron_mirror https://npmmirror.com/mirrors/electron/
npm config set electron_builder_binaries_mirror https://npmmirror.com/mirrors/electron-builder-binaries/
```

然后重新执行：

```bash
npm install
```

可以检查当前配置：

```bash
npm config get registry
npm config get electron_mirror
npm config get electron_builder_binaries_mirror
```

---

## 8. 安装失败后的清理方式

如果已经安装到一半失败，建议先关闭残留进程：

```bash
taskkill /F /IM node.exe
taskkill /F /IM electron.exe
```

然后删除依赖目录：

```bash
rmdir /s /q node_modules
```

再重新安装：

```bash
npm install
```

如果 `node_modules` 删除失败，通常是文件被占用。可以尝试：

- 关闭 VS Code
- 关闭资源管理器中打开的项目目录
- 关闭正在运行的 Electron 窗口
- 关闭杀毒软件的实时扫描
- 重启电脑后再删除

---

## 9. 临时设置 Electron 镜像

如果 npm 配置后仍然卡在 Electron 下载，可以在当前命令行窗口临时设置环境变量：

```bash
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
npm install
```

这个设置只影响当前命令行窗口。

---

## 10. 常见问题

### 1. `electron` 下载失败

优先检查：

```bash
npm config get electron_mirror
```

确认输出类似：

```text
https://npmmirror.com/mirrors/electron/
```

然后删除 `node_modules` 后重新安装。

---

### 2. `node_modules` 删除失败

通常是文件被占用。

处理顺序：

```bash
taskkill /F /IM node.exe
taskkill /F /IM electron.exe
rmdir /s /q node_modules
```

如果仍然失败，重启电脑后再删除。

---

### 3. `npm run dev` 启动失败

先确认依赖是否安装完成：

```bash
dir node_modules
```

然后执行：

```bash
npm install
npm run dev
```

如果还有报错，看报错中是 TypeScript、Vite、Electron 还是网络问题，再分别处理。

---

### 4. GitHub 连接失败

可能出现：

```text
Failed to connect to github.com port 443
Recv failure: Connection was reset
```

这通常是网络问题，不是 Git 操作错误。

可以尝试：

- 等一会儿重试
- 切换网络
- 切换代理或 VPN 节点
- 重试 `git pull` 或 `git push`

---

## 11. 提交前建议检查

提交 PR 前建议执行：

```bash
git status
npm run typecheck
```

确认：

```text
工作区只包含本次任务相关文件
TypeScript 类型检查通过
```

如果只是文档修改，可以不运行功能测试，但仍建议检查 `git status`，避免误提交无关文件。

---

## 12. 相关文档

- [README.md](../README.md)
- [Electron 开发注意事项](./electron-notes.md)
- [路线图](./roadmap.md)
- [悬浮窗限制说明](./overlay-limitations.md)
