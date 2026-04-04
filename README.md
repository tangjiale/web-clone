# 网站分身管理器

基于 `Electron + React + Ant Design + SQLite` 构建的桌面端网站多账号管理工具。

它的核心目标是让同一个站点可以创建多个“账号分身”，并且为每个分身提供独立的 `Cookie / localStorage / sessionStorage / IndexedDB` 持久化环境。这样就能在一台电脑里稳定管理多个网页登录身份，避免账号串号、状态互相污染、频繁切换浏览器资料目录。

## 项目状态

- 当前桌面壳：`Electron`
- 当前前端：`React 18 + Vite 5 + Ant Design 5`
- 当前数据层：`better-sqlite3 + SQLite`
- 当前打包目标：
  - macOS：`.dmg`（`arm64 / x64 / universal`）
  - Windows：`.exe`（NSIS 安装包）
  - Linux：`.AppImage / .deb / .rpm`（GitHub Actions 发布）

说明：

- 当前实际运行、开发、打包、GitHub Actions 发布，均以 `Electron` 方案为准。

## 核心功能

### 1. 站点管理

- 支持新增、编辑、删除站点
- 支持三种站点类型：
  - `domain`：按域名管理
  - `entry_url`：按入口 URL 管理
  - `group`：按站点组管理多个目标规则
- 支持站点置顶
- 支持站点备注
- 支持自动尝试加载站点图标 / favicon

### 2. 分身管理

- 每个站点下可创建多个账号分身
- 每个分身支持独立名称与备注
- 支持分身置顶
- 支持分身编辑与删除
- 支持最近使用时间记录

### 3. 浏览器隔离

- 每个分身分配独立持久化存储分区
- 每个分身独立保存：
  - `Cookie`
  - `localStorage`
  - `sessionStorage`
  - `IndexedDB`
- 同站点下不同分身之间互不影响

### 4. 双打开模式

- `内嵌打开`
  - 在主窗口内直接使用浏览器工作台
- `外置打开`
  - 以独立窗口打开同一个分身
  - 与内嵌模式共享同一分身存储状态

### 5. 浏览器工作台

- 顶部浏览器标签栏
- 标签右键菜单：
  - 刷新标签
  - 复制地址
  - 关闭当前
  - 关闭其他
  - 外置打开
- 浏览器地址栏
- 前进 / 后退 / 刷新
- 返回首页
- 清空当前分身站点数据

### 6. 管理中心抽屉

- 右上角打开“站点与分身”抽屉
- 右上角打开“设置”抽屉
- 抽屉采用悬浮覆盖模式，不改变主浏览区排版
- 打开抽屉时主浏览区不可点击

### 7. 本地持久化

- 站点、分身、设置写入 SQLite
- 分身运行时隔离状态写入系统应用数据目录
- 重启应用后分身状态仍然可恢复

### 8. 版本与更新

- 顶部应用名称后显示版本号
- 支持首页左上角版本标签提示新版本
- 更新检查地址由应用后台配置
- 支持手动执行“检查更新”
- 支持点击版本标签查看新版本说明
- 支持从 GitHub tag release 下载对应平台安装包
- 支持显示：
  - 当前版本
  - 最新版本
  - 更新说明
  - 发布页 / 下载地址
  - 已匹配的安装包文件名

## 当前版本已实现

- 站点 CRUD
- 分身 CRUD
- 站点 / 分身置顶
- 分身最近使用
- 内嵌浏览
- 外置窗口浏览
- 分身单实例约束
- 独立分区会话隔离
- SQLite 本地持久化
- 自定义应用图标
- macOS `.dmg` 打包
- Windows `.exe` 打包配置
- Linux `.AppImage / .deb / .rpm` 发布配置
- GitHub Actions 自动发布工作流
- `latest.json` 更新清单生成
- `SHA256SUMS.txt` 校验文件生成

## 当前版本暂未实现

- 账号密码保存
- 云同步
- 导入导出
- 下载管理
- 浏览器扩展系统
- 自动下载安装并静默升级
- 账号批量导入

## 技术栈

### 前端

- React 18
- Vite 5
- Ant Design 5
- TypeScript
- Axios
- Day.js

### 桌面端

- Electron 41
- Chromium BrowserView / BrowserWindow
- Electron Builder

### 数据层

- better-sqlite3
- SQLite 3

## 项目架构

### 结构总览

```text
web-clone/
├─ .github/
│  └─ workflows/
│     └─ build.yml               # GitHub Actions 自动打包发布
├─ electron/
│  ├─ main.cjs                   # Electron 主进程、窗口与 BrowserView 管理
│  ├─ preload.cjs                # 渲染进程桥接 API
│  └─ db.cjs                     # SQLite 数据层
├─ scripts/
│  └─ run-dev-electron.sh        # 自定义开发态 Electron 壳，保证项目名与图标生效
│  └─ release/
│     ├─ sync-version.cjs        # 同步版本号到历史配置文件
│     ├─ collect_release_artifacts.cjs
│     └─ build_latest_json.cjs   # 构建 GitHub Release 用 latest.json
├─ build-resources/
│  └─ icons/                     # Electron / Electron Builder 使用的应用图标资源
├─ src/
│  ├─ App.tsx                    # 主界面与交互逻辑
│  ├─ main.tsx                   # React 入口
│  ├─ assets/
│  │  └─ logo.svg                # 页面内项目 Logo
│  ├─ lib/
│  │  ├─ api.ts                  # preload API 封装
│  │  └─ types.ts                # 前后端共享类型
│  └─ styles/
│     └─ app.css                 # 全局样式
├─ package.json
└─ README.md
```

### 运行架构

#### 1. React 渲染层

- 负责工作台 UI
- 负责抽屉、标签栏、站点管理、分身管理、设置页
- 通过 preload 暴露的安全 API 与 Electron 主进程通信

#### 2. Electron 主进程

- 创建主窗口与外置窗口
- 管理内嵌 `BrowserView`
- 维护当前运行时分身会话
- 控制独立分区与单实例约束
- 负责打包时应用名、图标、窗口配置

#### 3. SQLite 数据层

- 保存站点、分身、设置
- 为每个分身生成独立 `storage_key`
- 记录分身最近打开时间等信息

### 数据隔离设计

- 每个分身都有独立 `storage_key`
- Electron 为每个分身创建独立 `partition`
- 内嵌打开与外置打开共用同一 `partition`
- 同一分身在任一时刻仅允许一个运行实例

## 数据模型

### `sites`

- 站点主表
- 字段包含：
  - `id`
  - `name`
  - `type`
  - `home_url`
  - `icon_url`
  - `notes`
  - `is_pinned`
  - `is_favorite`
  - `created_at`
  - `updated_at`

### `site_targets`

- 站点目标规则表
- 供 `group` 类型站点使用

### `profiles`

- 分身表
- 字段包含：
  - `id`
  - `site_id`
  - `name`
  - `notes`
  - `storage_key`
  - `is_pinned`
  - `is_favorite`
  - `last_opened_at`
  - `created_at`
  - `updated_at`

### `app_settings`

- 应用设置表
- 保存：
  - 默认打开方式
  - 删除行为偏好
  - 最近内嵌标签顺序
  - 最近激活分身

## 开发环境要求

- Node.js `>= 20`
- npm `>= 10`
- macOS 开发建议安装 Xcode Command Line Tools
- Windows 打包建议安装 Visual Studio Build Tools

## 安装依赖

```bash
npm install
```

安装完成后会自动执行：

```bash
npm run rebuild:electron
```

用于把 `better-sqlite3` 重编译到当前 Electron 版本，避免桌面端原生模块不匹配。

## 开发运行

### 启动完整桌面开发环境

```bash
npm run dev:desktop
```

说明：

- 会同时启动 Vite 开发服务器和 Electron 开发窗口
- 开发态已经使用自定义 Electron 壳，项目名和图标会尽量与正式应用保持一致

### 仅启动前端开发服务器

```bash
npm run dev
```

### 仅启动 Electron 壳

```bash
npm run dev:electron
```

### 构建前端资源

```bash
npm run build
```

## 本地打包

### 打包当前平台桌面应用

```bash
npm run build:desktop
```

### 打包 macOS DMG

```bash
npm run build:mac
```

### 打包 macOS Apple Silicon

```bash
npm run build:mac:arm64
```

### 打包 macOS Intel

```bash
npm run build:mac:x64
```

### 打包 macOS Universal

```bash
npm run build:mac:universal
```

输出目录默认在：

```bash
release/
```

### 打包 Windows EXE

```bash
npm run build:win
```

Windows 产物为 NSIS 安装程序 `.exe`。

### 打包 Linux x64

```bash
npm run build:linux:x64
```

### 打包 Linux ARM64

```bash
npm run build:linux:arm64
```

### 一键发版打包

```bash
npm run release:package
```

说明：

- 会自动校验 `package.json` 版本号
- 会自动检查 `CHANGELOG.md` 和 `CHANGELOG.zh-CN.md` 是否存在对应版本段
- 会自动执行：
  - `npm run sync-version`
  - `npm run rebuild:electron`
  - `npm run build`
  - 当前平台对应桌面安装包构建
  - release 资产统一命名整理
  - `latest.json` 生成
  - `SHA256SUMS.txt` 生成
- 默认输出目录：

```bash
release-local/v<version>/
```

例如：

```bash
release-local/v0.1.0/
```

补充说明：

- 在 macOS 上会一次性构建 `arm64 / x64 / universal` 三种 DMG
- 在 Windows 上会构建 `x64` 的 NSIS `.exe`
- 在 Linux 上会按当前架构构建对应的 `AppImage / deb / rpm`
- 这个脚本只负责本地打包整理，不会自动创建 git tag 或推送远端

### 一键发布到 GitHub

```bash
npm run release:publish
```

说明：

- 运行前请先改好 [package.json](/Users/tangjiale/Code/self/web-clone/package.json) 里的 `version`
- 运行前请先补好 [CHANGELOG.md](/Users/tangjiale/Code/self/web-clone/CHANGELOG.md) 和 [CHANGELOG.zh-CN.md](/Users/tangjiale/Code/self/web-clone/CHANGELOG.zh-CN.md)
- 脚本默认会先执行 `npm run release:package`
- 然后自动执行：
  - `git add -A`
  - `git commit -m "chore: release v<version>"`
  - `git tag -a v<version> -m "release v<version>"`
  - `git push origin <current-branch>`
  - `git push origin v<version>`
- tag 推送成功后会自动触发 GitHub Actions 发布

可选参数：

- `npm run release:publish -- --dry-run`
- `npm run release:publish -- --skip-package`
- `npm run release:publish -- --skip-push`

## GitHub Actions 自动打包发布

项目已提供：

- 工作流文件：[build.yml](/Users/tangjiale/Code/self/web-clone/.github/workflows/build.yml)
- 英文更新日志：[CHANGELOG.md](/Users/tangjiale/Code/self/web-clone/CHANGELOG.md)
- 中文更新日志：[CHANGELOG.zh-CN.md](/Users/tangjiale/Code/self/web-clone/CHANGELOG.zh-CN.md)

### 触发方式

当推送符合下面规则的 tag 时自动触发：

```bash
v*
```

例如：

```bash
git tag v0.1.0
git push origin v0.1.0
```

也支持在 GitHub Actions 页面手动触发 `workflow_dispatch`。

说明：

- 手动触发主要用于验证多平台构建链路
- 手动触发不会创建 GitHub Release，也不会发布 latest

### 工作流行为

- macOS 构建 `arm64 / x64 / universal` 三种 `.dmg`
- Linux 构建 `x64 / arm64` 的 `.AppImage / .deb / .rpm`
- Windows 构建 `x64` 的 NSIS `.exe`
- 将所有安装包统一重命名后上传为 GitHub Release 资产
- Release 资产命名风格接近 `cockpit-tools`
  - 例如：`WebClone_0.1.0_aarch64.dmg`
  - 例如：`WebClone_0.1.0_universal.dmg`
  - 例如：`WebClone_0.1.0_x64-setup.exe`
  - 例如：`WebClone_0.1.0_amd64.AppImage`
- 自动生成 `latest.json`
- 自动生成 `SHA256SUMS.txt`
- 自动创建 GitHub Release 草稿
- tag 触发时自动发布为 latest release
- 手动触发仅做构建验链，不生成 `untagged` 草稿发布

## 标准发版步骤

以下流程适用于当前仓库 `tangjiale/web-clone`：

### 1. 更新版本号

修改 [package.json](/Users/tangjiale/Code/self/web-clone/package.json) 中的 `version`。

例如：

```json
{
  "version": "0.1.1"
}
```

### 2. 更新中英文 changelog

分别编辑：

- [CHANGELOG.zh-CN.md](/Users/tangjiale/Code/self/web-clone/CHANGELOG.zh-CN.md)
- [CHANGELOG.md](/Users/tangjiale/Code/self/web-clone/CHANGELOG.md)

新增对应版本段落，格式保持如下：

```md
## [0.1.1] - 2026-04-03
```

说明：

- GitHub Actions 会自动提取当前版本对应的中英文段落生成 Release 文案
- 如果 changelog 里缺少对应版本段，工作流会直接失败

### 3. 同步历史配置版本

```bash
npm run sync-version
```

### 4. 本地构建检查

```bash
npm install
npm run build
```

### 5. 提交代码并打 tag

```bash
git add .
git commit -m "chore: release v0.1.1"
git tag v0.1.1
git push origin main
git push origin v0.1.1
```

### 6. 等待 GitHub Actions 自动发布

工作流会自动：

- 构建多平台安装包
- 创建 GitHub Release 草稿
- 上传所有 release 资产
- 生成 `latest.json`
- 生成 `SHA256SUMS.txt`
- 发布为 latest release

### 7. 验证更新源

发布完成后可检查：

- Release 页面：
  [web-clone releases](https://github.com/tangjiale/web-clone/releases)
- latest.json：
  [latest.json](https://github.com/tangjiale/web-clone/releases/latest/download/latest.json)

### 当前工作流不依赖的内容

- 不依赖 Rust
- 不依赖 Tauri 打包
- 不需要 `TAURI_SIGNING_PRIVATE_KEY`

## 内置更新源与更新配置

当前应用默认内置更新源为：

```text
https://github.com/tangjiale/web-clone/releases/latest/download/latest.json
```

说明：

- 前端页面不提供更新地址编辑入口
- 桌面应用启动后会从后台固定更新源检查版本
- 如需改成其它更新源，可修改 [package.json](/Users/tangjiale/Code/self/web-clone/package.json) 中的 `webCloneUpdateUrl`
- 也可以通过环境变量 `WEB_CLONE_UPDATE_URL` 覆盖

后台更新源支持以下格式。

### 1. GitHub Releases latest 页面地址

例如：

```text
https://github.com/<owner>/<repo>/releases/latest
```

### 2. GitHub Releases Latest API

例如：

```text
https://api.github.com/repos/<owner>/<repo>/releases/latest
```

### 3. workflow 生成的 latest.json

例如：

```text
https://github.com/<owner>/<repo>/releases/latest/download/latest.json
```

说明：

- `latest.json` 会包含 `version / notes / release_url / platforms`
- 应用会按当前系统自动选择合适的安装包链接

### 4. 自定义 JSON

至少包含 `version` 字段，例如：

```json
{
  "version": "0.2.0",
  "releaseNotes": "修复若干已知问题并优化内嵌浏览体验",
  "releaseUrl": "https://github.com/owner/repo/releases/tag/v0.2.0",
  "downloadUrl": "https://github.com/owner/repo/releases/download/v0.2.0/app.dmg"
}
```

### 如果后续需要代码签名

可再扩展以下 Secrets：

- macOS 签名：`CSC_LINK`、`CSC_KEY_PASSWORD`
- Apple notarization：`APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID`
- Windows 签名：代码签名证书相关 Secrets

## 常见命令

```bash
npm install
npm run sync-version
npm run release:package
npm run dev:desktop
npm run build
npm run build:mac
npm run build:mac:arm64
npm run build:mac:x64
npm run build:mac:universal
npm run build:win
npm run build:linux:x64
npm run build:linux:arm64
```

## 已验证

当前本地已验证：

- `npm install`
- `npm run sync-version`
- `npm run build`
- `electron-builder --mac dir`

## 注意事项

### 1. 开发态和正式打包的显示名差异

- 正式打包产物会使用项目名 `网站分身管理器`
- 如果开发态系统切换器里仍短暂看到旧的 `Electron` 壳名称，通常与本机缓存或旧进程未退出有关
- 完全退出旧开发进程后重新启动即可

### 2. 数据存储位置

- 分身浏览数据写入系统用户数据目录
- 不写入项目源码目录

## 后续规划

- 密码保险箱
- 分身导入导出
- 云同步
- 自动更新
- 浏览器下载管理
- 更强的站点兼容策略
- 启动台与最近使用增强

## License

当前仓库为私有项目配置，使用：

```text
UNLICENSED
```
