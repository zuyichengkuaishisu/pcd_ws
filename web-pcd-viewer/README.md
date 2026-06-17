# Web PCD Viewer

一个面向机器人巡检场景的 Web 地图与控制前端。

项目使用 `React + TypeScript + Three.js + Vite` 构建，目标不是只做点云查看，而是把 `PCD`、2D 栅格、机器人定位、导航任务、充电控制和建图控制放在同一个操作界面内。

## 为什么自己重做

这个前端不是为了“做一个页面”而做的，而是因为我实在受不了很多机器人项目里前后端和业务流程的低效协作。

最典型的问题是：

- 地图系统没有围绕真实地图数据展开，而是习惯先拿图片凑展示
- 机器人联调没有围绕真实协议和状态链路展开，而是先堆假按钮、假状态、假流程
- 真正影响效率的问题没人解决，反而总在外围功能上反复消耗时间

所以这次的思路很直接：

- 不再围绕截图和图片做演示
- 不再围绕割裂页面做假联动
- 直接把 `PCD`、`occ_grid`、定位、导航、充电、建图协议全部打到一个界面里

这个项目本质上是在回答一个问题:

真正可用的机器人巡检平台，应该怎么做。

## 功能特性

- 加载并显示 `PCD` 点云
- 支持下拉切换不同 `PCD` 地图资源
- 支持圆点 / 方格点切换
- 调整点大小、背景、网格、坐标轴
- 顶视角 / 重置视角
- 前视图楼层分割，按 `Z` 轴选择目标楼层点云
- 支持保存多段楼层预设，并显示当前楼层点数
- 叠加 `occ_grid.pgm + occ_grid.yaml` 2D 栅格地图
- 轮询机器人地图系位姿并显示朝向
- 预留多机器人位姿接口与主机器人切换
- 手动发布 `2101 / 1` 初始位姿
- 长按拖动添加任务点并写入方向
- 支持过渡点、任务点、充电点
- 每个任务点可独立配置：
  - 步态
  - 速度
  - 运动方式
  - 停避障
  - 导航方式
- 顺序真实下发 `1003 / 1`
- 查询 `1007 / 1` 并显示中文导航状态栏
- 手动开始充电 / 结束充电
- 自动处理充电点到达后的开始充电逻辑
- 接入建图 UDP 网关：
  - 开始建图
  - 停止建图并保存
  - 查询状态
  - 列出本地地图
  - 切换导航地图

## 页面结构

- 左侧控制栏
  - 显示点云状态、PCD 地图切换、楼层分割、机器人定位、建图控制、任务点编辑、任务点列表、任务预览、初始位姿和充电控制
- 右侧地图画布
  - 显示 `PCD`、2D 栅格、机器人位姿、任务点和导航状态

## 推荐演示顺序

如果你想快速把这个前端展示给别人看，推荐按下面的顺序操作：

1. 先切换不同 `PCD`，展示不是写死一张图，而是支持多地图资源切换
2. 打开 `2D栅格`，说明 `occ_grid.pgm + yaml` 是按地图原点和分辨率叠加的
3. 调大点大小并切换圆点 / 方格，展示点云可视化控制能力
4. 打开楼层分割，切到前视图调上下两条分割线，只显示某一层点云
5. 进入任务点编辑，在地图上长按拖动打点并设置方向
6. 修改点位参数，展示并不是固定点位，而是带导航语义的任务点
7. 最后展示右上角导航状态栏、初始位姿、充电控制和建图控制

## 关键目录

- `src/pages/Home.tsx`
  - 主页面、控制逻辑和各功能卡片
- `src/hooks/usePcdScene.ts`
  - Three.js 场景、点云加载、任务点交互、机器人 marker、2D 栅格叠加
- `src/hooks/useRobotPosePolling.ts`
  - 机器人位姿轮询
- `src/store/useViewerStore.ts`
  - Viewer 全局状态
- `src/types/navigation.ts`
  - 任务点与导航参数定义
- `api/m20RobotProtocol.ts`
  - M20 TCP 与建图 UDP 协议封装
- `vite.config.ts`
  - 本地 API 中间件，包括机器人接口、地图资源和建图接口

## 默认资源

当前默认点云：

- `/api/map/pcd/sample%3Aoutside_15cm_simpled.pcd`

当前页面可切换资源：

- `样例 · outside_15cm_simpled.pcd`
- `样例 · rv_roof_human_unnoised.pcd`
- `地图 · siteB-20260616-105415`

当前 2D 栅格来源：

- `../data/maps/siteB-20260616-105415/occ_grid.pgm`
- `../data/maps/siteB-20260616-105415/occ_grid.yaml`

说明：

- 当前只有 `siteB-20260616-105415` 这套地图资源与内置 `occ_grid` 绑定
- 若切换到其他 `PCD`，页面会提示栅格可能不对齐

## 本地运行

```bash
export PATH=/home/wzy/pcd_ws/.node/node-v24.11.0-linux-x64/bin:$PATH
export HOME=/home/wzy/pcd_ws/.npm-home
export NPM_CONFIG_CACHE=/home/wzy/pcd_ws/.npm-cache

cd /home/wzy/pcd_ws/web-pcd-viewer
npm install
npm run dev -- --host 0.0.0.0 --port 4174
```

访问：

- [http://localhost:4174](http://localhost:4174)

## 常用命令

```bash
npm run check
npm run lint
npm run test
```

## 开发说明

- 场景渲染和交互主要集中在 `src/hooks/usePcdScene.ts`
- 左侧控制面板和业务流程主要集中在 `src/pages/Home.tsx`
- 本地接口全部走 `vite.config.ts` 中间件，便于前端联调时直接转发真实协议
- 当前项目是“前端 + 本地协议桥接”的实机联调结构，不依赖额外后端服务

## 协议接入

### 机器人本体

- `GET /api/robot/pose`
- `GET /api/robots/poses`
- `POST /api/robot/initial-pose`
- `POST /api/robot/navigation-task`
- `GET /api/robot/navigation-task-status`
- `POST /api/robot/charge`

默认连接：

- `10.21.31.103:30001`

### 建图网关

- `GET /api/mapping/status`
- `POST /api/mapping/start`
- `POST /api/mapping/stop`
- `GET /api/mapping/maps`
- `POST /api/mapping/apply`

默认连接：

- `10.21.33.106:30100`

### 地图资源

- `GET /api/map/pcd-files`
- `GET /api/map/pcd/:id`
- `GET /api/map/occ-grid/meta`
- `GET /api/map/occ-grid/image`

## 环境变量

```bash
export M20_ROBOT_HOST=10.21.31.103
export M20_ROBOT_PORT=30001
export M20_MAPPING_HOST=10.21.33.106
export M20_MAPPING_PORT=30100
```

多机器人预留：

```bash
export M20_MULTI_ROBOTS='[
  {"id":"robot-a","name":"Robot A","host":"10.21.31.103","port":30001,"color":"#22c55e"},
  {"id":"robot-b","name":"Robot B","host":"10.21.31.104","port":30001,"color":"#38bdf8"}
]'
```

## 适合继续扩展的方向

- 自动刷新建图完成后的地图资源
- `occ_grid` 随当前地图资源自动切换
- 导航取消与更多状态回读
- 权限系统、任务模板、巡检报告
- 多机器人同屏 marker 与独立状态面板
