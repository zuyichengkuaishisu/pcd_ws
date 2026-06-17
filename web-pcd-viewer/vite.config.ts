import { readdir, readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
const PROJECT_DIR = dirname(fileURLToPath(import.meta.url));
const WORKSPACE_DIR = resolve(PROJECT_DIR, "..");
const MAPS_DIR = process.env.M20_MAPS_DIR ? resolve(process.env.M20_MAPS_DIR) : resolve(WORKSPACE_DIR, "data/maps");
const PCD_SAMPLE_DIR = process.env.M20_PCD_SAMPLE_DIR
  ? resolve(process.env.M20_PCD_SAMPLE_DIR)
  : resolve(WORKSPACE_DIR, "data/pcd_samples");
const DEFAULT_MAP_ASSET_NAME = process.env.M20_DEFAULT_MAP_ASSET_NAME ?? "siteB-20260616-105415";
const MAP_ASSET_DIR = resolve(MAPS_DIR, DEFAULT_MAP_ASSET_NAME);
const DEFAULT_PCD_ID = "sample:outside_15cm_simpled.pcd";
const OCC_GRID_PGM_PATH = `${MAP_ASSET_DIR}/occ_grid.pgm`;
const OCC_GRID_YAML_PATH = `${MAP_ASSET_DIR}/occ_grid.yaml`;

type ApiHandler = (req: IncomingMessage, res: ServerResponse<IncomingMessage>) => Promise<void>;
type RobotEndpointConfig = {
  id: string;
  name: string;
  host: string;
  port: number;
  color?: string;
};
type PcdAsset = {
  id: string;
  name: string;
  label: string;
  path: string;
  source: "sample" | "map";
  mapName?: string;
  hasLinkedOccGrid: boolean;
};

async function readJsonBody(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf-8");
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
}

async function listAvailablePcdAssets() {
  const assets: PcdAsset[] = [];

  const sampleEntries = await readdir(PCD_SAMPLE_DIR, { withFileTypes: true });
  for (const entry of sampleEntries) {
    if (!entry.isFile() || !entry.name.endsWith(".pcd")) {
      continue;
    }
    assets.push({
      id: `sample:${entry.name}`,
      name: entry.name,
      label: `样例 · ${entry.name}`,
      path: `${PCD_SAMPLE_DIR}/${entry.name}`,
      source: "sample",
      hasLinkedOccGrid: false,
    });
  }

  const mapEntries = await readdir(MAPS_DIR, { withFileTypes: true });
  for (const entry of mapEntries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const fileName = "full_cloud.pcd";
    const path = resolve(MAPS_DIR, entry.name, fileName);
    const hasLinkedOccGrid = entry.name === DEFAULT_MAP_ASSET_NAME;
    try {
      await readFile(path);
      assets.push({
        id: `map:${entry.name}:${fileName}`,
        name: fileName,
        label: `地图 · ${entry.name}`,
        path,
        source: "map",
        mapName: entry.name,
        hasLinkedOccGrid,
      });
    } catch {
      // Ignore directories without full_cloud.pcd
    }
  }

  assets.sort((left, right) => {
    if (left.id === DEFAULT_PCD_ID) {
      return -1;
    }
    if (right.id === DEFAULT_PCD_ID) {
      return 1;
    }
    return left.label.localeCompare(right.label, "zh-CN");
  });
  return assets;
}

async function findPcdAssetById(id: string) {
  const assets = await listAvailablePcdAssets();
  return assets.find((asset) => asset.id === id) ?? null;
}

function getRobotEndpointConfigs(): RobotEndpointConfig[] {
  const fallback = [
    {
      id: "robot-1",
      name: "Robot 1",
      host: ROBOT_HOST,
      port: ROBOT_PORT,
      color: "#22c55e",
    },
  ] satisfies RobotEndpointConfig[];

  const raw = process.env.M20_MULTI_ROBOTS?.trim();
  if (!raw) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return fallback;
    }

    const configs = parsed
      .map((item, index) => {
        const record = typeof item === "object" && item !== null ? (item as Record<string, unknown>) : null;
        if (!record) {
          return null;
        }

        const host = typeof record.host === "string" ? record.host.trim() : "";
        const port = Number(record.port);
        if (!host || Number.isNaN(port)) {
          return null;
        }

        const config: RobotEndpointConfig = {
          id: typeof record.id === "string" && record.id.trim() ? record.id.trim() : `robot-${index + 1}`,
          name: typeof record.name === "string" && record.name.trim() ? record.name.trim() : `Robot ${index + 1}`,
          host,
          port,
          color: typeof record.color === "string" && record.color.trim() ? record.color.trim() : undefined,
        };
        return config;
      })
      .filter((item): item is RobotEndpointConfig => item !== null);

    return configs.length > 0 ? configs : fallback;
  } catch {
    return fallback;
  }
}

async function requestRobotPoses(configs: RobotEndpointConfig[]) {
  const results = await Promise.allSettled(
    configs.map(async (config) => {
      const response = await requestRobotPose(config.host, config.port);
      return {
        id: config.id,
        name: config.name,
        host: config.host,
        port: config.port,
        color: config.color,
        connectionStatus: "ready" as const,
        location: response.location,
        pose: response.pose,
        timestamp: response.timestamp,
      };
    }),
  );

  const robots = results.map((result, index) => {
    const config = configs[index];
    if (result.status === "fulfilled") {
      return result.value;
    }

    return {
      id: config.id,
      name: config.name,
      host: config.host,
      port: config.port,
      color: config.color,
      connectionStatus: "error" as const,
      error: result.reason instanceof Error ? result.reason.message : "机器人位姿请求失败",
    };
  });

  const hasReadyRobot = robots.some((robot) => robot.connectionStatus === "ready");
  return {
    ok: hasReadyRobot,
    robots,
    error: hasReadyRobot ? undefined : "所有机器人位姿请求均失败",
  };
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
      const configs = getRobotEndpointConfigs();
      const primary = configs[0];
      const response = await requestRobotPose(primary.host, primary.port);
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

function createRobotPosesHandler(): ApiHandler {
  return async (req, res) => {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");

    if (req.method !== "GET") {
      res.statusCode = 405;
      res.end(JSON.stringify({ ok: false, error: "Method Not Allowed" }));
      return;
    }

    try {
      const result = await requestRobotPoses(getRobotEndpointConfigs());
      res.statusCode = result.ok ? 200 : 502;
      res.end(JSON.stringify(result));
    } catch (error) {
      res.statusCode = 502;
      res.end(
        JSON.stringify({
          ok: false,
          error: error instanceof Error ? error.message : "多机器人位姿请求失败",
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
      const url = new URL(req.url ?? "", "http://localhost");
      const rawPath = url.pathname.replace(/^\/api\/map\/pcd\//, "").replace(/^\/+/, "");
      const pcdId = decodeURIComponent(rawPath);
      const asset = await findPcdAssetById(pcdId);
      if (!asset) {
        res.statusCode = 404;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ ok: false, error: "PCD 资源不存在" }));
        return;
      }

      const content = await readFile(asset.path);
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

function createPcdListHandler(): ApiHandler {
  return async (req, res) => {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");

    if (req.method !== "GET") {
      res.statusCode = 405;
      res.end(JSON.stringify({ ok: false, error: "Method Not Allowed" }));
      return;
    }

    try {
      const assets = await listAvailablePcdAssets();
      res.statusCode = 200;
      res.end(
        JSON.stringify({
          ok: true,
          defaultPcdId: DEFAULT_PCD_ID,
          items: assets.map((asset) => ({
            id: asset.id,
            name: asset.name,
            label: asset.label,
            source: asset.source,
            mapName: asset.mapName ?? "",
            hasLinkedOccGrid: asset.hasLinkedOccGrid,
            url: `/api/map/pcd/${encodeURIComponent(asset.id)}`,
          })),
        }),
      );
    } catch (error) {
      res.statusCode = 500;
      res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "读取 PCD 列表失败" }));
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
  const posesHandler = createRobotPosesHandler();
  const initialPoseHandler = createInitialPoseHandler();
  const navigationTaskHandler = createNavigationTaskHandler();
  const navigationTaskStatusHandler = createNavigationTaskStatusHandler();
  const robotChargeHandler = createRobotChargeHandler();
  const occGridMetaHandler = createOccGridMetaHandler();
  const occGridImageHandler = createOccGridImageHandler();
  const pcdHandler = createPcdHandler();
  const pcdListHandler = createPcdListHandler();
  const mappingStatusHandler = createMappingStatusHandler();
  const mappingStartHandler = createMappingStartHandler();
  const mappingStopHandler = createMappingStopHandler();
  const mappingListHandler = createMappingListHandler();
  const mappingApplyHandler = createMappingApplyHandler();

  return {
    name: "robot-pose-api",
    configureServer(server: { middlewares: { use: (path: string, fn: ApiHandler) => void } }) {
      server.middlewares.use("/api/robot/pose", poseHandler);
      server.middlewares.use("/api/robots/poses", posesHandler);
      server.middlewares.use("/api/robot/initial-pose", initialPoseHandler);
      server.middlewares.use("/api/robot/navigation-task", navigationTaskHandler);
      server.middlewares.use("/api/robot/navigation-task-status", navigationTaskStatusHandler);
      server.middlewares.use("/api/robot/charge", robotChargeHandler);
      server.middlewares.use("/api/mapping/status", mappingStatusHandler);
      server.middlewares.use("/api/mapping/start", mappingStartHandler);
      server.middlewares.use("/api/mapping/stop", mappingStopHandler);
      server.middlewares.use("/api/mapping/maps", mappingListHandler);
      server.middlewares.use("/api/mapping/apply", mappingApplyHandler);
      server.middlewares.use("/api/map/pcd-files", pcdListHandler);
      server.middlewares.use("/api/map/pcd/", pcdHandler);
      server.middlewares.use("/api/map/occ-grid/meta", occGridMetaHandler);
      server.middlewares.use("/api/map/occ-grid/image", occGridImageHandler);
    },
    configurePreviewServer(server: { middlewares: { use: (path: string, fn: ApiHandler) => void } }) {
      server.middlewares.use("/api/robot/pose", poseHandler);
      server.middlewares.use("/api/robots/poses", posesHandler);
      server.middlewares.use("/api/robot/initial-pose", initialPoseHandler);
      server.middlewares.use("/api/robot/navigation-task", navigationTaskHandler);
      server.middlewares.use("/api/robot/navigation-task-status", navigationTaskStatusHandler);
      server.middlewares.use("/api/robot/charge", robotChargeHandler);
      server.middlewares.use("/api/mapping/status", mappingStatusHandler);
      server.middlewares.use("/api/mapping/start", mappingStartHandler);
      server.middlewares.use("/api/mapping/stop", mappingStopHandler);
      server.middlewares.use("/api/mapping/maps", mappingListHandler);
      server.middlewares.use("/api/mapping/apply", mappingApplyHandler);
      server.middlewares.use("/api/map/pcd-files", pcdListHandler);
      server.middlewares.use("/api/map/pcd/", pcdHandler);
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
