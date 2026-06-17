# PCD Workspace

这个工作区目前包含两类内容：

- 点云与地图相关脚本、协议文档
- `web-pcd-viewer` 的本地 Web 可视化项目

## 目录说明

- `data/maps/siteB-20260616-105415/`
  - 现场同一套地图资产，包含 `full_cloud.pcd`、`occ_grid.pgm`、`occ_grid.yaml`
- `data/pcd_samples/`
  - 额外样例 `PCD` 点云文件
- `web-pcd-viewer/`
  - React + Three.js 的点云可视化页面
- `.trae/documents/`
  - 当前项目的 PRD 和技术文档
- `pcd_transformer.py`
  - 离线把 `PCD` 转成彩色俯视图的脚本
- `m20_robot_monitoring_protocol.md`
  - M20 机器人监控/定位协议说明

## 当前 Viewer

`web-pcd-viewer` 已支持：

- 加载 `PCD` 点云
- 叠加显示 2D 栅格地图
- 接入 M20 位置接口并显示机器人位姿

默认预览点云文件在：

- `data/maps/siteB-20260616-105415/full_cloud.pcd`

对应栅格文件在：

- `data/maps/siteB-20260616-105415/occ_grid.pgm`
- `data/maps/siteB-20260616-105415/occ_grid.yaml`

## 本地运行

当前环境里没有系统全局 `node/npm`，项目使用工作区内本地运行时：

```bash
export PATH=/home/wzy/pcd_ws/.node/node-v24.11.0-linux-x64/bin:$PATH
export HOME=/home/wzy/pcd_ws/.npm-home
export NPM_CONFIG_CACHE=/home/wzy/pcd_ws/.npm-cache
cd /home/wzy/pcd_ws/web-pcd-viewer
npm run dev -- --host 0.0.0.0 --port 4174
```

## 说明

- `.node/`、`.npm-cache/`、`.npm-home/` 是当前前端项目运行所需的本地运行环境，暂未清理。
- 如果后续要继续整理，可以再把这些本地运行目录单独迁移到更固定的位置。
