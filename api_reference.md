# inspect_agent FastAPI 接口文档

> 项目：`inspect_agent`  
> 基础路径：`/api/agent`  
> 默认端口：`9900`  
> 服务地址示例：`http://10.21.31.104:9900`

---

## 1. 通用说明

### 1.1 统一响应格式

所有已注册接口（除个别异常外）均通过 `resp_info()` 返回 JSON，结构如下：

```json
{
  "code": 10000,
  "msg": "成功!",
  "trace_id": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "data": {}
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `code` | int | 业务状态码，`10000` 表示成功 |
| `msg` | string | 响应消息 |
| `trace_id` | string | 请求追踪 ID（32 位 UUID，无连字符） |
| `data` | any | 业务数据，可选 |
| `page` | object | 分页信息，可选 |
| `extend` | any | 扩展字段，可选 |

### 1.2 常用状态码

| code | 含义 |
|------|------|
| `10000` | 成功 |
| `10001` | 失败 |
| `401` | 未授权 / 设备未登录 |
| `500` | 服务器错误 |
| `503` | 服务不可用（如机器人未连接） |
| `20001` ~ `20031` | 用户相关错误码 |

完整定义见 `toolkit/code_msg.py`。

### 1.3 异步后台任务说明

部分接口使用 `BackgroundTasks`，HTTP 会**立即返回成功**，实际业务在后台执行，例如：

- `POST /api/agent/robot/charging`
- `POST /api/agent/robot/light`
- `POST /api/agent/robot/nav/task`
- `POST /api/agent/light/control`

### 1.3.1 现场联调确认

基于本项目前端与现场手动调用结果，当前已确认以下口径：

- `POST /api/agent/hk/ptz/goto` 的业务成功码同样按顶层 `code = 10000` 判定成功
- `POST /api/agent/light/control` 的业务成功码为顶层 `code = 10000`
- `POST /api/agent/light/control` 中的 `times` 表示报警灯持续时间（秒），不是触发次数

这意味着前端联调时应优先读取统一响应体顶层的 `code` 字段，而不是仅依赖 `data.success`

### 1.4 Swagger 文档

| 环境 | 地址 |
|------|------|
| 非 PROD | `GET /api/agent/docs` |
| OpenAPI JSON | `GET /api/agent/openapi.json` |
| ReDoc | `GET /api/agent/redoc` |

> **注意**：`ENV=PROD` 时文档页不可用（返回 404）。

### 1.5 未注册路由

`api/user/views.py` 中定义了用户相关接口，但**当前未挂载到** `api/router.py`，实际不可访问。

---

## 2. 通用接口

### 2.1 心跳检测

| 项目 | 内容 |
|------|------|
| **方法/路径** | `GET /api/agent/ping` |
| **说明** | 服务存活检测 |

**请求参数**：无

**响应示例**：

```json
{
  "code": 10000,
  "msg": "成功!",
  "trace_id": "abc123...",
  "data": {}
}
```

---

## 3. 四足机器人接口（`/api/agent/robot`）

> 源码：`api/deep_robot/views.py`  
> 依赖：云深处机器人 SDK（`app.state.robot`）

### 3.1 获取机器人状态

| 项目 | 内容 |
|------|------|
| **方法/路径** | `GET /api/agent/robot/status` |

**请求参数**：无

**响应 `data` 结构**：

```json
{
  "connected": true,
  "basic": {
    "motion_state": 1,
    "motion_state_name": "站立",
    "gait": 12290,
    "charge": 0,
    "hes": 0,
    "control_usage_mode": 1,
    "direction": 0,
    "ooa": 0,
    "sleep": 0,
    "power_management": 0,
    "version": "..."
  },
  "motion": {
    "roll": 0.0,
    "pitch": 0.0,
    "yaw": 0.0,
    "linear_x": 0.0,
    "linear_y": 0.0,
    "height": 0.0
  },
  "battery": 85,
  "errors": [{"code": 0, "name": "..."}],
  "is_standing": true,
  "is_charging": false,
  "nav": {},
  "pose": {}
}
```

---

### 3.2 充电控制

| 项目 | 内容 |
|------|------|
| **方法/路径** | `POST /api/agent/robot/charging` |
| **执行方式** | 后台异步 |

**请求 Body（JSON）**：

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `flag` | bool | 否 | `false` | `true` 开始充电；`false` 停止充电 |

**响应**：立即返回成功（后台执行充电指令）

```json
{
  "code": 10000,
  "msg": "成功!",
  "trace_id": "..."
}
```

---

### 3.3 切换使用模式

| 项目 | 内容 |
|------|------|
| **方法/路径** | `GET /api/agent/robot/mode` |

**Query 参数**：

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `mode` | int | `0` | `0` 常规；`1` 导航；`2` 辅助 |

**响应 `data`**：

```json
{
  "success": true,
  "mode": 1
}
```

---

### 3.4 切换运动状态

| 项目 | 内容 |
|------|------|
| **方法/路径** | `GET /api/agent/robot/motion/state` |

**Query 参数**：

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `state` | int | `1` | `0` 空闲；`1` 站立；`2` 关节阻尼/软急停；`3` 开机阻尼；`4` 趴下；`17` RL 控制 |

**响应 `data`**：

```json
{
  "success": true,
  "state": 1
}
```

---

### 3.5 切换步态

| 项目 | 内容 |
|------|------|
| **方法/路径** | `GET /api/agent/robot/motion/gait` |

**Query 参数**：

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `gait` | int | `4097` | `4097` 基础标准；`4099` 楼梯标准；`12290` 平地敏捷；`12291` 楼梯敏捷 |

**响应 `data`**：

```json
{
  "success": true,
  "gait": "0x3012"
}
```

---

### 3.6 运动控制

| 项目 | 内容 |
|------|------|
| **方法/路径** | `POST /api/agent/robot/motion/control` |

**请求 Body（JSON）**：

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `x` | float | 是 | — | x 方向速度/位移 |
| `y` | float | 是 | — | y 方向速度/位移 |
| `z` | float | 否 | `0.0` | z 坐标 |
| `roll` | float | 否 | `0.0` | roll |
| `pitch` | float | 否 | `0.0` | pitch |
| `yaw` | float | 是 | — | yaw |

**响应 `data`**：

```json
{
  "success": true,
  "command": {"x": 0.1, "y": 0.0, "z": 0.0, "roll": 0.0, "pitch": 0.0, "yaw": 0.0}
}
```

---

### 3.7 停止运动

| 项目 | 内容 |
|------|------|
| **方法/路径** | `POST /api/agent/robot/motion/stop` |

**请求参数**：无

**响应 `data`**：`true` / `false`

---

### 3.8 设置前后照明灯

| 项目 | 内容 |
|------|------|
| **方法/路径** | `POST /api/agent/robot/light` |
| **执行方式** | 后台异步 |

**请求 Body（JSON）**：

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `front` | bool | 否 | `false` | 前侧照明灯 |
| `back` | bool | 否 | `false` | 后侧照明灯 |

**响应**：立即返回成功

---

### 3.9 重定位（初始化定位）

| 项目 | 内容 |
|------|------|
| **方法/路径** | `POST /api/agent/robot/nav/init` |

**请求 Body（JSON）**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `x` | float | 是 | x 坐标 |
| `y` | float | 是 | y 坐标 |
| `z` | float | 是 | z 坐标 |
| `yaw` | float | 是 | 航向角 |

**响应 `data`**：

```json
{
  "success": true,
  "pose": {"x": 1.0, "y": 2.0, "z": 0.0, "yaw": 0.5}
}
```

---

### 3.10 获取地图位姿

| 项目 | 内容 |
|------|------|
| **方法/路径** | `GET /api/agent/robot/nav/pose` |

**请求参数**：无

**响应 `data`**：机器人当前地图坐标（SDK 返回结构）

---

### 3.11 获取导航感知状态

| 项目 | 内容 |
|------|------|
| **方法/路径** | `GET /api/agent/robot/nav/sensor` |

**请求参数**：无

**响应 `data`**：导航传感器状态（SDK 返回结构）

---

### 3.12 下发导航任务

| 项目 | 内容 |
|------|------|
| **方法/路径** | `POST /api/agent/robot/nav/task` |
| **执行方式** | 后台异步 |

**请求 Body（JSON）**：

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `x` | float | 是 | — | x 坐标 |
| `y` | float | 是 | — | y 坐标 |
| `z` | float | 是 | — | z 坐标 |
| `yaw` | float | 是 | — | 航向角 |
| `point_type` | float | 否 | `1` | `0` 过渡点；`1` 任务点；`3` 充电点 |
| `gait` | int | 否 | `12290` | 步态 |
| `speed` | int | 否 | `0` | `0` 正常；`1` 低速；`2` 高速 |

**响应**：立即返回成功（后台下发导航）

---

### 3.13 取消导航

| 项目 | 内容 |
|------|------|
| **方法/路径** | `GET /api/agent/robot/nav/cancel` |

**请求参数**：无

**响应 `data`**：SDK 取消结果

---

### 3.14 查询导航状态

| 项目 | 内容 |
|------|------|
| **方法/路径** | `GET /api/agent/robot/nav/status` |

**请求参数**：无

**响应 `data`**：导航状态（SDK 返回结构）

---

## 4. 巡检任务接口（`/api/agent/task`）

> 源码：`api/task/views.py`

### 4.1 同步云端任务数据

| 项目 | 内容 |
|------|------|
| **方法/路径** | `POST /api/agent/task/sync_data` |

**请求 Body（JSON）**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `cmd` | int | 是 | 指令类型 |
| `sn` | string | 是 | 机器人序列号 |
| `taskId` | string | 是 | 任务 ID |
| `mapId` | string | 是 | 地图 ID |
| `jobs` | array | 是 | 任务点列表 |

**`jobs[]` 元素结构**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `vel_line` | float | 线速度 m/s，默认 `0.2`，范围 0.2~0.6 |
| `start_pose` | object | 起点 `{x, y, yaw}`，可为 null |
| `end_pose` | object | 终点 `{x, y, yaw}` |
| `action` | object | 动作配置（拍照/报警等） |
| `record_id` | string | 记录 ID |

**响应**：任务编排执行结果（成功或错误信息）

---

### 4.2 推送巡检指令到 MQTT

| 项目 | 内容 |
|------|------|
| **方法/路径** | `POST /api/agent/task/push_cmd` |

**请求 Body（JSON）**：任意 JSON，原样转发至 MQTT Topic `mqtt/robot/{ROBOT_NUM}/cmd`

**响应**：

```json
{
  "code": 10000,
  "msg": "成功!",
  "trace_id": "..."
}
```

---

### 4.3 获取任务完整状态

| 项目 | 内容 |
|------|------|
| **方法/路径** | `GET /api/agent/task/status` |

**Query 参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `task_id` | string | 是 | 任务 ID |

**响应 `data`**：

```json
{
  "task_id": "task_001",
  "task_status": "RUNNING",
  "error_msg": "",
  "phase": "forward",
  "current_point": 2,
  "progress": {
    "completed": 1,
    "failed": 0,
    "total": 5,
    "percentage": 20.0,
    "completed_points": [0],
    "failed_points": []
  },
  "points": [],
  "failures": [],
  "can_resume": false,
  "has_failure": false
}
```

---

### 4.4 获取任务失败记录

| 项目 | 内容 |
|------|------|
| **方法/路径** | `GET /api/agent/task/failures` |

**Query 参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `task_id` | string | 是 | 任务 ID |

**响应 `data`**：

```json
{
  "task_id": "task_001",
  "total_failures": 1,
  "failures": []
}
```

---

### 4.5 从失败点恢复任务

| 项目 | 内容 |
|------|------|
| **方法/路径** | `POST /api/agent/task/resume` |

**请求 Body（JSON）**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `task_id` | string | 是 | 任务 ID，与 sync_data 下发时一致 |

**响应**：任务恢复执行结果

---

### 4.6 获取任务进度摘要

| 项目 | 内容 |
|------|------|
| **方法/路径** | `GET /api/agent/task/progress` |

**Query 参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `task_id` | string | 是 | 任务 ID |

**响应 `data`**：

```json
{
  "task_id": "task_001",
  "completed": 2,
  "failed": 0,
  "total": 5,
  "percentage": 40.0,
  "current_point": 2,
  "has_failure": false,
  "can_resume": true
}
```

---

## 5. 海康云台接口（`/api/agent/hk`）

> 源码：`api/hk/views.py`  
> 依赖：海康 SDK（`app.state.hik_sdk`），设备 `10.21.31.111:8000`

### 5.1 获取设备基本信息

| 项目 | 内容 |
|------|------|
| **方法/路径** | `GET /api/agent/hk/device/info` |

**响应 `data`**：设备配置信息（SDK 缓存）

---

### 5.2 获取录像起止时间

| 项目 | 内容 |
|------|------|
| **方法/路径** | `GET /api/agent/hk/record/span` |

**Query 参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `channel` | int | 是 | 通道号 |

**响应 `data`**：录像时间范围

---

### 5.3 获取 PTZ 位置

| 项目 | 内容 |
|------|------|
| **方法/路径** | `GET /api/agent/hk/ptz/position` |

**Query 参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `channel` | int | 是 | 通道号 |

**响应 `data`**：

```json
{
  "pan": 180.0,
  "tilt": 45.0,
  "zoom": 1
}
```

---

### 5.4 PTZ 控制

| 项目 | 内容 |
|------|------|
| **方法/路径** | `POST /api/agent/hk/ptz/control` |

**请求 Body（JSON）**：

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `channel` | int | 否 | `1` | 通道号 |
| `command` | int | 是 | — | 控制命令 |
| `stop` | int | 否 | `0` | 停止指令 |

**响应**：

```json
{
  "code": 10000,
  "msg": "PTZ control success",
  "trace_id": "..."
}
```

---

### 5.5 获取图像参数配置

| 项目 | 内容 |
|------|------|
| **方法/路径** | `GET /api/agent/hk/pic/config` |

**Query 参数**：

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `channel` | int | `1` | 通道号 |

**响应 `data`**：图像配置参数

---

### 5.6 设置移动侦测高亮显示

| 项目 | 内容 |
|------|------|
| **方法/路径** | `POST /api/agent/hk/pic/motion-display` |

**请求 Body（JSON）**：

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `channel` | int | 否 | `1` | 通道号 |
| `enable` | int | 否 | `1` | 是否启用 |

---

### 5.7 抓图

| 项目 | 内容 |
|------|------|
| **方法/路径** | `POST /api/agent/hk/capture` |

**请求 Body（JSON）**：

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `channel` | int | 否 | `1` | 通道号 |
| `save_path` | string | 否 | `/opt/image` | 保存路径 |
| `pic_size` | int | 否 | `2` | 图片大小 |
| `pic_quality` | int | 否 | `0` | 图片质量 |
| `compress_size` | int | 否 | `100` | 压缩目标大小 KB |

**响应 `data`**：抓图结果（文件路径、OSS URL 等）

---

### 5.8 云台绝对位置控制

| 项目 | 内容 |
|------|------|
| **方法/路径** | `POST /api/agent/hk/ptz/goto` |

**请求 Body（JSON）**：

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `channel` | int | 否 | `1` | 通道号 |
| `pan_angle` | int | 是 | — | 水平角度 0~360 |
| `tilt_angle` | int | 是 | — | 垂直角度 0~90 |
| `zoom` | int | 否 | `1` | 变倍 1~37 |

**响应 `data`**：

```json
{
  "success": true,
  "message": "云台已转到指定位置",
  "request": {"channel": 1, "pan": 180, "tilt": 45, "zoom": 1}
}
```

**现场联调补充**：

- 实际成功响应仍包裹在统一响应体中，顶层示例为：

```json
{
  "code": 10000,
  "msg": "成功!",
  "trace_id": "495d35ea4c4d434e8bdcd815c5a2cf39",
  "data": {
    "success": true,
    "message": "云台已转到指定位置",
    "request": {"channel": 1, "pan": 45, "tilt": 20, "zoom": 3}
  }
}
```

- 前端接入时应以顶层 `code = 10000` 作为成功判定

---

### 5.9 云台相对位置控制

| 项目 | 内容 |
|------|------|
| **方法/路径** | `POST /api/agent/hk/ptz/relative` |

**请求 Body（JSON）**：

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `channel` | int | 否 | `1` | 通道号 |
| `delta_pan` | int | 是 | — | 水平增量，正右负左 |
| `delta_tilt` | int | 是 | — | 垂直增量，正上负下 |
| `delta_zoom` | int | 否 | `1` | 变倍增量 1~37 |

**响应 `data`**：

```json
{
  "success": true,
  "message": "云台相对移动完成",
  "from_position": {"pan": 180, "tilt": 45, "zoom": 1},
  "to_position": {"pan": 190, "tilt": 50, "zoom": 2},
  "delta": {"pan": 10, "tilt": 5}
}
```

---

### 5.10 变倍控制

| 项目 | 内容 |
|------|------|
| **方法/路径** | `POST /api/agent/hk/zoom` |

**请求 Body（JSON）**：

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `channel` | int | 否 | `1` | 通道号 |
| `is_zoom` | bool | 否 | `true` | `true` 放大；`false` 缩小 |
| `duration` | float | 否 | `0.1` | 缩放持续时间（秒） |

---

### 5.11 焦点控制

| 项目 | 内容 |
|------|------|
| **方法/路径** | `POST /api/agent/hk/focal` |

**请求 Body（JSON）**：

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `channel` | int | 否 | `1` | 通道号 |
| `focus_near` | bool | 否 | `true` | `true` 前调；`false` 后调 |
| `duration` | float | 否 | `0.1` | 持续时间（秒） |

---

## 6. 报警灯接口（`/api/agent/light`）

> 源码：`api/light/views.py`  
> 硬件：`10.21.31.110:8886`（Modbus TCP）

### 6.1 报警灯控制

| 项目 | 内容 |
|------|------|
| **方法/路径** | `POST /api/agent/light/control` |
| **执行方式** | 后台异步（含 3 次失败重试） |

**请求 Body（JSON）**：

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `voice` | bool | 否 | `false` | 是否开启声音 |
| `light` | bool | 否 | `true` | 是否开启灯光 |
| `times` | int | 否 | `10` | 持续时间（秒），到期后自动关闭 |

**响应**：HTTP 立即返回成功；后台执行开灯 → 等待 → 关灯

```json
{
  "code": 10000,
  "msg": "成功!",
  "trace_id": "..."
}
```

**现场联调补充**：

- 手动调用确认成功响应为：

```json
{
  "code": 10000,
  "msg": "成功!"
}
```

- `times` 字段语义为报警灯持续时间（秒），前端导入导出 `path_ZYHZ.json` 时也应按该语义处理

---

### 6.2 设置音量

| 项目 | 内容 |
|------|------|
| **方法/路径** | `GET /api/agent/light/set_volume` |

**Query 参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `value` | int | 是 | 音量大小 |

**响应 `data`**：当前音量值（int）

---

### 6.3 设置灯光模式

| 项目 | 内容 |
|------|------|
| **方法/路径** | `GET /api/agent/light/set_mode` |

**Query 参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `mode` | int | 是 | `1` 红色；`2` 黄色；`3` 绿色 |

**响应 `data`**：`true` / `false` / `null`

---

### 6.4 查询灯光状态

| 项目 | 内容 |
|------|------|
| **方法/路径** | `GET /api/agent/light/get_light_status` |

**请求参数**：无

**响应 `data`**：`true`（开）/ `false`（关）/ `null`（查询失败）

---

## 7. 科聪接口（`/api/agent/kc_api`）

> 源码：`api/kecong/views.py`  
> 依赖：科聪导航服务 `http://10.21.31.178:17808/kc/mrc`

### 7.1 设置推送地址

| 项目 | 内容 |
|------|------|
| **方法/路径** | `POST /api/agent/kc_api/set_push` |

**请求 Body（JSON）**：

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `url` | string | 是 | — | 状态推送地址 |
| `duration` | float | 否 | `0.2` | 推送间隔（秒），范围 0.1~10 |

**响应 `data`**：科聪接口原始返回

---

### 7.2 接收科聪推送消息

| 项目 | 内容 |
|------|------|
| **方法/路径** | `POST /api/agent/kc_api/push` |

**请求 Body（JSON）**：科聪推送的机器人状态数据（原样存储）

**响应 `data`**：接收到的 JSON 数据

---

### 7.3 路径导航

| 项目 | 内容 |
|------|------|
| **方法/路径** | `POST /api/agent/kc_api/path_nav` |

**请求 Body（JSON）**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `type` | int | 否 | `0` 导航到路径点；`1` 导航到路径上的点 |
| `goal_point` | int | 条件 | 目标点 ID（type=0 时必填） |
| `assigned_path` | int[] | 否 | 指定路径点 ID 列表 |
| `forbidden_path` | int[] | 否 | 禁行路径点 ID 列表 |

**响应 `data`**：科聪导航接口返回

---

### 7.4 开启导航（贝塞尔/直线路径）

| 项目 | 内容 |
|------|------|
| **方法/路径** | `POST /api/agent/kc_api/start_nav` |

**请求 Body（JSON）**：

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `vel_line` | float | 否 | `0.2` | 线速度 m/s |
| `walk_direction` | int | 否 | `1` | `0` 正走；`1` 倒走 |
| `start_pose` | object | 否 | — | 起点 `{id, x, y, theta}` |
| `end_pose` | object | 否 | — | 终点 `{id, x, y, theta}` |
| `control1` | object | 否 | — | 贝塞尔控制点1 `{x, y}` |
| `control2` | object | 否 | — | 贝塞尔控制点2 `{x, y}` |
| `path_type` | int | 否 | `1` | `0` 贝塞尔；`1` 直线 |
| `enable_detour` | bool | 否 | `true` | 是否绕障 |
| `detour_offset` | float | 否 | `0.5` | 绕障偏移距离 |

---

### 7.5 暂停导航

| 项目 | 内容 |
|------|------|
| **方法/路径** | `GET /api/agent/kc_api/pause_nav` |

**请求参数**：无

---

### 7.6 恢复导航

| 项目 | 内容 |
|------|------|
| **方法/路径** | `GET /api/agent/kc_api/resume_nav` |

**请求参数**：无

---

### 7.7 取消导航

| 项目 | 内容 |
|------|------|
| **方法/路径** | `GET /api/agent/kc_api/cancel_nav` |

**请求参数**：无

---

### 7.8 初始化定位

| 项目 | 内容 |
|------|------|
| **方法/路径** | `POST /api/agent/kc_api/reset_position` |

**请求 Body（JSON）**：

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `x` | float | 否 | `0.0` | x 坐标 (m) |
| `y` | float | 否 | `0.0` | y 坐标 (m) |
| `theta` | float | 否 | `0.0` | 角度 (rad) |
| `point_id` | int | 否 | `0` | `0` 用手动坐标；非 0 用地图路径点 |

---

### 7.9 切换手/自动模式

| 项目 | 内容 |
|------|------|
| **方法/路径** | `GET /api/agent/kc_api/switch_mode` |

**Query 参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `mode` | int | 是 | `1` 手动；`2` 自动 |

---

### 7.10 手动遥控

| 项目 | 内容 |
|------|------|
| **方法/路径** | `POST /api/agent/kc_api/move` |

**请求 Body（JSON）**：

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `speed_x` | float | 否 | `0.0` | 线速度 x (m/s) |
| `speed_y` | float | 否 | `0.0` | 横移速度 y (m/s) |
| `speed_theta` | float | 否 | `0.0` | 角速度 (rad/s) |

---

### 7.11 动作执行

| 项目 | 内容 |
|------|------|
| **方法/路径** | `POST /api/agent/kc_api/motion` |

**请求 Body（JSON）**：

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `motion_cmd` | int | 是 | — | `0` 无效；`1` 进入充电；`2` 退出充电；`100` 自定义 |
| `robot_type` | int | 否 | `16` | 机器人类型 |
| `motion_index` | int | 是 | — | `0` 趴下；`1` 站立 |

---

### 7.12 上传地图文件

| 项目 | 内容 |
|------|------|
| **方法/路径** | `POST /api/agent/kc_api/upload` |
| **Content-Type** | `multipart/form-data` |

**请求参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `file` | file | 是 | `.xmap` 格式地图文件 |

**响应 `data`**：OSS 上传结果 + `type: "map_file"`

---

### 7.13 同步云端数据（科聪版）

| 项目 | 内容 |
|------|------|
| **方法/路径** | `POST /api/agent/kc_api/sync_data` |

**说明**：当前实现转发至 `push_cmd_inspect`，将请求 JSON 发布到 MQTT。

---

### 7.14 添加地图点位

| 项目 | 内容 |
|------|------|
| **方法/路径** | `GET /api/agent/kc_api/add_point` |

**Query 参数（Body 绑定）**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | 是 | 点位名称 |
| `map_name` | string | 否 | 地图名称，默认 `map` |
| `robot_id` | string | 否 | 机器人 ID |
| `text` | string | 否 | 描述 |
| `x` / `y` / `theta` | float | 否 | 坐标（通常从机器人实时位置填充） |

**响应 `data`**：新建点位 ID（int）

---

### 7.15 获取点位列表

| 项目 | 内容 |
|------|------|
| **方法/路径** | `GET /api/agent/kc_api/get_points` |

**请求参数**：无

**响应 `data`**：点位对象数组

---

### 7.16 单点导航

| 项目 | 内容 |
|------|------|
| **方法/路径** | `GET /api/agent/kc_api/single_nav` |

**Query 参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `start_point_name` | string | 是 | 起点名称 |
| `end_point_name` | string | 是 | 终点名称 |

**响应 `data`**：科聪导航接口返回

---

## 8. 用户接口（未注册，仅供参考）

> 源码：`api/user/views.py`  
> **当前未挂载**，需在 `api/router.py` 中 `include_router(user_router)` 后才可用  
> 完整路径将为：`/api/agent/user/*`

### 8.1 注册

| 项目 | 内容 |
|------|------|
| **方法/路径** | `POST /api/agent/user/register` |

**请求 Body**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `username` | string | 6~20 位 |
| `password` | string | 8~20 位 |
| `re_password` | string | 重复密码 |
| `company` | string | 公司名 |
| `corp` | string | 公司简写 |

**响应 `data`**：用户 ID

---

### 8.2 登录

| 项目 | 内容 |
|------|------|
| **方法/路径** | `POST /api/agent/user/login` |

**请求 Body**：`username` + `password`

**响应 `data`**：

```json
{
  "access_token": "eyJ...",
  "token_type": "Bearer"
}
```

---

### 8.3 忘记密码

| 项目 | 内容 |
|------|------|
| **方法/路径** | `PUT /api/agent/user/forget_password` |

**请求 Body**：`password` + `re_password`

---

### 8.4 退出登录

| 项目 | 内容 |
|------|------|
| **方法/路径** | `GET /api/agent/user/logout` |

---

## 9. 接口索引（快速查阅）

| # | 方法 | 路径 | 模块 |
|---|------|------|------|
| 1 | GET | `/api/agent/ping` | 通用 |
| 2 | GET | `/api/agent/robot/status` | 机器人 |
| 3 | POST | `/api/agent/robot/charging` | 机器人 |
| 4 | GET | `/api/agent/robot/mode` | 机器人 |
| 5 | GET | `/api/agent/robot/motion/state` | 机器人 |
| 6 | GET | `/api/agent/robot/motion/gait` | 机器人 |
| 7 | POST | `/api/agent/robot/motion/control` | 机器人 |
| 8 | POST | `/api/agent/robot/motion/stop` | 机器人 |
| 9 | POST | `/api/agent/robot/light` | 机器人 |
| 10 | POST | `/api/agent/robot/nav/init` | 机器人 |
| 11 | GET | `/api/agent/robot/nav/pose` | 机器人 |
| 12 | GET | `/api/agent/robot/nav/sensor` | 机器人 |
| 13 | POST | `/api/agent/robot/nav/task` | 机器人 |
| 14 | GET | `/api/agent/robot/nav/cancel` | 机器人 |
| 15 | GET | `/api/agent/robot/nav/status` | 机器人 |
| 16 | POST | `/api/agent/task/sync_data` | 任务 |
| 17 | POST | `/api/agent/task/push_cmd` | 任务 |
| 18 | GET | `/api/agent/task/status` | 任务 |
| 19 | GET | `/api/agent/task/failures` | 任务 |
| 20 | POST | `/api/agent/task/resume` | 任务 |
| 21 | GET | `/api/agent/task/progress` | 任务 |
| 22 | GET | `/api/agent/hk/device/info` | 云台 |
| 23 | GET | `/api/agent/hk/record/span` | 云台 |
| 24 | GET | `/api/agent/hk/ptz/position` | 云台 |
| 25 | POST | `/api/agent/hk/ptz/control` | 云台 |
| 26 | GET | `/api/agent/hk/pic/config` | 云台 |
| 27 | POST | `/api/agent/hk/pic/motion-display` | 云台 |
| 28 | POST | `/api/agent/hk/capture` | 云台 |
| 29 | POST | `/api/agent/hk/ptz/goto` | 云台 |
| 30 | POST | `/api/agent/hk/ptz/relative` | 云台 |
| 31 | POST | `/api/agent/hk/zoom` | 云台 |
| 32 | POST | `/api/agent/hk/focal` | 云台 |
| 33 | POST | `/api/agent/light/control` | 报警灯 |
| 34 | GET | `/api/agent/light/set_volume` | 报警灯 |
| 35 | GET | `/api/agent/light/set_mode` | 报警灯 |
| 36 | GET | `/api/agent/light/get_light_status` | 报警灯 |
| 37 | POST | `/api/agent/kc_api/set_push` | 科聪 |
| 38 | POST | `/api/agent/kc_api/push` | 科聪 |
| 39 | POST | `/api/agent/kc_api/path_nav` | 科聪 |
| 40 | POST | `/api/agent/kc_api/start_nav` | 科聪 |
| 41 | GET | `/api/agent/kc_api/pause_nav` | 科聪 |
| 42 | GET | `/api/agent/kc_api/resume_nav` | 科聪 |
| 43 | GET | `/api/agent/kc_api/cancel_nav` | 科聪 |
| 44 | POST | `/api/agent/kc_api/reset_position` | 科聪 |
| 45 | GET | `/api/agent/kc_api/switch_mode` | 科聪 |
| 46 | POST | `/api/agent/kc_api/move` | 科聪 |
| 47 | POST | `/api/agent/kc_api/motion` | 科聪 |
| 48 | POST | `/api/agent/kc_api/upload` | 科聪 |
| 49 | POST | `/api/agent/kc_api/sync_data` | 科聪 |
| 50 | GET | `/api/agent/kc_api/add_point` | 科聪 |
| 51 | GET | `/api/agent/kc_api/get_points` | 科聪 |
| 52 | GET | `/api/agent/kc_api/single_nav` | 科聪 |

---

*文档生成时间：2026-06-25*  
*源码路径：`/home/user/inspect_agent`*
