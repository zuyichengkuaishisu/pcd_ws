# Open Inspection Platform

一个面向四足机器人巡检场景的开源原型平台。

它不是只做点云浏览的 Demo，而是把地图可视化、机器人实时定位、初始位姿发布、任务点编辑、顺序导航下发、充电控制、导航状态查询和建图控制串成一个可直接联调的巡检前端。

## 为什么做这个项目

这个项目最开始并不是一场"按计划推进的标准研发"，而更像是一种被低效流程逼出来的反击。

在很多机器人项目里，真正做 SLAM、导航和联调的人，经常被迫忍受几件事：

- 明明是地图系统，却总有人执着于先做"图片展示"
- 明明问题出在链路没打通，却不断被 UI 假数据、截图和 PPT 掩盖
- 明明现场最需要的是可联调、可观察、可下发的工具，却总有人优先搞表面功能
- 明明一线反馈已经很直接，管理和需求却还在用脱离实际的方式推动项目

这个仓库就是在这种背景下自己动手做出来的。

与其继续把时间耗在低效沟通、错误方向和割裂系统上，不如直接把前端、后端、协议接入和地图交互一起做通，拿一个真正能跑、能看、能联调、能扩展的巡检平台出来。

它带着很明确的态度：

- 机器人地图就该直接看真实地图数据，而不是看截图和图片
- 巡检平台就该把定位、导航、充电、建图放在一套操作链路里
- 工程效率应该建立在真实链路打通之上，而不是建立在"看起来像完成了"的幻觉上

当前工作区以云深处 `M20 / M20 Pro` 为联调目标，地图侧同时支持：

- `PCD` 点云地图显示
- `occ_grid.pgm + occ_grid.yaml` 2D 栅格地图叠加
- `M20` 本体监控协议
- `M20` 建图 UDP 网关协议

## 项目目标

- 让 SLAM 算法、地图、导航、任务编排和机器人状态展示放在同一个操作界面内
- 避免只靠截图、图片或离线工具观察地图，直接在 Web 端查看真实地图数据
- 给机器人巡检业务提供一个可扩展、可二次开发、可开源分享的前后端基础工程

---

## 快速开始（推荐：Docker 部署）

这是最快的方式，部署端只需要装 Docker，不需要 Node、npm 或任何其他依赖。

### 部署端前置要求

在目标机器上安装 Docker 引擎和 Compose 插件（以 Ubuntu/Debian 为例）：

```bash
# 1. 安装 Docker 引擎
sudo apt install -y docker.io

# 2. 安装 Compose 插件（Ubuntu 22.04 上是独立包）
sudo apt install -y docker-compose-v2

# 3. 可选：把自己加到 docker 组，之后不用每次 sudo
sudo usermod -aG docker $USER
# 重新登录后生效
```

### 一键启动

```bash
# 克隆仓库
git clone <你的仓库地址>
cd open-inspection-platform

# 复制配置文件，按需修改机器人地址
cp .env.example .env

# 一键构建并启动
./start-docker.sh
```

浏览器打开 [http://localhost:4174](http://localhost:4174)。

### 一键停止

```bash
./stop-docker.sh
```

### 修改配置

编辑 `.env` 文件，通常只需要改两个地址：

```bash
M20_ROBOT_HOST=10.21.31.103     # 改成你的机器人 IP
M20_MAPPING_HOST=10.21.33.106   # 改成你的建图网关 IP
M20_DEFAULT_MAP_ASSET_NAME=siteB-20260616-105415  # 默认加载的地图名
APP_PORT=4174                   # 对外访问端口
```

改完执行 `./stop-docker.sh && ./start-docker.sh` 重新构建即可。

### Docker 常见问题

**Q: `docker compose` 命令不存在？**

Docker 引擎装了但 Compose 插件没装。Ubuntu/Debian 执行：

```bash
sudo apt install -y docker-compose-v2
```

**Q: 拉取镜像失败 / `connection reset by peer`？**

国内网络访问 Docker Hub 可能不稳定，配置镜像加速器。编辑 `/etc/docker/daemon.json`：

```json
{
  "registry-mirrors": [
    "https://docker.1ms.run",
    "https://docker.xuanyuan.me"
  ]
}
```

然后 `sudo systemctl restart docker`，再重新 `./start-docker.sh`。

---

## 本地开发运行

如果你需要改代码、调试，走本地开发模式：

```bash
cd web-pcd-viewer
npm install
npm run dev -- --host 0.0.0.0 --port 4174
```

访问 [http://localhost:4174](http://localhost:4174)。

环境变量同样可以通过 shell 传入：

```bash
export M20_ROBOT_HOST=10.21.31.103
export M20_ROBOT_PORT=30001
export M20_MAPPING_HOST=10.21.33.106
export M20_MAPPING_PORT=30100
```

---

## 5 分钟上手

如果你第一次打开这个项目，推荐按下面的顺序快速理解整套能力：

1. 打开页面后先切换不同 `PCD` 地图，看点云、点大小、点形状和 `2D` 栅格叠加效果
2. 观察右侧画布中的机器人位姿、右上角导航状态以及左侧机器人定位卡片
3. 在地图上长按拖动添加任务点，分别试一下过渡点、任务点和充电点
4. 修改单个点位的步态、速度、运动方式、停避障和导航方式，查看顺序任务预览
5. 使用初始位姿发布、充电控制、建图控制等卡片，验证整条联调链路

如果要演示"地图能力"而不是"协议能力"，建议优先展示：

- `PCD` 地图切换
- `2D` 栅格叠加
- 楼层分割
- 任务点交互编辑

---

## 当前能力

- 加载并渲染 `PCD` 点云
- 支持前端下拉切换不同 `PCD` 地图资源
- 切换圆点 / 方格点渲染
- 叠加 `2D` 栅格地图并按 `yaml` 原点和分辨率对齐
- 显示 `XYZ` 坐标轴
- 支持按 `Z` 轴做楼层分割，前视图调线后仅显示目标楼层点云
- 支持保存多段楼层预设，并实时显示当前楼层点数
- 轮询机器人地图系位姿并实时显示机器人朝向
- 预留多机器人定位接口与前端主机器人切换结构
- 手动发布 `2101 / 1` 初始位姿
- 长按拖动打点，写入任务点朝向
- 支持过渡点、任务点、充电点三种点位类型
- 为每个点单独配置步态、速度、运动方式、停避障、导航方式
- 按顺序真实下发 `1003 / 1` 单点导航任务
- 查询 `1007 / 1` 导航任务执行状态，并在右上角显示中文状态栏
- 手动控制开始充电 / 结束充电（`Charge=0/1`）
- 到达充电点后自动开始充电，导航前若处于充电中则先结束充电
- 接入 `2200` 建图 UDP 网关，支持开始建图、停止保存、状态轮询、地图列表和切换导航地图

---

## 技术栈

| 层 | 技术 |
|---|---|
| 前端框架 | `React + TypeScript + Vite` |
| 三维渲染 | `Three.js` |
| 状态管理 | `Zustand` |
| 本地 API | `Vite Middleware`（零后端依赖） |
| 机器人协议 | TCP `PatrolDevice` / UDP `SlamGateway` |
| 容器化 | `Docker + docker-compose` |

---

## 目录结构

```
open-inspection-platform/
├── web-pcd-viewer/                  # 主前端工程
│   ├── src/
│   │   ├── components/              # 通用 UI 组件
│   │   │   ├── ControlButton.tsx
│   │   │   ├── MetricCard.tsx
│   │   │   └── ToggleChip.tsx
│   │   ├── hooks/
│   │   │   ├── usePcdScene.ts       # Three.js 场景与交互
│   │   │   └── useRobotPosePolling.ts  # 位姿轮询
│   │   ├── lib/utils.ts             # 通用工具函数
│   │   ├── pages/Home.tsx           # 主页面与控制逻辑
│   │   ├── store/useViewerStore.ts  # 全局状态
│   │   ├── types/navigation.ts      # 任务点与导航类型
│   │   ├── utils/viewerFormat.ts    # 格式化工具
│   │   ├── App.tsx                  # 根组件
│   │   └── main.tsx                 # 入口文件
│   ├── api/m20RobotProtocol.ts      # M20 协议封装
│   ├── index.html
│   ├── package.json
│   ├── vite.config.ts               # API 中间件与路由
│   └── tsconfig.json
├── data/
│   ├── maps/siteB-20260616-105415/  # 完整地图资产
│   │   ├── full_cloud.pcd
│   │   ├── occ_grid.pgm
│   │   └── occ_grid.yaml
│   └── pcd_samples/                 # 测试点云样例
├── pic/                             # 截图与图片资源
├── Dockerfile                       # 容器镜像定义
├── docker-compose.yml               # 容器编排
├── .dockerignore
├── .env.example                     # 配置模板
├── start-docker.sh                  # 一键启动脚本
├── stop-docker.sh                   # 一键停止脚本
├── m20_robot_monitoring_protocol.md   # 机器人协议文档
└── m20_mapping_udp_protocol.md      # 建图协议文档
```

---

## 当前默认资源

默认加载测试点云，页面左侧可下拉切换：

| 来源 | 文件 |
|---|---|
| 样例 | `data/pcd_samples/outside_15cm_simpled.pcd` |
| 样例 | `data/pcd_samples/rv_roof_human_unnoised.pcd` |
| 地图 | `data/maps/siteB-20260616-105415/full_cloud.pcd` |

2D 栅格叠加资源来自 `data/maps/siteB-20260616-105415/occ_grid.pgm` + `occ_grid.yaml`。

> 当前只有 `siteB-20260616-105415` 这套地图资产与内置 `occ_grid` 绑定。切换到其他 PCD 时栅格可能不对齐，这是正常现象。

---

## 协议对接

### 机器人本体协议（TCP）

- 默认地址: `10.21.31.103:30001`
- 协议文档: [m20_robot_monitoring_protocol.md](m20_robot_monitoring_protocol.md)

| API | 协议 | 说明 |
|---|---|---|
| `GET /api/robots/poses` | `1007 / 2` | 多机器人位姿列表 |
| `POST /api/robot/initial-pose` | `2101 / 1` | 发布初始位姿 |
| `POST /api/robot/navigation-task` | `1003 / 1` | 下发单点导航任务 |
| `GET /api/robot/navigation-task-status` | `1007 / 1` | 查询导航任务状态 |
| `POST /api/robot/charge` | `2 / 24` | 充电控制（Charge=0 结束, Charge=1 开始） |

### 建图网关协议（UDP）

- 默认地址: `10.21.33.106:30100`
- 协议文档: [m20_mapping_udp_protocol.md](m20_mapping_udp_protocol.md)

| API | 协议 | 说明 |
|---|---|---|
| `POST /api/mapping/start` | `2200 / 1` | 开始建图 |
| `POST /api/mapping/stop` | `2200 / 2` | 停止建图并保存 |
| `GET /api/mapping/status` | `2200 / 3` | 查询建图状态 |
| `POST /api/mapping/apply` | `2200 / 4` | 切换导航地图 |
| `GET /api/mapping/maps` | `2200 / 6` | 列出本地地图 |

### 地图资源 API

| API | 说明 |
|---|---|
| `GET /api/map/pcd-files` | 列出可切换的 PCD 资源 |
| `GET /api/map/pcd/:id` | 获取指定 PCD 文件 |
| `GET /api/map/occ-grid/meta` | 获取栅格地图元数据 |
| `GET /api/map/occ-grid/image` | 获取栅格地图图像 |

---

## 环境变量完整参考

| 变量 | 默认值 | 说明 |
|---|---|---|
| `M20_ROBOT_HOST` | `10.21.31.103` | 机器人 TCP 地址 |
| `M20_ROBOT_PORT` | `30001` | 机器人 TCP 端口 |
| `M20_MAPPING_HOST` | `10.21.33.106` | 建图 UDP 网关地址 |
| `M20_MAPPING_PORT` | `30100` | 建图 UDP 网关端口 |
| `M20_MAPS_DIR` | `data/maps` | 地图资源目录 |
| `M20_PCD_SAMPLE_DIR` | `data/pcd_samples` | PCD 样例目录 |
| `M20_DEFAULT_MAP_ASSET_NAME` | `siteB-20260616-105415` | 默认地图名 |
| `APP_PORT` | `4174` | 宿主机对外端口 |
| `M20_MULTI_ROBOTS` | — | 多机器人配置（JSON） |

多机器人配置示例：

```bash
export M20_MULTI_ROBOTS='[
  {"id":"robot-a","name":"Robot A","host":"10.21.31.103","port":30001,"color":"#22c55e"},
  {"id":"robot-b","name":"Robot B","host":"10.21.31.104","port":30001,"color":"#38bdf8"}
]'
```

---

## 典型联调流程

这套平台适合按照下面的顺序进行实机联调：

1. 启动前端，确认 `PCD` 地图、点数和机器人定位能正常显示
2. 若定位不准，先下发 `2101 / 1` 初始位姿
3. 在地图上编辑任务点，按任务需要配置每个点位的导航参数
4. 使用右上角导航状态栏观察 `1007 / 1` 返回的中文状态
5. 若任务中包含充电点，验证到点后的自动开始充电逻辑
6. 需要重建地图时，通过 `2200` 建图网关开始建图、停止保存并切换导航地图

---

## 适合展示的亮点

- 同时支持 `3D PCD` 和 `2D 栅格` 地图
- 支持地图下拉切换、楼层分割和楼层预设
- 前端直接对接真实机器人协议，而不是只做离线回放
- 巡检任务点不是静态表单，而是地图上直接交互编辑
- 建图、定位、导航、充电、地图切换都放在一个界面里
- Docker 一键部署，部署端零环境依赖
- 适合继续扩展成完整的机器人巡检平台

---

## 下一步规划

- 接入取消导航 `1004 / 1`
- 接入更多机器人基础状态
- 把多机器人从"接口预留"推进到"场景多 marker 同显"
- 支持建图完成后自动刷新当前地图资源
- 让 `occ_grid` 跟随当前选中的地图资源自动匹配
- 补充截图、录屏和更完整的部署文档

---

## 说明

- `.node/`、`.npm-cache/`、`.npm-home/` 是当前工作区内置的本地运行环境，对部署无影响
- 当前仓库更偏向实机联调型原型，适合二次开发和协议扩展
- 若用于公开开源发布，建议再补一份演示截图和目录级许可证说明
- 如果用于文章或开源首页展示，建议按"问题背景 → 架构思路 → 关键功能 → 协议对接 → 后续规划"的顺序组织内容
