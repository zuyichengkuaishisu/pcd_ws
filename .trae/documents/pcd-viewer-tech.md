## 1. 架构设计
```mermaid
flowchart LR
    A["浏览器前端"] --> B["React 页面"]
    B --> C["Three.js 场景层"]
    C --> D["PCDLoader"]
    D --> E["本地静态 PCD 文件"]
```

## 2. 技术说明
- 前端：React@18 + TypeScript + Vite + Tailwind CSS
- 3D 渲染：three
- 控制组件：OrbitControls
- 点云加载：PCDLoader
- 状态管理：zustand
- 图标：lucide-react
- 初始化方式：`vite-init` 的 `react-ts` 模板

## 3. 路由定义
| 路由 | 用途 |
|-------|---------|
| / | Web PCD Viewer 主页面，负责加载与查看点云 |

## 4. API 定义
- 首版不引入后端 API
- 点云文件通过 Vite 静态资源目录直接提供访问

## 5. 数据模型
### 5.1 前端状态模型定义
```ts
type ViewerState = {
  pointSize: number
  showGrid: boolean
  showAxes: boolean
  darkBackground: boolean
  pointCount: number
  fileName: string
  mapOrigin: { x: number; y: number; z: number }
  mapMin: { x: number; y: number; z: number }
  mapMax: { x: number; y: number; z: number }
  robotPose: { x: number; y: number; z: number; yaw: number } | null
  status: "idle" | "loading" | "ready" | "error"
  errorMessage: string
}
```

### 5.2 资源组织约定
- `public/pcd/`：存放待加载的 `.pcd` 文件
- `src/components/`：查看器界面组件
- `src/pages/`：页面级容器
- `src/hooks/`：Three.js 场景控制和视角逻辑
- `src/utils/`：点云信息格式化等工具函数
- `src/store/`：地图信息、机器人位姿占位等前端状态

## 6. 实现约束
- 使用 React 桌面优先单页应用
- 不引入动态导入和懒加载
- 允许直接加载工作区中的单个 `.pcd` 文件进行预览
- 首版不做服务端转码，不做超大规模点云分块
- 必须提供顶视角、重置视角、点大小调节、网格与坐标轴开关
- 必须保留原始点云坐标，不通过整体平移改变地图坐标语义
- 必须显示地图原点、包围盒最小值与最大值，便于后续接入机器人定位
- 必须预留机器人位姿数据结构和场景 marker 接口

## 7. 验证方案
- 执行 `npm run check` 验证 TypeScript 与构建质量
- 启动本地开发服务器并在浏览器中检查页面是否成功加载点云
- 验证以下交互：旋转、缩放、平移、顶视角切换、点大小调节
- 验证页面是否显示地图原点、地图起始位置和机器人位姿占位信息
