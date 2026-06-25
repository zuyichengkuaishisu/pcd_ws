import net from "node:net";
import dgram from "node:dgram";

export type RobotPoseResponse = {
  location: number;
  pose: {
    x: number;
    y: number;
    z: number;
    roll: number;
    pitch: number;
    yaw: number;
  };
  timestamp: string;
  host: string;
  port: number;
};

export type InitialPoseEstimatePayload = {
  x: number;
  y: number;
  z: number;
  yaw: number;
};

export type InitialPoseEstimateResponse = {
  errorCode: number;
  timestamp: string;
  host: string;
  port: number;
};

export type NavigationTaskPayload = {
  Value: number;
  MapID: number;
  PosX: number;
  PosY: number;
  PosZ: number;
  AngleYaw: number;
  PointInfo: 0 | 1 | 3;
  Gait: number;
  Speed: number;
  Manner: number;
  ObsMode: number;
  NavMode: number;
};

export type NavigationTaskResponse = {
  value: number;
  status: number;
  errorCode: number;
  timestamp: string;
  host: string;
  port: number;
};

export type ProtocolAckResponse = {
  errorCode: number;
  timestamp: string;
  host: string;
  port: number;
};

export type FireAndForgetCommandResponse = {
  timestamp: string;
  host: string;
  port: number;
};

export type RobotAxisControlPayload = {
  x: number;
  y: number;
  z: number;
  roll: number;
  pitch: number;
  yaw: number;
};

export type RobotChargeAction = 0 | 1 | 2;
export type RobotMotionAction = 0 | 1 | 2 | 3 | 4 | 17;

export type RobotChargeResponse = {
  errorCode: number;
  timestamp: string;
  host: string;
  port: number;
  charge: RobotChargeAction;
};

export type MappingStartPayload = {
  mapName?: string;
  headless?: boolean;
  outdoor?: boolean;
  activateAfterStop?: boolean;
  indoorPreset?: boolean;
};

export type MappingListItem = {
  name: string;
  path: string;
  isActive: boolean;
  mtime: string;
  artifactsOk: boolean;
};

export type MappingArtifacts = {
  fullCloudPcdBytes: number;
  occGridReady: boolean;
  blockChunkCount: number;
  localizationActive: boolean;
};

export type MappingStatusResponse = {
  errorCode: number;
  errorMessage: string;
  taskState: string;
  taskId: string;
  mappingService: string;
  localizationService: string;
  rsdriverService: string;
  activeMapDir: string;
  activeMapName: string;
  artifactsOk: boolean;
  slamProcess: string;
  maps: MappingListItem[];
  artifacts: MappingArtifacts | null;
  timestamp: string;
  host: string;
  port: number;
};

type PatrolDeviceEnvelope = {
  PatrolDevice?: {
    Type?: number;
    Command?: number;
    Time?: string;
    Items?: Record<string, unknown>;
  };
};

type SlamGatewayEnvelope = {
  SlamGateway?: {
    Type?: number;
    Command?: number;
    Time?: string;
    Items?: Record<string, unknown>;
  };
};

const SYNC_HEADER = Buffer.from([0xeb, 0x91, 0xeb, 0x90]);

function formatProtocolTime() {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

function buildJsonPacket(messageId: number, body: PatrolDeviceEnvelope | SlamGatewayEnvelope) {
  const payload = Buffer.from(JSON.stringify(body), "utf-8");
  const header = Buffer.concat([
    SYNC_HEADER,
    Buffer.from(Uint16Array.of(payload.length).buffer),
    Buffer.from(Uint16Array.of(messageId).buffer),
    Buffer.from([0x01]),
    Buffer.alloc(7, 0),
  ]);
  return Buffer.concat([header, payload]);
}

function nextMessageId() {
  return Math.floor(Math.random() * 0xffff);
}

function readFrame(socket: net.Socket) {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalLength = 0;
    let expectedLength: number | null = null;

    const cleanup = () => {
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("close", onClose);
      socket.off("timeout", onTimeout);
    };

    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    const onClose = () => {
      cleanup();
      reject(new Error("机器人连接提前关闭"));
    };

    const onTimeout = () => {
      cleanup();
      reject(new Error("机器人响应超时"));
    };

    const onData = (chunk: Buffer) => {
      chunks.push(chunk);
      totalLength += chunk.length;

      if (expectedLength === null && totalLength >= 16) {
        const merged = Buffer.concat(chunks, totalLength);
        if (!merged.subarray(0, 4).equals(SYNC_HEADER)) {
          cleanup();
          reject(new Error(`响应同步头异常: ${merged.subarray(0, 4).toString("hex")}`));
          return;
        }
        expectedLength = 16 + merged.readUInt16LE(4);
      }

      if (expectedLength !== null && totalLength >= expectedLength) {
        cleanup();
        const merged = Buffer.concat(chunks, totalLength);
        resolve(merged.subarray(0, expectedLength));
      }
    };

    socket.on("data", onData);
    socket.on("error", onError);
    socket.on("close", onClose);
    socket.on("timeout", onTimeout);
  });
}

function parsePoseResponse(payload: Buffer, host: string, port: number): RobotPoseResponse {
  const parsed = JSON.parse(payload.toString("utf-8")) as PatrolDeviceEnvelope;
  const items = parsed.PatrolDevice?.Items;
  if (!items) {
    throw new Error("定位响应缺少 Items 字段");
  }

  const pose = {
    x: Number(items.PosX),
    y: Number(items.PosY),
    z: Number(items.PosZ),
    roll: Number(items.Roll),
    pitch: Number(items.Pitch),
    yaw: Number(items.Yaw),
  };

  return {
    location: Number(items.Location),
    pose,
    timestamp: parsed.PatrolDevice?.Time ?? "",
    host,
    port,
  };
}

function parseInitialPoseEstimateResponse(payload: Buffer, host: string, port: number): InitialPoseEstimateResponse {
  const parsed = JSON.parse(payload.toString("utf-8")) as PatrolDeviceEnvelope;
  const items = parsed.PatrolDevice?.Items;
  if (!items) {
    throw new Error("初始位姿响应缺少 Items 字段");
  }

  return {
    errorCode: Number(items.ErrorCode),
    timestamp: parsed.PatrolDevice?.Time ?? "",
    host,
    port,
  };
}

function parseNavigationTaskResponse(payload: Buffer, host: string, port: number): NavigationTaskResponse {
  const parsed = JSON.parse(payload.toString("utf-8")) as PatrolDeviceEnvelope;
  const items = parsed.PatrolDevice?.Items;
  if (!items) {
    throw new Error("导航任务响应缺少 Items 字段");
  }

  return {
    value: Number(items.Value),
    status: Number(items.Status),
    errorCode: Number(items.ErrorCode),
    timestamp: parsed.PatrolDevice?.Time ?? "",
    host,
    port,
  };
}

function parseProtocolAckResponse(payload: Buffer, host: string, port: number, fallbackMessage: string): ProtocolAckResponse {
  const parsed = JSON.parse(payload.toString("utf-8")) as PatrolDeviceEnvelope;
  const items = parsed.PatrolDevice?.Items;
  if (!items) {
    throw new Error(`${fallbackMessage}响应缺少 Items 字段`);
  }

  return {
    errorCode: Number(items.ErrorCode),
    timestamp: parsed.PatrolDevice?.Time ?? "",
    host,
    port,
  };
}

function parseRobotChargeResponse(
  payload: Buffer,
  host: string,
  port: number,
  charge: RobotChargeAction,
): RobotChargeResponse {
  const parsed = JSON.parse(payload.toString("utf-8")) as PatrolDeviceEnvelope;
  const items = parsed.PatrolDevice?.Items;
  if (!items) {
    throw new Error("自主充电响应缺少 Items 字段");
  }

  return {
    errorCode: Number(items.ErrorCode),
    timestamp: parsed.PatrolDevice?.Time ?? "",
    host,
    port,
    charge,
  };
}

function parseMappingList(items: Record<string, unknown>) {
  const maps = Array.isArray(items.Maps) ? items.Maps : [];
  return maps.map((entry) => {
    const record = typeof entry === "object" && entry !== null ? (entry as Record<string, unknown>) : {};
    return {
      name: String(record.Name ?? ""),
      path: String(record.Path ?? ""),
      isActive: Boolean(record.IsActive),
      mtime: String(record.Mtime ?? ""),
      artifactsOk: Boolean(record.ArtifactsOk),
    } satisfies MappingListItem;
  });
}

function parseMappingArtifacts(items: Record<string, unknown>) {
  const artifacts = items.Artifacts;
  if (!artifacts || typeof artifacts !== "object") {
    return null;
  }

  const record = artifacts as Record<string, unknown>;
  return {
    fullCloudPcdBytes: Number(record.FullCloudPcdBytes ?? 0),
    occGridReady: Boolean(record.OccGridReady),
    blockChunkCount: Number(record.BlockChunkCount ?? 0),
    localizationActive: Boolean(record.LocalizationActive),
  } satisfies MappingArtifacts;
}

function parseMappingResponse(payload: Buffer, host: string, port: number): MappingStatusResponse {
  const parsed = JSON.parse(payload.toString("utf-8")) as SlamGatewayEnvelope;
  const items = parsed.SlamGateway?.Items;
  if (!items) {
    throw new Error("建图响应缺少 Items 字段");
  }

  return {
    errorCode: Number(items.ErrorCode ?? 0),
    errorMessage: String(items.ErrorMessage ?? ""),
    taskState: String(items.TaskState ?? ""),
    taskId: String(items.TaskId ?? ""),
    mappingService: String(items.MappingService ?? ""),
    localizationService: String(items.LocalizationService ?? ""),
    rsdriverService: String(items.RsdriverService ?? ""),
    activeMapDir: String(items.ActiveMapDir ?? ""),
    activeMapName: String(items.ActiveMapName ?? items.MapName ?? ""),
    artifactsOk: Boolean(items.ArtifactsOk),
    slamProcess: String(items.SlamProcess ?? ""),
    maps: parseMappingList(items),
    artifacts: parseMappingArtifacts(items),
    timestamp: parsed.SlamGateway?.Time ?? "",
    host,
    port,
  };
}

async function sendPatrolJsonRequest(
  host: string,
  port: number,
  body: PatrolDeviceEnvelope,
  timeoutMs = 7000,
) {
  const socket = new net.Socket();
  socket.setTimeout(timeoutMs);

  await new Promise<void>((resolve, reject) => {
    socket.connect(port, host, () => resolve());
    socket.once("error", reject);
  });

  try {
    const packet = buildJsonPacket(nextMessageId(), body);
    socket.write(packet);
    const frame = await readFrame(socket);
    const header = frame.subarray(0, 16);
    if (!header.subarray(0, 4).equals(SYNC_HEADER)) {
      throw new Error(`响应同步头异常: ${header.subarray(0, 4).toString("hex")}`);
    }

    const asduLength = header.readUInt16LE(4);
    const asduFormat = header.readUInt8(8);
    if (asduFormat !== 0x01) {
      throw new Error(`当前仅支持 JSON 响应，收到格式: ${asduFormat}`);
    }

    const payload = frame.subarray(16, 16 + asduLength);
    return payload;
  } finally {
    socket.destroy();
  }
}

async function sendPatrolJsonCommand(host: string, port: number, body: PatrolDeviceEnvelope, timeoutMs = 3000) {
  const socket = new net.Socket();
  socket.setTimeout(timeoutMs);

  try {
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };
      const onTimeout = () => {
        cleanup();
        reject(new Error("机器人发送超时"));
      };
      const cleanup = () => {
        socket.off("error", onError);
        socket.off("timeout", onTimeout);
      };

      socket.on("error", onError);
      socket.on("timeout", onTimeout);
      socket.connect(port, host, () => {
        const packet = buildJsonPacket(nextMessageId(), body);
        socket.end(packet, () => {
          cleanup();
          resolve();
        });
      });
    });
  } finally {
    socket.destroy();
  }
}

async function sendSlamGatewayJsonRequest(
  host: string,
  port: number,
  body: SlamGatewayEnvelope,
  timeoutMs = 7000,
) {
  const socket = dgram.createSocket("udp4");

  return new Promise<Buffer>((resolve, reject) => {
    const cleanup = () => {
      socket.removeAllListeners();
      socket.close();
    };

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("建图网关响应超时"));
    }, timeoutMs);

    socket.on("error", (error) => {
      clearTimeout(timer);
      cleanup();
      reject(error);
    });

    socket.on("message", (message) => {
      clearTimeout(timer);
      cleanup();

      if (!message.subarray(0, 4).equals(SYNC_HEADER)) {
        reject(new Error(`建图响应同步头异常: ${message.subarray(0, 4).toString("hex")}`));
        return;
      }

      const asduLength = message.readUInt16LE(4);
      const asduFormat = message.readUInt8(8);
      if (asduFormat !== 0x01) {
        reject(new Error(`当前仅支持 JSON 响应，收到格式: ${asduFormat}`));
        return;
      }

      resolve(message.subarray(16, 16 + asduLength));
    });

    const packet = buildJsonPacket(nextMessageId(), body);
    socket.send(packet, port, host, (error) => {
      if (error) {
        clearTimeout(timer);
        cleanup();
        reject(error);
      }
    });
  });
}

export async function requestRobotPose(host: string, port: number, timeoutMs = 7000) {
  const payload = await sendPatrolJsonRequest(
    host,
    port,
    {
      PatrolDevice: {
        Type: 1007,
        Command: 2,
        Time: formatProtocolTime(),
        Items: {},
      },
    },
    timeoutMs,
  );
  return parsePoseResponse(payload, host, port);
}

export async function requestNavigationTaskStatus(host: string, port: number, timeoutMs = 7000) {
  const payload = await sendPatrolJsonRequest(
    host,
    port,
    {
      PatrolDevice: {
        Type: 1007,
        Command: 1,
        Time: formatProtocolTime(),
        Items: {},
      },
    },
    timeoutMs,
  );
  return parseNavigationTaskResponse(payload, host, port);
}

export async function submitInitialPoseEstimate(
  host: string,
  port: number,
  pose: InitialPoseEstimatePayload,
  timeoutMs = 7000,
) {
  const payload = await sendPatrolJsonRequest(
    host,
    port,
    {
      PatrolDevice: {
        Type: 2101,
        Command: 1,
        Time: formatProtocolTime(),
        Items: {
          PosX: pose.x,
          PosY: pose.y,
          PosZ: pose.z,
          Yaw: pose.yaw,
        },
      },
    },
    timeoutMs,
  );
  return parseInitialPoseEstimateResponse(payload, host, port);
}

export async function submitNavigationTask(
  host: string,
  port: number,
  task: NavigationTaskPayload,
  timeoutMs = 10 * 60 * 1000,
) {
  const payload = await sendPatrolJsonRequest(
    host,
    port,
    {
      PatrolDevice: {
        Type: 1003,
        Command: 1,
        Time: formatProtocolTime(),
        Items: {
          Value: task.Value,
          MapID: task.MapID,
          PosX: task.PosX,
          PosY: task.PosY,
          PosZ: task.PosZ,
          AngleYaw: task.AngleYaw,
          PointInfo: task.PointInfo,
          Gait: task.Gait,
          Speed: task.Speed,
          Manner: task.Manner,
          ObsMode: task.ObsMode,
          NavMode: task.NavMode,
        },
      },
    },
    timeoutMs,
  );
  return parseNavigationTaskResponse(payload, host, port);
}

export async function cancelNavigationTask(host: string, port: number, timeoutMs = 7000) {
  const payload = await sendPatrolJsonRequest(
    host,
    port,
    {
      PatrolDevice: {
        Type: 1004,
        Command: 1,
        Time: formatProtocolTime(),
        Items: {},
      },
    },
    timeoutMs,
  );
  return parseProtocolAckResponse(payload, host, port, "取消导航任务");
}

export async function submitRobotChargeAction(
  host: string,
  port: number,
  charge: RobotChargeAction,
  timeoutMs = 7000,
) {
  const payload = await sendPatrolJsonRequest(
    host,
    port,
    {
      PatrolDevice: {
        Type: 2,
        Command: 24,
        Time: formatProtocolTime(),
        Items: {
          Charge: charge,
        },
      },
    },
    timeoutMs,
  );
  return parseRobotChargeResponse(payload, host, port, charge);
}

export async function submitRobotMotionAction(
  host: string,
  port: number,
  motion: RobotMotionAction,
  timeoutMs = 7000,
) {
  const payload = await sendPatrolJsonRequest(
    host,
    port,
    {
      PatrolDevice: {
        Type: 2,
        Command: 22,
        Time: formatProtocolTime(),
        Items: {
          MotionParam: motion,
        },
      },
    },
    timeoutMs,
  );
  return parseProtocolAckResponse(payload, host, port, "运动状态转换");
}

export async function submitRobotAxisControl(
  host: string,
  port: number,
  command: RobotAxisControlPayload,
  timeoutMs = 3000,
): Promise<FireAndForgetCommandResponse> {
  const timestamp = formatProtocolTime();
  await sendPatrolJsonCommand(
    host,
    port,
    {
      PatrolDevice: {
        Type: 2,
        Command: 21,
        Time: timestamp,
        Items: {
          X: command.x,
          Y: command.y,
          Z: command.z,
          Roll: command.roll,
          Pitch: command.pitch,
          Yaw: command.yaw,
        },
      },
    },
    timeoutMs,
  );
  return {
    timestamp,
    host,
    port,
  };
}

export async function startMapping(
  host: string,
  port: number,
  payload: MappingStartPayload,
  timeoutMs = 7000,
) {
  const response = await sendSlamGatewayJsonRequest(
    host,
    port,
    {
      SlamGateway: {
        Type: 2200,
        Command: 1,
        Time: formatProtocolTime(),
        Items: {
          ...(payload.mapName ? { MapName: payload.mapName } : {}),
          ...(payload.headless !== undefined ? { Headless: payload.headless } : {}),
          ...(payload.outdoor !== undefined ? { Outdoor: payload.outdoor } : {}),
          ...(payload.activateAfterStop !== undefined ? { ActivateAfterStop: payload.activateAfterStop } : {}),
          ...(payload.indoorPreset !== undefined ? { IndoorPreset: payload.indoorPreset } : {}),
        },
      },
    },
    timeoutMs,
  );
  return parseMappingResponse(response, host, port);
}

export async function stopMapping(host: string, port: number, timeoutMs = 180000) {
  const response = await sendSlamGatewayJsonRequest(
    host,
    port,
    {
      SlamGateway: {
        Type: 2200,
        Command: 2,
        Time: formatProtocolTime(),
        Items: {},
      },
    },
    timeoutMs,
  );
  return parseMappingResponse(response, host, port);
}

export async function requestMappingStatus(host: string, port: number, includeMapList = false, timeoutMs = 7000) {
  const response = await sendSlamGatewayJsonRequest(
    host,
    port,
    {
      SlamGateway: {
        Type: 2200,
        Command: 3,
        Time: formatProtocolTime(),
        Items: includeMapList ? { IncludeMapList: true } : {},
      },
    },
    timeoutMs,
  );
  return parseMappingResponse(response, host, port);
}

export async function applyNavigationMap(
  host: string,
  port: number,
  payload: { mapDir?: string; mapName?: string },
  timeoutMs = 120000,
) {
  const response = await sendSlamGatewayJsonRequest(
    host,
    port,
    {
      SlamGateway: {
        Type: 2200,
        Command: 4,
        Time: formatProtocolTime(),
        Items: {
          ...(payload.mapDir ? { MapDir: payload.mapDir } : {}),
          ...(payload.mapName ? { MapName: payload.mapName } : {}),
        },
      },
    },
    timeoutMs,
  );
  return parseMappingResponse(response, host, port);
}

export async function listLocalMaps(
  host: string,
  port: number,
  payload: { limit?: number; sortBy?: string } = {},
  timeoutMs = 7000,
) {
  const response = await sendSlamGatewayJsonRequest(
    host,
    port,
    {
      SlamGateway: {
        Type: 2200,
        Command: 6,
        Time: formatProtocolTime(),
        Items: {
          ...(payload.limit !== undefined ? { Limit: payload.limit } : {}),
          ...(payload.sortBy ? { SortBy: payload.sortBy } : {}),
        },
      },
    },
    timeoutMs,
  );
  return parseMappingResponse(response, host, port);
}
