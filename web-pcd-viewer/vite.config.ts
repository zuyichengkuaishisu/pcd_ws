import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tsconfigPaths from "vite-tsconfig-paths";
import { traeBadgePlugin } from 'vite-plugin-trae-solo-badge';

import {
  applyNavigationMap,
  listLocalMaps,
  requestMappingStatus,
  requestRobotPose,
  requestNavigationTaskStatus,
  startMapping,
  stopMapping,
  submitInitialPoseEstimate,
  submitNavigationTask,
  submitRobotChargeAction,
  type MappingStartPayload,
  type NavigationTaskPayload,
  type RobotChargeAction,
} from "./api/m20RobotProtocol";

const ROBOT_HOST = process.env.M20_ROBOT_HOST ?? "10.21.31.103";
const ROBOT_PORT = Number(process.env.M20_ROBOT_PORT ?? "30001");
const MAPPING_HOST = process.env.M20_MAPPING_HOST ?? "10.21.33.106";
const MAPPING_PORT = Number(process.env.M20_MAPPING_PORT ?? "30100");
const MAP_ASSET_DIR = "/home/wzy/pcd_ws/data/maps/siteB-20260616-105415";
const PCD_PATH = "/home/wzy/pcd_ws/data/pcd_samples/outside_15cm_simpled.pcd";
const OCC_GRID_PGM_PATH = `${MAP_ASSET_DIR}/occ_grid.pgm`;
const OCC_GRID_YAML_PATH = `${MAP_ASSET_DIR}/occ_grid.yaml`;

type ApiHandler = (req: IncomingMessage, res: ServerResponse<IncomingMessage>) => Promise<void>;

async function readJsonBody(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf-8");
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
}

async function readOccGridMeta() {
  const yaml = await readFile(OCC_GRID_YAML_PATH, "utf-8");
  const resolutionMatch = yaml.match(/^resolution:\s*([+-]?\d+(?:\.\d+)?)$/m);
  const originMatch = yaml.match(/^origin:\s*\[([^\]]+)\]$/m);
  if (!resolutionMatch || !originMatch) {
    throw new Error("occ_grid.yaml 缺少 resolution 或 origin");
  }

  const [originX, originY, originYaw] = originMatch[1].split(",").map((value) => Number(value.trim()));
  if ([originX, originY, originYaw].some((value) => Number.isNaN(value))) {
    throw new Error("occ_grid.yaml 的 origin 参数无效");
  }

  const pgm = await readFile(OCC_GRID_PGM_PATH);
  const { width, height } = parsePgmHeader(pgm);

  return {
    resolution: Number(resolutionMatch[1]),
    origin: {
      x: originX,
      y: originY,
      yaw: originYaw,
    },
    width,
    height,
  };
}

function parsePgmHeader(buffer: Buffer) {
  let index = 0;
  const tokens: string[] = [];

  while (tokens.length < 4 && index < buffer.length) {
    const byte = buffer[index];
    if (byte === 35) {
      while (index < buffer.length && buffer[index] !== 10) {
        index += 1;
      }
      index += 1;
      continue;
    }
    if (byte <= 32) {
      index += 1;
      continue;
    }

    const start = index;
    while (index < buffer.length && buffer[index] > 32) {
      index += 1;
    }
    tokens.push(buffer.toString("ascii", start, index));
  }

  if (tokens[0] !== "P5") {
    throw new Error(`暂不支持的 PGM 格式: ${tokens[0] ?? "unknown"}`);
  }

  const width = Number(tokens[1]);
  const height = Number(tokens[2]);
  const maxValue = Number(tokens[3]);
  if ([width, height, maxValue].some((value) => Number.isNaN(value))) {
    throw new Error("PGM 头部尺寸信息无效");
  }

  return { width, height, maxValue };
}

function createRobotPoseHandler(): ApiHandler {
  return async (req, res) => {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");

    if (req.method !== "GET") {
      res.statusCode = 405;
      res.end(JSON.stringify({ ok: false, error: "Method Not Allowed" }));
      return;
    }

    try {
      const response = await requestRobotPose(ROBOT_HOST, ROBOT_PORT);
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true, ...response }));
    } catch (error) {
      res.statusCode = 502;
      res.end(
        JSON.stringify({
          ok: false,
          error: error instanceof Error ? error.message : "机器人位姿请求失败",
          host: ROBOT_HOST,
          port: ROBOT_PORT,
        }),
      );
    }
  };
}

function createInitialPoseHandler(): ApiHandler {
  return async (req, res) => {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");

    if (req.method !== "POST") {
      res.statusCode = 405;
      res.end(JSON.stringify({ ok: false, error: "Method Not Allowed" }));
      return;
    }

    try {
      const body = await readJsonBody(req);
      const pose = {
        x: Number(body.x),
        y: Number(body.y),
        z: Number(body.z),
        yaw: Number(body.yaw),
      };

      if (Object.values(pose).some((value) => Number.isNaN(value))) {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false, error: "位姿参数无效，需要 x/y/z/yaw 数值" }));
        return;
      }

      const response = await submitInitialPoseEstimate(ROBOT_HOST, ROBOT_PORT, pose);
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true, ...response, pose }));
    } catch (error) {
      res.statusCode = 502;
      res.end(
        JSON.stringify({
          ok: false,
          error: error instanceof Error ? error.message : "初始位姿发布失败",
          host: ROBOT_HOST,
          port: ROBOT_PORT,
        }),
      );
    }
  };
}

function createNavigationTaskHandler(): ApiHandler {
  return async (req, res) => {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");

    if (req.method !== "POST") {
      res.statusCode = 405;
      res.end(JSON.stringify({ ok: false, error: "Method Not Allowed" }));
      return;
    }

    try {
      const body = await readJsonBody(req);
      const task: NavigationTaskPayload = {
        Value: Number(body.Value),
        MapID: Number(body.MapID),
        PosX: Number(body.PosX),
        PosY: Number(body.PosY),
        PosZ: Number(body.PosZ),
        AngleYaw: Number(body.AngleYaw),
        PointInfo: Number(body.PointInfo) as 0 | 1 | 3,
        Gait: Number(body.Gait),
        Speed: Number(body.Speed),
        Manner: Number(body.Manner),
        ObsMode: Number(body.ObsMode),
        NavMode: Number(body.NavMode),
      };

      const invalidNumbers = Object.values(task).some((value) => Number.isNaN(value));
      const invalidPointInfo = ![0, 1, 3].includes(task.PointInfo);
      if (invalidNumbers || invalidPointInfo) {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false, error: "导航任务参数无效，需要完整且合法的 `1003/1` 数值参数" }));
        return;
      }

      const response = await submitNavigationTask(ROBOT_HOST, ROBOT_PORT, task);
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true, ...response, task }));
    } catch (error) {
      res.statusCode = 502;
      res.end(
        JSON.stringify({
          ok: false,
          error: error instanceof Error ? error.message : "导航任务下发失败",
          host: ROBOT_HOST,
          port: ROBOT_PORT,
        }),
      );
    }
  };
}

function createNavigationTaskStatusHandler(): ApiHandler {
  return async (req, res) => {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");

    if (req.method !== "GET") {
      res.statusCode = 405;
      res.end(JSON.stringify({ ok: false, error: "Method Not Allowed" }));
      return;
    }

    try {
      const response = await requestNavigationTaskStatus(ROBOT_HOST, ROBOT_PORT);
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true, ...response }));
    } catch (error) {
      res.statusCode = 502;
      res.end(
        JSON.stringify({
          ok: false,
          error: error instanceof Error ? error.message : "导航任务状态查询失败",
          host: ROBOT_HOST,
          port: ROBOT_PORT,
        }),
      );
    }
  };
}

function createRobotChargeHandler(): ApiHandler {
  return async (req, res) => {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");

    if (req.method !== "POST") {
      res.statusCode = 405;
      res.end(JSON.stringify({ ok: false, error: "Method Not Allowed" }));
      return;
    }

    try {
      const body = await readJsonBody(req);
      const charge = Number(body.charge) as RobotChargeAction;
      if (![0, 1].includes(charge)) {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false, error: "充电参数无效，仅支持 `1` 开始充电或 `0` 结束充电" }));
        return;
      }

      const response = await submitRobotChargeAction(ROBOT_HOST, ROBOT_PORT, charge);
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true, ...response }));
    } catch (error) {
      res.statusCode = 502;
      res.end(
        JSON.stringify({
          ok: false,
          error: error instanceof Error ? error.message : "自主充电指令下发失败",
          host: ROBOT_HOST,
          port: ROBOT_PORT,
        }),
      );
    }
  };
}

function createOccGridMetaHandler(): ApiHandler {
  return async (req, res) => {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");

    if (req.method !== "GET") {
      res.statusCode = 405;
      res.end(JSON.stringify({ ok: false, error: "Method Not Allowed" }));
      return;
    }

    try {
      const meta = await readOccGridMeta();
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true, ...meta }));
    } catch (error) {
      res.statusCode = 500;
      res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "读取 occ_grid 元数据失败" }));
    }
  };
}

function createOccGridImageHandler(): ApiHandler {
  return async (req, res) => {
    res.setHeader("Cache-Control", "no-store");

    if (req.method !== "GET") {
      res.statusCode = 405;
      res.end("Method Not Allowed");
      return;
    }

    try {
      const content = await readFile(OCC_GRID_PGM_PATH);
      res.statusCode = 200;
      res.setHeader("Content-Type", "image/x-portable-graymap");
      res.end(content);
    } catch (error) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "读取 occ_grid 图像失败" }));
    }
  };
}

function createPcdHandler(): ApiHandler {
  return async (req, res) => {
    res.setHeader("Cache-Control", "no-store");

    if (req.method !== "GET") {
      res.statusCode = 405;
      res.end("Method Not Allowed");
      return;
    }

    try {
      const content = await readFile(PCD_PATH);
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/octet-stream");
      res.end(content);
    } catch (error) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "读取 PCD 文件失败" }));
    }
  };
}

function createMappingStatusHandler(): ApiHandler {
  return async (req, res) => {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");

    if (req.method !== "GET") {
      res.statusCode = 405;
      res.end(JSON.stringify({ ok: false, error: "Method Not Allowed" }));
      return;
    }

    try {
      const url = new URL(req.url ?? "", "http://localhost");
      const includeMapList = ["1", "true"].includes(url.searchParams.get("includeMapList") ?? "");
      const response = await requestMappingStatus(MAPPING_HOST, MAPPING_PORT, includeMapList);
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true, ...response }));
    } catch (error) {
      res.statusCode = 502;
      res.end(
        JSON.stringify({
          ok: false,
          error: error instanceof Error ? error.message : "建图状态查询失败",
          host: MAPPING_HOST,
          port: MAPPING_PORT,
        }),
      );
    }
  };
}

function createMappingStartHandler(): ApiHandler {
  return async (req, res) => {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");

    if (req.method !== "POST") {
      res.statusCode = 405;
      res.end(JSON.stringify({ ok: false, error: "Method Not Allowed" }));
      return;
    }

    try {
      const body = await readJsonBody(req);
      const payload: MappingStartPayload = {
        mapName: typeof body.mapName === "string" ? body.mapName.trim() : undefined,
        headless: typeof body.headless === "boolean" ? body.headless : undefined,
        outdoor: typeof body.outdoor === "boolean" ? body.outdoor : undefined,
        activateAfterStop: typeof body.activateAfterStop === "boolean" ? body.activateAfterStop : undefined,
        indoorPreset: typeof body.indoorPreset === "boolean" ? body.indoorPreset : undefined,
      };

      const response = await startMapping(MAPPING_HOST, MAPPING_PORT, payload);
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true, ...response, payload }));
    } catch (error) {
      res.statusCode = 502;
      res.end(
        JSON.stringify({
          ok: false,
          error: error instanceof Error ? error.message : "开始建图失败",
          host: MAPPING_HOST,
          port: MAPPING_PORT,
        }),
      );
    }
  };
}

function createMappingStopHandler(): ApiHandler {
  return async (req, res) => {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");

    if (req.method !== "POST") {
      res.statusCode = 405;
      res.end(JSON.stringify({ ok: false, error: "Method Not Allowed" }));
      return;
    }

    try {
      const response = await stopMapping(MAPPING_HOST, MAPPING_PORT);
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true, ...response }));
    } catch (error) {
      res.statusCode = 502;
      res.end(
        JSON.stringify({
          ok: false,
          error: error instanceof Error ? error.message : "停止建图失败",
          host: MAPPING_HOST,
          port: MAPPING_PORT,
        }),
      );
    }
  };
}

function createMappingListHandler(): ApiHandler {
  return async (req, res) => {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");

    if (req.method !== "GET") {
      res.statusCode = 405;
      res.end(JSON.stringify({ ok: false, error: "Method Not Allowed" }));
      return;
    }

    try {
      const url = new URL(req.url ?? "", "http://localhost");
      const limit = Number(url.searchParams.get("limit") ?? "20");
      const sortBy = url.searchParams.get("sortBy") ?? "mtime_desc";
      const response = await listLocalMaps(MAPPING_HOST, MAPPING_PORT, {
        limit: Number.isNaN(limit) ? 20 : limit,
        sortBy,
      });
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true, ...response }));
    } catch (error) {
      res.statusCode = 502;
      res.end(
        JSON.stringify({
          ok: false,
          error: error instanceof Error ? error.message : "本地地图列表查询失败",
          host: MAPPING_HOST,
          port: MAPPING_PORT,
        }),
      );
    }
  };
}

function createMappingApplyHandler(): ApiHandler {
  return async (req, res) => {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");

    if (req.method !== "POST") {
      res.statusCode = 405;
      res.end(JSON.stringify({ ok: false, error: "Method Not Allowed" }));
      return;
    }

    try {
      const body = await readJsonBody(req);
      const mapName = typeof body.mapName === "string" ? body.mapName.trim() : "";
      const mapDir = typeof body.mapDir === "string" ? body.mapDir.trim() : "";
      if (!mapName && !mapDir) {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false, error: "切换地图需要 mapName 或 mapDir" }));
        return;
      }

      const response = await applyNavigationMap(MAPPING_HOST, MAPPING_PORT, {
        mapName: mapName || undefined,
        mapDir: mapDir || undefined,
      });
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true, ...response }));
    } catch (error) {
      res.statusCode = 502;
      res.end(
        JSON.stringify({
          ok: false,
          error: error instanceof Error ? error.message : "切换导航地图失败",
          host: MAPPING_HOST,
          port: MAPPING_PORT,
        }),
      );
    }
  };
}

function robotPoseApiPlugin() {
  const poseHandler = createRobotPoseHandler();
  const initialPoseHandler = createInitialPoseHandler();
  const navigationTaskHandler = createNavigationTaskHandler();
  const navigationTaskStatusHandler = createNavigationTaskStatusHandler();
  const robotChargeHandler = createRobotChargeHandler();
  const occGridMetaHandler = createOccGridMetaHandler();
  const occGridImageHandler = createOccGridImageHandler();
  const pcdHandler = createPcdHandler();
  const mappingStatusHandler = createMappingStatusHandler();
  const mappingStartHandler = createMappingStartHandler();
  const mappingStopHandler = createMappingStopHandler();
  const mappingListHandler = createMappingListHandler();
  const mappingApplyHandler = createMappingApplyHandler();

  return {
    name: "robot-pose-api",
    configureServer(server: { middlewares: { use: (path: string, fn: ApiHandler) => void } }) {
      server.middlewares.use("/api/robot/pose", poseHandler);
      server.middlewares.use("/api/robot/initial-pose", initialPoseHandler);
      server.middlewares.use("/api/robot/navigation-task", navigationTaskHandler);
      server.middlewares.use("/api/robot/navigation-task-status", navigationTaskStatusHandler);
      server.middlewares.use("/api/robot/charge", robotChargeHandler);
      server.middlewares.use("/api/mapping/status", mappingStatusHandler);
      server.middlewares.use("/api/mapping/start", mappingStartHandler);
      server.middlewares.use("/api/mapping/stop", mappingStopHandler);
      server.middlewares.use("/api/mapping/maps", mappingListHandler);
      server.middlewares.use("/api/mapping/apply", mappingApplyHandler);
      server.middlewares.use("/api/map/pcd/outside_15cm_simpled.pcd", pcdHandler);
      server.middlewares.use("/api/map/occ-grid/meta", occGridMetaHandler);
      server.middlewares.use("/api/map/occ-grid/image", occGridImageHandler);
    },
    configurePreviewServer(server: { middlewares: { use: (path: string, fn: ApiHandler) => void } }) {
      server.middlewares.use("/api/robot/pose", poseHandler);
      server.middlewares.use("/api/robot/initial-pose", initialPoseHandler);
      server.middlewares.use("/api/robot/navigation-task", navigationTaskHandler);
      server.middlewares.use("/api/robot/navigation-task-status", navigationTaskStatusHandler);
      server.middlewares.use("/api/robot/charge", robotChargeHandler);
      server.middlewares.use("/api/mapping/status", mappingStatusHandler);
      server.middlewares.use("/api/mapping/start", mappingStartHandler);
      server.middlewares.use("/api/mapping/stop", mappingStopHandler);
      server.middlewares.use("/api/mapping/maps", mappingListHandler);
      server.middlewares.use("/api/mapping/apply", mappingApplyHandler);
      server.middlewares.use("/api/map/pcd/outside_15cm_simpled.pcd", pcdHandler);
      server.middlewares.use("/api/map/occ-grid/meta", occGridMetaHandler);
      server.middlewares.use("/api/map/occ-grid/image", occGridImageHandler);
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  build: {
    sourcemap: 'hidden',
  },
  plugins: [
    react({
      babel: {
        plugins: [
          'react-dev-locator',
        ],
      },
    }),
    traeBadgePlugin({
      variant: 'dark',
      position: 'bottom-right',
      prodOnly: true,
      clickable: true,
      clickUrl: 'https://www.trae.ai/solo?showJoin=1',
      autoTheme: true,
      autoThemeTarget: '#root'
    }), 
    tsconfigPaths(),
    robotPoseApiPlugin()
  ],
})
