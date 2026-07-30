# 个人工作台（Personal Workbench）

一个**纯静态、离线优先、可托管到 GitHub Pages** 的个人工作台。移动端与电脑通用，响应式设计，数据默认存在本地，联网后自动同步到你自己的 **GitHub 私有仓库**。

## 功能模块
- ✅ 任务管理（含事务待办、子任务、优先级、截止日、标签）
- 📅 日程安排（月视图、事件、提醒位）
- 📝 笔记与知识库（笔记 / 私有知识库 / 时间轴 / 灵感，Markdown 支持）
- 🔥 习惯打卡（每日打卡、连续天数、近 7 天可视化）
- 🔖 书签 / 链接（分类收藏、一键打开）
- 💰 记账与成本（收支、分类、固定生活成本台账、月度统计）
- 🎬 内容创作（短视频脚本 / 公众号文章，状态跟踪）
- 🎯 长期规划（年度 / 季度 / 目标 / 里程碑）
- ⚙️ 设置（同步配置、导入导出、主题）

## 技术特点
- 原生 HTML / CSS / JS，**零构建**，直接托管。
- **PWA**：可"安装"到手机/桌面主屏，离线可用。
- 本地存储 **IndexedDB**，离线优先；联网后通过 GitHub API 自动双向同步。
- 同步冲突策略：**按记录时间戳 last-write-wins**（个人单用户场景下简单可靠）。
- 同步采用**软删除（墓碑）**，删除也能跨设备同步。
- 主题：跟随系统 + 深浅色手动切换；界面全中文。

## 部署到 GitHub Pages

### 1. 准备数据仓库（私有）
1. 在 GitHub 新建一个**私有仓库**，例如 `my-workbench-data`（用来存放数据 JSON，不要放网页代码）。
2. 在 GitHub → Settings → Developer settings → Personal access tokens → 生成一个 Token，勾选 **`repo`** 权限。复制保存好。

### 2. 部署网页
方式 A（推荐，仓库即站点）：
1. 新建一个**公开仓库**（如 `workbench`），把本目录所有文件推上去。
2. 仓库 Settings → Pages → Source 选择 `main` 分支根目录 → Save。
3. 等待片刻，访问 `https://<用户名>.github.io/workbench/`。

方式 B（用 GitHub Actions / 任何静态托管）：把本目录作为静态站点发布即可，路径结构保持不变。

### 3. 在应用内配置同步
1. 打开网页 → 进入「⚙️ 设置」。
2. 填写 `仓库（owner/name）` = 你的数据私有仓库，如 `yourname/my-workbench-data`。
3. 填写 Personal Access Token（仅保存在本机浏览器 `localStorage`，不会被上传）。
4. 点「保存配置」→「立即同步」。之后联网时改动会自动同步，离线时本地保存、联网后自动推送。

> 提示：首次同步会在数据仓库创建 `data/*.json` 文件。你也可以随时用「导出全部 JSON / 导入 JSON」做手动备份。

## 本地预览
```bash
# 在项目根目录启动任意静态服务器
python -m http.server 8080
# 浏览器打开 http://localhost:8080
```
> 注意：Service Worker 与 PWA 需要在 `http://` 或 `https://` 下运行（`file://` 直接打开部分功能受限）。

## 目录结构
```
index.html
manifest.webmanifest
sw.js
css/styles.css
js/store.js        # IndexedDB 本地数据层
js/ui.js           # 通用 UI / 主题 / Markdown
js/sync.js         # GitHub 同步引擎
js/app.js          # 外壳 / 路由 / 响应式导航
js/js-modules/     # 各功能模块
icons/             # PWA 图标
```

## 隐私说明
所有业务数据仅存在于你的设备（IndexedDB）与你的 GitHub 私有仓库。Token 仅存浏览器本地，不会被任何第三方获取。
