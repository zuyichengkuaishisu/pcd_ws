export type PerformanceMode = "auto" | "quality" | "balanced" | "power-saver";

export type PerformanceProfile = {
  mode: "quality" | "balanced" | "power-saver";
  label: string;
  description: string;
  dprCap: number;
  antialias: boolean;
  idleFps: number;
  maxRenderFps: number;
  pointBudget: number | null;
  posePollingMs: number;
  navigationPollingMs: number;
  mappingPollingMs: number;
};

type RuntimeEnv = {
  userAgent?: string;
  hardwareConcurrency?: number;
  deviceMemory?: number;
  devicePixelRatio?: number;
  maxTouchPoints?: number;
  screenWidth?: number;
  screenHeight?: number;
};

const PERFORMANCE_PROFILES: Record<PerformanceProfile["mode"], PerformanceProfile> = {
  quality: {
    mode: "quality",
    label: "高画质",
    description: "保留更高分辨率与抗锯齿，适合桌面调试。",
    dprCap: 2,
    antialias: true,
    idleFps: 30,
    maxRenderFps: 60,
    pointBudget: null,
    posePollingMs: 2000,
    navigationPollingMs: 1500,
    mappingPollingMs: 3000,
  },
  balanced: {
    mode: "balanced",
    label: "均衡",
    description: "兼顾画面与负载，适合常规工控端。",
    dprCap: 1.5,
    antialias: true,
    idleFps: 20,
    maxRenderFps: 45,
    pointBudget: 900_000,
    posePollingMs: 2500,
    navigationPollingMs: 2000,
    mappingPollingMs: 4000,
  },
  "power-saver": {
    mode: "power-saver",
    label: "省电",
    description: "限制 DPR、抽样大点云、放慢轮询，适合 RK3588 机载部署。",
    dprCap: 1,
    antialias: false,
    idleFps: 12,
    maxRenderFps: 30,
    pointBudget: 350_000,
    posePollingMs: 3500,
    navigationPollingMs: 3000,
    mappingPollingMs: 6000,
  },
};

export function resolvePerformanceProfile(mode: PerformanceMode, env: RuntimeEnv = readRuntimeEnv()): PerformanceProfile {
  if (mode !== "auto") {
    return PERFORMANCE_PROFILES[mode];
  }

  return PERFORMANCE_PROFILES[detectAutoPerformanceMode(env)];
}

export function detectAutoPerformanceMode(env: RuntimeEnv): PerformanceProfile["mode"] {
  const userAgent = (env.userAgent ?? "").toLowerCase();
  const cpuCount = env.hardwareConcurrency ?? 8;
  const memory = env.deviceMemory ?? 8;
  const pixelRatio = env.devicePixelRatio ?? 1;
  const isArmLike = /arm|aarch64|rk3588|android/.test(userAgent);
  const isSmallScreen =
    Math.min(env.screenWidth ?? Number.POSITIVE_INFINITY, env.screenHeight ?? Number.POSITIVE_INFINITY) <= 1080;
  const isTouchDevice = (env.maxTouchPoints ?? 0) > 0;

  if (isArmLike || memory <= 4 || cpuCount <= 4 || (isTouchDevice && isSmallScreen && pixelRatio >= 1.5)) {
    return "power-saver";
  }

  if (memory <= 8 || cpuCount <= 8 || pixelRatio > 1.5) {
    return "balanced";
  }

  return "quality";
}

export function downsamplePointCloudData(
  source: { position: Float32Array; color: Float32Array | null },
  maxPoints: number | null,
) {
  const totalPoints = source.position.length / 3;
  if (!maxPoints || totalPoints <= maxPoints) {
    return {
      position: source.position,
      color: source.color,
      totalPoints,
      renderedPoints: totalPoints,
      sampled: false,
    };
  }

  const stride = Math.ceil(totalPoints / maxPoints);
  const renderedPoints = Math.ceil(totalPoints / stride);
  const position = new Float32Array(renderedPoints * 3);
  const color = source.color ? new Float32Array(renderedPoints * 3) : null;

  let writeIndex = 0;
  for (let pointIndex = 0; pointIndex < totalPoints; pointIndex += stride) {
    const sourceIndex = pointIndex * 3;
    position[writeIndex] = source.position[sourceIndex];
    position[writeIndex + 1] = source.position[sourceIndex + 1];
    position[writeIndex + 2] = source.position[sourceIndex + 2];

    if (color && source.color) {
      color[writeIndex] = source.color[sourceIndex];
      color[writeIndex + 1] = source.color[sourceIndex + 1];
      color[writeIndex + 2] = source.color[sourceIndex + 2];
    }

    writeIndex += 3;
  }

  return {
    position,
    color,
    totalPoints,
    renderedPoints,
    sampled: true,
  };
}

function readRuntimeEnv(): RuntimeEnv {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return {};
  }

  return {
    userAgent: navigator.userAgent,
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemory: "deviceMemory" in navigator ? (navigator.deviceMemory as number | undefined) : undefined,
    devicePixelRatio: window.devicePixelRatio,
    maxTouchPoints: navigator.maxTouchPoints,
    screenWidth: window.screen?.width,
    screenHeight: window.screen?.height,
  };
}
