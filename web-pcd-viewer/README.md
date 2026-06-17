# Web PCD Viewer

本项目是一个最小可用的本地点云查看器，使用 `React + TypeScript + Three.js + Vite` 构建。

## 已实现

- 加载并显示 `PCD` 点云
- 鼠标旋转、平移、缩放
- 顶视角和重置视角
- 点大小调节
- 地图原点、边界、尺寸信息显示
- M20 机器人位姿接口接入
- 页面内实时显示 `Location / Position / Yaw / Time`

## 关键目录

- `src/pages/Home.tsx`
  - 主页面与控制面板
- `src/hooks/usePcdScene.ts`
  - Three.js 场景与点云加载
- `src/hooks/useRobotPosePolling.ts`
  - 机器人位姿轮询
- `src/store/useViewerStore.ts`
  - 前端状态管理
- `api/m20RobotProtocol.ts`
  - M20 TCP 协议请求封装
- `../data/maps/siteB-20260616-105415/`
  - 当前默认加载的 `full_cloud.pcd`、`occ_grid.pgm`、`occ_grid.yaml`

## 本地运行

当前工作区使用本地 Node 运行时：

```bash
export PATH=/home/wzy/pcd_ws/.node/node-v24.11.0-linux-x64/bin:$PATH
export HOME=/home/wzy/pcd_ws/.npm-home
export NPM_CONFIG_CACHE=/home/wzy/pcd_ws/.npm-cache
cd /home/wzy/pcd_ws/web-pcd-viewer
npm install
npm run dev -- --host 0.0.0.0 --port 4174
```

## 常用命令

```bash
npm run check
npm run test
npm run lint
```

## 机器人接口

开发环境下页面通过本地接口获取机器人位姿：

- `GET /api/robot/pose`

默认连接：

- `10.21.31.103:30001`

可通过环境变量覆盖：

- `M20_ROBOT_HOST`
- `M20_ROBOT_PORT`
