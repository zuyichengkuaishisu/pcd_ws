import { readdir, readFile } from "node:fs/promises";
import dgram from "node:dgram";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tsconfigPaths from "vite-tsconfig-paths";
import { traeBadgePlugin } from 'vite-plugin-trae-solo-badge';

import {
  applyNavigationMap,
  cancelNavigationTask,
  listLocalMaps,
  requestMappingStatus,
  requestRobotPose,
  requestNavigationTaskStatus,
  startMapping,
  stopMapping,
  submitRobotAxisControl,
  submitInitialPoseEstimate,
  submitNavigationTask,
  submitRobotChargeAction,
  submitRobotMotionAction,
  type MappingStartPayload,
  type NavigationTaskPayload,
  type RobotAxisControlPayload,
  type RobotChargeAction,
  type RobotMotionAction,
} from "./api/m20RobotProtocol";

let ROBOT_HOST = process.env.M20_ROBOT_HOST ?? "10.21.31.103";
let ROBOT_PORT = Number(process.env.M20_ROBOT_PORT ?? "30001");
let ROBOT_UDP_PORT = Number(process.env.M20_ROBOT_UDP_PORT ?? "30000");
let MAPPING_HOST = process.env.M20_MAPPING_HOST ?? "10.21.33.106";
let MAPPING_PORT = Number(process.env.M20_MAPPING_PORT ?? "30100");
let AGENT_BASE_URL = (process.env.M20_AGENT_BASE_URL ?? "http://10.21.31.104:9900").replace(/\/+$/, "");
const PROJECT_DIR = dirname(fileURLToPath(import.meta.url));
const WORKSPACE_DIR = resolve(PROJECT_DIR, "..");
const MAPS_DIR = process.env.M20_MAPS_DIR ? resolve(process.env.M20_MAPS_DIR) : resolve(WORKSPACE_DIR, "data/maps");
const PCD_SAMPLE_DIR = process.env.M20_PCD_SAMPLE_DIR
  ? resolve(process.env.M20_PCD_SAMPLE_DIR)
  : resolve(WORKSPACE_DIR, "data/pcd_samples");
const DEFAULT_PCD_ID = "sample:outside_15cm_simpled.pcd";
const HEARTBEAT_INTERVAL_MS = Number(process.env.M20_HEARTBEAT_INTERVAL_MS ?? "1000");
const HEARTBEAT_STALE_MS = Number(process.env.M20_HEARTBEAT_STALE_MS ?? "5000");
const PATROL_SYNC_HEADER = Buffer.from([0xeb, 0x91, 0xeb, 0x90]);

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
type AgentPtzGotoPayload = {
  channel?: number;
  pan_angle: number;
  tilt_angle: number;
  zoom?: number;
};
type AgentLightControlPayload = {
  voice?: boolean;
  light?: boolean;
  times?: number;
};
type RobotChargeRuntimeSnapshot = {
  connection: "idle" | "ready" | "error";
  charge: number | null;
  motionState: number | null;
  timestamp: string;
  sourceHost: string;
  sourcePort: number | null;
  localPort: number | null;
  message: string;
  error: string;
};

function formatProtocolTime() {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

function nextMessageId() {
  return Math.floor(Math.random() * 0xffff);
}

function buildPatrolJsonPacket(body: Record<string, unknown>) {
  const payload = Buffer.from(JSON.stringify(body), "utf-8");
  const header = Buffer.concat([
    PATROL_SYNC_HEADER,
    Buffer.from(Uint16Array.of(payload.length).buffer),
    Buffer.from(Uint16Array.of(nextMessageId()).buffer),
    Buffer.from([0x01]),
    Buffer.alloc(7, 0),
  ]);
  return Buffer.concat([header, payload]);
}

function parsePatrolJsonFrame(message: Buffer) {
  if (message.length < 16 || !message.subarray(0, 4).equals(PATROL_SYNC_HEADER)) {
    return null;
  }
  const asduLength = message.readUInt16LE(4);
  const asduFormat = message.readUInt8(8);
  if (asduFormat !== 0x01 || message.length < 16 + asduLength) {
    return null;
  }
  try {
    return JSON.parse(message.subarray(16, 16 + asduLength).toString("utf-8")) as {
      PatrolDevice?: {
        Type?: number;
        Command?: number;
        Time?: string;
        Items?: Record<string, unknown>;
      };
    };
  } catch {
    return null;
  }
}

class RobotChargeRuntimeBridge {
  private socket: dgram.Socket | null = null;
  private started = false;
  private lastUpdatedAt = 0;
  private snapshot: RobotChargeRuntimeSnapshot = {
    connection: "idle",
    charge: null,
    motionState: null,
    timestamp: "",
    sourceHost: "",
    sourcePort: null,
    localPort: null,
    message: "等待机器人基础状态上报。",
    error: "",
  };

  start() {
    if (this.started) {
      return;
    }

    this.started = true;
    this.socket = dgram.createSocket("udp4");

    this.socket.on("message", (message, remoteInfo) => {
      const parsed = parsePatrolJsonFrame(message);
      const patrol = parsed?.PatrolDevice;
      const basicStatus =
        patrol?.Type === 1002 && patrol?.Command === 6 && patrol.Items && typeof patrol.Items.BasicStatus === "object"
          ? (patrol.Items.BasicStatus as Record<string, unknown>)
          : null;

      if (!basicStatus) {
        return;
      }

      this.lastUpdatedAt = Date.now();
      this.snapshot = {
        connection: "ready",
        charge: Number(basicStatus.Charge ?? 0),
        motionState: Number(basicStatus.MotionState ?? 0),
        timestamp: patrol?.Time ?? "",
        sourceHost: remoteInfo.address,
        sourcePort: remoteInfo.port,
        localPort: this.snapshot.localPort,
        message: "已收到机器人基础状态上报。",
        error: "",
      };
    });

    this.socket.on("error", (error) => {
      this.snapshot = {
        ...this.snapshot,
        connection: "error",
        message: "机器人基础状态桥接异常。",
        error: error.message,
      };
    });

    this.socket.bind(0, "0.0.0.0", () => {
      if (!this.socket) {
        return;
      }
      const address = this.socket.address();
      this.snapshot = {
        ...this.snapshot,
        localPort: typeof address === "string" ? null : address.port,
        message: "心跳监听已启动，等待机器人基础状态上报。",
        error: "",
      };
      this.sendHeartbeat();
      setInterval(() => {
        this.sendHeartbeat();
      }, HEARTBEAT_INTERVAL_MS);
    });
  }

  getSnapshot(): RobotChargeRuntimeSnapshot {
    if (this.snapshot.connection === "ready" && this.lastUpdatedAt > 0 && Date.now() - this.lastUpdatedAt > HEARTBEAT_STALE_MS) {
      return {
        ...this.snapshot,
        connection: "idle",
        message: "基础状态上报已超时，等待新的心跳状态。",
      };
    }
    return this.snapshot;
  }

  private sendHeartbeat() {
    if (!this.socket) {
      return;
    }
    const packet = buildPatrolJsonPacket({
      PatrolDevice: {
        Type: 100,
        Command: 100,
        Time: formatProtocolTime(),
        Items: {},
      },
    });
    this.socket.send(packet, ROBOT_UDP_PORT, ROBOT_HOST, (error) => {
      if (error) {
        this.snapshot = {
          ...this.snapshot,
          connection: "error",
          message: "发送心跳失败。",
          error: error.message,
        };
      }
    });
  }
}

const robotChargeRuntimeBridge = new RobotChargeRuntimeBridge();

async function readJsonBody(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf-8");
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
}

async function postAgentJson<TPayload extends Record<string, unknown>>(path: string, payload: TPayload) {
  const response = await fetch(`${AGENT_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text) as unknown;
    } catch {
      data = text;
    }
  }

  if (!response.ok) {
    const errorMessage =
      typeof data === "object" && data !== null && "message" in data && typeof (data as { message?: unknown }).message === "string"
        ? (data as { message: string }).message
        : `Agent 接口请求失败: HTTP ${response.status}`;
    throw new Error(errorMessage);
  }

  return {
    status: response.status,
    data,
  };
}

async function getAgentJson(path: string, query?: Record<string, string | number | boolean | undefined>) {
  const url = new URL(`${AGENT_BASE_URL}${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined) {
        continue;
      }
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  });

  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text) as unknown;
    } catch {
      data = text;
    }
  }

  if (!response.ok) {
    const errorMessage =
      typeof data === "object" && data !== null && "message" in data && typeof (data as { message?: unknown }).message === "string"
        ? (data as { message: string }).message
        : `Agent 接口请求失败: HTTP ${response.status}`;
    throw new Error(errorMessage);
  }

  return {
    status: response.status,
    data,
  };
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
    const mapDir = resolve(MAPS_DIR, entry.name);
    const mapFileEntries = await readdir(mapDir, { withFileTypes: true });
    const hasLinkedOccGrid =
      mapFileEntries.some((fileEntry) => fileEntry.isFile() && fileEntry.name === "occ_grid.pgm") &&
      mapFileEntries.some((fileEntry) => fileEntry.isFile() && fileEntry.name === "occ_grid.yaml");
    const pcdFiles = mapFileEntries
      .filter((fileEntry) => fileEntry.isFile() && fileEntry.name.endsWith(".pcd"))
      .map((fileEntry) => fileEntry.name)
      .sort((left, right) => {
        if (left === "full_cloud.pcd") {
          return -1;
        }
        if (right === "full_cloud.pcd") {
          return 1;
        }
        return left.localeCompare(right, "zh-CN");
      });

    for (const fileName of pcdFiles) {
      const path = resolve(mapDir, fileName);
      const label = pcdFiles.length === 1 ? `地图 · ${entry.name}` : `地图 · ${entry.name} / ${fileName}`;
      assets.push({
        id: `map:${entry.name}:${fileName}`,
        name: fileName,
        label,
        path,
        source: "map",
        mapName: entry.name,
        hasLinkedOccGrid,
      });
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

async function resolveOccGridPathsByPcdId(pcdId: string | null) {
  if (!pcdId) {
    return null;
  }

  const asset = await findPcdAssetById(pcdId);
  if (!asset || asset.source !== "map" || !asset.mapName || !asset.hasLinkedOccGrid) {
    return null;
  }

  const mapDir = resolve(MAPS_DIR, asset.mapName);
  return {
    pgmPath: resolve(mapDir, "occ_grid.pgm"),
    yamlPath: resolve(mapDir, "occ_grid.yaml"),
  };
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

async function readOccGridMeta(yamlPath: string, pgmPath: string) {
  const yaml = await readFile(yamlPath, "utf-8");
  const resolutionMatch = yaml.match(/^resolution:\s*([+-]?\d+(?:\.\d+)?)$/m);
  const originMatch = yaml.match(/^origin:\s*\[([^\]]+)\]$/m);
  if (!resolutionMatch || !originMatch) {
    throw new Error("occ_grid.yaml 缺少 resolution 或 origin");
  }

  const [originX, originY, originYaw] = originMatch[1].split(",").map((value) => Number(value.trim()));
  if ([originX, originY, originYaw].some((value) => Number.isNaN(value))) {
    throw new Error("occ_grid.yaml 的 origin 参数无效");
  }

  const pgm = await readFile(pgmPath);
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
        z: Number(body.z ?? 0),
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

function createNavigationTaskCancelHandler(): ApiHandler {
  return async (req, res) => {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");

    if (req.method !== "POST") {
      res.statusCode = 405;
      res.end(JSON.stringify({ ok: false, error: "Method Not Allowed" }));
      return;
    }

    try {
      const response = await cancelNavigationTask(ROBOT_HOST, ROBOT_PORT);
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true, ...response }));
    } catch (error) {
      res.statusCode = 502;
      res.end(
        JSON.stringify({
          ok: false,
          error: error instanceof Error ? error.message : "取消导航任务失败",
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
      if (![0, 1, 2].includes(charge)) {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false, error: "充电参数无效，仅支持 `1` 开始充电、`0` 结束充电或 `2` 清除充电状态并退桩" }));
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

function createRobotChargeRuntimeHandler(): ApiHandler {
  return async (req, res) => {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");

    if (req.method !== "GET") {
      res.statusCode = 405;
      res.end(JSON.stringify({ ok: false, error: "Method Not Allowed" }));
      return;
    }

    robotChargeRuntimeBridge.start();
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true, ...robotChargeRuntimeBridge.getSnapshot() }));
  };
}

function createRobotSoftEstopHandler(): ApiHandler {
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
      const motion = Number(body.motion ?? 2) as RobotMotionAction;
      if (![0, 1, 2, 3, 4, 17].includes(motion)) {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false, error: "运动状态参数无效，仅支持 `0/1/2/3/4/17`" }));
        return;
      }

      const response = await submitRobotMotionAction(ROBOT_HOST, ROBOT_PORT, motion);
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true, ...response, motion }));
    } catch (error) {
      res.statusCode = 502;
      res.end(
        JSON.stringify({
          ok: false,
          error: error instanceof Error ? error.message : "软急停下发失败",
          host: ROBOT_HOST,
          port: ROBOT_PORT,
        }),
      );
    }
  };
}

function createRobotAxisControlHandler(): ApiHandler {
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
      const command: RobotAxisControlPayload = {
        x: Number(body.x ?? 0),
        y: Number(body.y ?? 0),
        z: Number(body.z ?? 0),
        roll: Number(body.roll ?? 0),
        pitch: Number(body.pitch ?? 0),
        yaw: Number(body.yaw ?? 0),
      };

      const values = Object.values(command);
      const hasInvalidValue = values.some((value) => Number.isNaN(value) || value < -1 || value > 1);
      if (hasInvalidValue) {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false, error: "轴指令参数无效，需要 `[-1,1]` 范围内的 x/y/z/roll/pitch/yaw 数值" }));
        return;
      }

      const response = await submitRobotAxisControl(ROBOT_HOST, ROBOT_PORT, command);
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true, ...response, command }));
    } catch (error) {
      res.statusCode = 502;
      res.end(
        JSON.stringify({
          ok: false,
          error: error instanceof Error ? error.message : "轴指令下发失败",
          host: ROBOT_HOST,
          port: ROBOT_PORT,
        }),
      );
    }
  };
}

function createAgentPtzGotoHandler(): ApiHandler {
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
      const payload: AgentPtzGotoPayload = {
        channel: Number(body.channel ?? 1),
        pan_angle: Number(body.pan_angle),
        tilt_angle: Number(body.tilt_angle),
        zoom: Number(body.zoom ?? 1),
      };

      const hasInvalidValue = [payload.channel, payload.pan_angle, payload.tilt_angle, payload.zoom].some((value) => Number.isNaN(value));
      if (hasInvalidValue) {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false, error: "云台参数无效，需要 channel/pan_angle/tilt_angle/zoom 数值" }));
        return;
      }

      const result = await postAgentJson("/api/agent/hk/ptz/goto", payload as Record<string, unknown>);
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true, agentBaseUrl: AGENT_BASE_URL, ...result }));
    } catch (error) {
      res.statusCode = 502;
      res.end(
        JSON.stringify({
          ok: false,
          error: error instanceof Error ? error.message : "云台控制失败",
          agentBaseUrl: AGENT_BASE_URL,
        }),
      );
    }
  };
}

function createAgentPtzPositionHandler(): ApiHandler {
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
      const channel = Number(url.searchParams.get("channel") ?? 1);
      if (Number.isNaN(channel)) {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false, error: "云台参数无效，需要 channel 数值" }));
        return;
      }

      const result = await getAgentJson("/api/agent/hk/ptz/position", { channel });
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true, agentBaseUrl: AGENT_BASE_URL, ...result }));
    } catch (error) {
      res.statusCode = 502;
      res.end(
        JSON.stringify({
          ok: false,
          error: error instanceof Error ? error.message : "云台位置查询失败",
          agentBaseUrl: AGENT_BASE_URL,
        }),
      );
    }
  };
}

function createAgentLightControlHandler(): ApiHandler {
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
      const payload: AgentLightControlPayload = {
        voice: Boolean(body.voice ?? false),
        light: Boolean(body.light ?? true),
        times: Number(body.times ?? 10),
      };

      if (Number.isNaN(payload.times)) {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false, error: "报警灯参数无效，需要 times 数值" }));
        return;
      }

      const result = await postAgentJson("/api/agent/light/control", payload as Record<string, unknown>);
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true, agentBaseUrl: AGENT_BASE_URL, ...result }));
    } catch (error) {
      res.statusCode = 502;
      res.end(
        JSON.stringify({
          ok: false,
          error: error instanceof Error ? error.message : "报警灯控制失败",
          agentBaseUrl: AGENT_BASE_URL,
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
      const url = new URL(req.url ?? "", "http://localhost");
      const paths = await resolveOccGridPathsByPcdId(url.searchParams.get("pcdId"));
      if (!paths) {
        res.statusCode = 404;
        res.end(JSON.stringify({ ok: false, error: "当前 PCD 未绑定 2D 栅格地图" }));
        return;
      }

      const meta = await readOccGridMeta(paths.yamlPath, paths.pgmPath);
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
      const url = new URL(req.url ?? "", "http://localhost");
      const paths = await resolveOccGridPathsByPcdId(url.searchParams.get("pcdId"));
      if (!paths) {
        res.statusCode = 404;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ ok: false, error: "当前 PCD 未绑定 2D 栅格地图" }));
        return;
      }

      const content = await readFile(paths.pgmPath);
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
  const navigationTaskCancelHandler = createNavigationTaskCancelHandler();
  const robotChargeHandler = createRobotChargeHandler();
  const robotChargeRuntimeHandler = createRobotChargeRuntimeHandler();
  const robotSoftEstopHandler = createRobotSoftEstopHandler();
  const robotAxisControlHandler = createRobotAxisControlHandler();
  const agentPtzGotoHandler = createAgentPtzGotoHandler();
  const agentPtzPositionHandler = createAgentPtzPositionHandler();
  const agentLightControlHandler = createAgentLightControlHandler();
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
      robotChargeRuntimeBridge.start();
      server.middlewares.use("/api/robot/pose", poseHandler);
      server.middlewares.use("/api/robots/poses", posesHandler);
      server.middlewares.use("/api/robot/initial-pose", initialPoseHandler);
      server.middlewares.use("/api/robot/navigation-task", navigationTaskHandler);
      server.middlewares.use("/api/robot/navigation-task-status", navigationTaskStatusHandler);
      server.middlewares.use("/api/robot/navigation-task-cancel", navigationTaskCancelHandler);
      server.middlewares.use("/api/robot/charge", robotChargeHandler);
      server.middlewares.use("/api/robot/charge-runtime", robotChargeRuntimeHandler);
      server.middlewares.use("/api/robot/soft-estop", robotSoftEstopHandler);
      server.middlewares.use("/api/robot/axis-control", robotAxisControlHandler);
      server.middlewares.use("/api/agent/ptz/goto", agentPtzGotoHandler);
      server.middlewares.use("/api/agent/ptz/position", agentPtzPositionHandler);
      server.middlewares.use("/api/agent/light/control", agentLightControlHandler);
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
      robotChargeRuntimeBridge.start();
      server.middlewares.use("/api/robot/pose", poseHandler);
      server.middlewares.use("/api/robots/poses", posesHandler);
      server.middlewares.use("/api/robot/initial-pose", initialPoseHandler);
      server.middlewares.use("/api/robot/navigation-task", navigationTaskHandler);
      server.middlewares.use("/api/robot/navigation-task-status", navigationTaskStatusHandler);
      server.middlewares.use("/api/robot/navigation-task-cancel", navigationTaskCancelHandler);
      server.middlewares.use("/api/robot/charge", robotChargeHandler);
      server.middlewares.use("/api/robot/charge-runtime", robotChargeRuntimeHandler);
      server.middlewares.use("/api/robot/soft-estop", robotSoftEstopHandler);
      server.middlewares.use("/api/robot/axis-control", robotAxisControlHandler);
      server.middlewares.use("/api/agent/ptz/goto", agentPtzGotoHandler);
      server.middlewares.use("/api/agent/ptz/position", agentPtzPositionHandler);
      server.middlewares.use("/api/agent/light/control", agentLightControlHandler);
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
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  ROBOT_HOST = env.M20_ROBOT_HOST || ROBOT_HOST;
  ROBOT_PORT = Number(env.M20_ROBOT_PORT || ROBOT_PORT);
  ROBOT_UDP_PORT = Number(env.M20_ROBOT_UDP_PORT || ROBOT_UDP_PORT);
  MAPPING_HOST = env.M20_MAPPING_HOST || MAPPING_HOST;
  MAPPING_PORT = Number(env.M20_MAPPING_PORT || MAPPING_PORT);
  AGENT_BASE_URL = (env.M20_AGENT_BASE_URL || AGENT_BASE_URL).replace(/\/+$/, "");

  return {
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
  };
})
