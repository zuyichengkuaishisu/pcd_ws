import { type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Aperture,
  Box,
  Crosshair,
  Download,
  Grid2x2,
  Hand,
  ListOrdered,
  LocateFixed,
  MoonStar,
  RotateCcw,
  Save,
  ScanSearch,
  Send,
  SunMedium,
  Trash2,
  Upload,
} from "lucide-react";

import ControlButton from "@/components/ControlButton";
import MetricCard from "@/components/MetricCard";
import ToggleChip from "@/components/ToggleChip";
import { usePcdScene } from "@/hooks/usePcdScene";
import { useRobotPosePolling } from "@/hooks/useRobotPosePolling";
import { useViewerStore } from "@/store/useViewerStore";
import {
  NAVIGATION_GAIT_OPTIONS,
  NAVIGATION_MANNER_OPTIONS,
  NAVIGATION_MODE_OPTIONS,
  NAVIGATION_OBS_MODE_OPTIONS,
  NAVIGATION_SPEED_OPTIONS,
  TASK_POINT_TYPE_META,
  type NavigationTaskPayload,
  type TaskPoint,
  type TaskPointType,
} from "@/types/navigation";
import { resolvePerformanceProfile } from "@/utils/performance";
import { formatMeters, formatPointCount, formatVector3, formatYawRadians } from "@/utils/viewerFormat";

const TASK_POINT_TYPE_ORDER: TaskPointType[] = [0, 1, 3];
const NAVIGATION_SUCCESS_ERROR_CODES = new Set([0, 0x2300]);
const DEFAULT_NAVIGATION_TASK = {
  MapID: 0,
  Gait: 0x3002,
  Speed: 0,
  Manner: 0,
  ObsMode: 0,
  NavMode: 1,
} as const;
const TELEOP_LINEAR_RATIO = 0.35;
const TELEOP_YAW_RATIO = 0.45;
const TELEOP_SUPPORTED_KEYS = new Set(["w", "x", "a", "d", "q", "e"]);

type NavigationRuntimeState = {
  connection: "idle" | "loading" | "ready" | "error";
  value: number | null;
  status: number | null;
  errorCode: number | null;
  timestamp: string;
  message: string;
};

type MappingMapSummary = {
  name: string;
  path: string;
  isActive: boolean;
  mtime: string;
  artifactsOk: boolean;
};

type MappingRuntimeState = {
  connection: "idle" | "loading" | "ready" | "error";
  taskState: string;
  errorCode: number | null;
  errorMessage: string;
  activeMapName: string;
  activeMapDir: string;
  mappingService: string;
  localizationService: string;
  rsdriverService: string;
  artifactsOk: boolean;
  maps: MappingMapSummary[];
  timestamp: string;
};

type SavedFloorSegment = {
  id: string;
  name: string;
  minZ: number;
  maxZ: number;
};

type PcdMapItem = {
  id: string;
  name: string;
  label: string;
  source: "sample" | "map";
  mapName: string;
  hasLinkedOccGrid: boolean;
  url: string;
};

const DEFAULT_PCD_URL = `/api/map/pcd/${encodeURIComponent("sample:outside_15cm_simpled.pcd")}`;

type SavedRoute = {
  id: string;
  name: string;
  points: TaskPoint[];
  createdAt: string;
  updatedAt: string;
};

const ROUTES_STORAGE_KEY = "inspection_routes";

function loadRoutesFromStorage(): SavedRoute[] {
  try {
    const raw = localStorage.getItem(ROUTES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

function saveRoutesToStorage(routes: SavedRoute[]) {
  try {
    localStorage.setItem(ROUTES_STORAGE_KEY, JSON.stringify(routes));
  } catch {
    // storage full or unavailable — silently ignore
  }
}

type TeleopAxisPayload = {
  x: number;
  y: number;
  z: number;
  roll: number;
  pitch: number;
  yaw: number;
};

const ZERO_TELEOP_AXIS_PAYLOAD: TeleopAxisPayload = {
  x: 0,
  y: 0,
  z: 0,
  roll: 0,
  pitch: 0,
  yaw: 0,
};

function normalizeTeleopKey(key: string) {
  const normalized = key.toLowerCase();
  return TELEOP_SUPPORTED_KEYS.has(normalized) ? normalized : null;
}

function serializeTeleopAxisPayload(payload: TeleopAxisPayload) {
  return `${payload.x}|${payload.y}|${payload.z}|${payload.roll}|${payload.pitch}|${payload.yaw}`;
}

function isZeroTeleopAxisPayload(payload: TeleopAxisPayload) {
  return serializeTeleopAxisPayload(payload) === serializeTeleopAxisPayload(ZERO_TELEOP_AXIS_PAYLOAD);
}

function buildTeleopAxisPayload(keys: Set<string>): TeleopAxisPayload {
  let x = 0;
  let y = 0;
  let yaw = 0;

  if (keys.has("w")) {
    x += TELEOP_LINEAR_RATIO;
  }
  if (keys.has("x")) {
    x -= TELEOP_LINEAR_RATIO;
  }
  if (keys.has("a")) {
    y += TELEOP_LINEAR_RATIO;
  }
  if (keys.has("d")) {
    y -= TELEOP_LINEAR_RATIO;
  }
  if (keys.has("q")) {
    yaw += TELEOP_YAW_RATIO;
  }
  if (keys.has("e")) {
    yaw -= TELEOP_YAW_RATIO;
  }

  return {
    x,
    y,
    z: 0,
    roll: 0,
    pitch: 0,
    yaw,
  };
}

function formatTeleopAxisMessage(payload: TeleopAxisPayload, timestamp: string | null) {
  if (isZeroTeleopAxisPayload(payload)) {
    return `已发送停止轴指令，时间 ${timestamp || "-"}。`;
  }
  return `轴指令已发送：X=${payload.x.toFixed(2)}，Y=${payload.y.toFixed(2)}，Yaw=${payload.yaw.toFixed(2)}，时间 ${timestamp || "-"}`;
}

export default function Home() {
  const {
    pointSize,
    showGrid,
    showAxes,
    darkBackground,
    pointCount,
    fileName,
    status,
    errorMessage,
    bounds,
    mapOrigin,
    mapMin,
    mapMax,
    robotPose,
    robotConnectionStatus,
    robotLocationState,
    robotErrorMessage,
    robotPoseTime,
    robots,
    primaryRobotId,
    setPointSize,
    toggleGrid,
    toggleAxes,
    toggleBackground,
    setStatus,
    setSceneInfo,
    setPrimaryRobot,
  } = useViewerStore();
  const [taskEditorEnabled, setTaskEditorEnabled] = useState(false);
  const [pendingTaskPointType, setPendingTaskPointType] = useState<TaskPointType>(1);
  const [taskPoints, setTaskPoints] = useState<TaskPoint[]>([]);
  const [taskDispatchStatus, setTaskDispatchStatus] = useState<"idle" | "prepared" | "dispatching" | "error">("idle");
  const [taskDispatchMessage, setTaskDispatchMessage] = useState("点击“编辑任务点”后，长按并拖动鼠标即可添加点位并标定方向。");
  const [floorSegmentationEnabled, setFloorSegmentationEnabled] = useState(false);
  const [floorSegmentationDraftRange, setFloorSegmentationDraftRange] = useState<{ minZ: number; maxZ: number } | null>(null);
  const [floorSegmentationAppliedRange, setFloorSegmentationAppliedRange] = useState<{ minZ: number; maxZ: number } | null>(null);
  const [floorSegmentationMessage, setFloorSegmentationMessage] = useState("切到前视图后，手动调整上下两条 Z 高度分割线，确认只显示目标楼层。");
  const [floorSegmentationCurrentPointCount, setFloorSegmentationCurrentPointCount] = useState(0);
  const [floorPresetName, setFloorPresetName] = useState("");
  const [savedFloorSegments, setSavedFloorSegments] = useState<SavedFloorSegment[]>([]);
  const [pcdItems, setPcdItems] = useState<PcdMapItem[]>([]);
  const [selectedPcdId, setSelectedPcdId] = useState("sample:outside_15cm_simpled.pcd");
  const [selectedPcdUrl, setSelectedPcdUrl] = useState(DEFAULT_PCD_URL);
  const [pcdListMessage, setPcdListMessage] = useState("正在读取可切换的 PCD 地图列表。");
  const [pcdListLoading, setPcdListLoading] = useState(false);
  const [pointShape, setPointShape] = useState<"round" | "square">("round");
  const [initialPoseEditorEnabled, setInitialPoseEditorEnabled] = useState(false);
  const [initialPose, setInitialPose] = useState<{ x: string; y: string; z: string; yaw: string } | null>(null);
  const [initialPoseStatus, setInitialPoseStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [initialPoseMessage, setInitialPoseMessage] = useState("点击“开始标注”后，在画布上按下并拖动即可设置 2D Pose Estimate；PosZ 默认按 0 下发。");
  const [chargeActionStatus, setChargeActionStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [chargeActionMessage, setChargeActionMessage] = useState("手动触发开始充电或结束充电。");
  const [robotChargeState, setRobotChargeState] = useState<"unknown" | "idle" | "charging">("unknown");
  const [navControlStatus, setNavControlStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [navControlMessage, setNavControlMessage] = useState("可在顶端快速取消导航任务，或立即下发软急停。");
  const [teleopEnabled, setTeleopEnabled] = useState(false);
  const [teleopStatus, setTeleopStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [teleopMessage, setTeleopMessage] = useState("键盘控狗已关闭。开启后使用 W/X/A/D/Q/E 控制机器人移动与偏航。");
  const [savedRoutes, setSavedRoutes] = useState<SavedRoute[]>(() => loadRoutesFromStorage());
  const [selectedRouteId, setSelectedRouteId] = useState("");
  const [routeNameInput, setRouteNameInput] = useState("");
  const [routeMessage, setRouteMessage] = useState("可将当前任务点保存为路线，也可从本地 JSONL 恢复并切换路线。");
  const [showOccGrid, setShowOccGrid] = useState(false);
  const [mappingForm, setMappingForm] = useState({
    mapName: "",
    headless: true,
    outdoor: false,
    activateAfterStop: true,
  });
  const [mappingActionStatus, setMappingActionStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [mappingActionMessage, setMappingActionMessage] = useState("手动控制开始建图、停止建图和切换导航地图。");
  const [mappingApplyingName, setMappingApplyingName] = useState("");
  const [mappingRuntime, setMappingRuntime] = useState<MappingRuntimeState>({
    connection: "idle",
    taskState: "",
    errorCode: null,
    errorMessage: "",
    activeMapName: "",
    activeMapDir: "",
    mappingService: "",
    localizationService: "",
    rsdriverService: "",
    artifactsOk: false,
    maps: [],
    timestamp: "",
  });
  const [navigationRuntime, setNavigationRuntime] = useState<NavigationRuntimeState>({
    connection: "idle",
    value: null,
    status: null,
    errorCode: null,
    timestamp: "",
    message: "等待查询导航状态",
  });
  const teleopPressedKeysRef = useRef(new Set<string>());
  const teleopSendingRef = useRef(false);
  const teleopLastSignatureRef = useRef(serializeTeleopAxisPayload(ZERO_TELEOP_AXIS_PAYLOAD));
  const routeImportInputRef = useRef<HTMLInputElement | null>(null);
  const performanceProfile = useMemo(() => resolvePerformanceProfile("auto"), []);
  const selectedPcdItem = useMemo(
    () => pcdItems.find((item) => item.id === selectedPcdId) ?? null,
    [pcdItems, selectedPcdId],
  );
  const initialPoseSelection = useMemo(() => {
    if (!initialPose) {
      return null;
    }

    const x = Number(initialPose.x);
    const y = Number(initialPose.y);
    const z = Number(initialPose.z);
    const yaw = Number(initialPose.yaw);
    if (Number.isNaN(x) || Number.isNaN(y) || Number.isNaN(z) || Number.isNaN(yaw)) {
      return null;
    }

    return { x, y, z, yaw };
  }, [initialPose]);
  const selectedRoute = useMemo(() => savedRoutes.find((route) => route.id === selectedRouteId) ?? null, [savedRoutes, selectedRouteId]);

  const { containerRef, resetView, setTopView, setFrontView } = usePcdScene({
    fileUrl: selectedPcdUrl,
    occGridAssetId: selectedPcdItem?.hasLinkedOccGrid ? selectedPcdItem.id : null,
    performanceProfile,
    keyboardCameraEnabled: !teleopEnabled,
    pointSize,
    pointShape,
    showGrid,
    showAxes,
    darkBackground,
    showOccGrid,
    robotPose,
    floorSegmentationEnabled,
    floorSegmentationPreviewRange: floorSegmentationEnabled ? floorSegmentationDraftRange : null,
    floorSegmentationAppliedRange,
    taskPoints,
    taskEditorEnabled,
    initialPoseEditorEnabled,
    initialPoseSelection,
    mapPlaneZ: mapOrigin.z,
    onAddTaskPoint: (point) => {
      setTaskPoints((current) =>
        reindexTaskPoints(
          [
            ...current,
            {
              id: crypto.randomUUID(),
              index: 0,
              label: "",
              type: pendingTaskPointType,
              x: point.x,
              y: point.y,
              z: point.z,
              yaw: point.yaw,
              gait: DEFAULT_NAVIGATION_TASK.Gait,
              speed: DEFAULT_NAVIGATION_TASK.Speed,
              manner: DEFAULT_NAVIGATION_TASK.Manner,
              obsMode: DEFAULT_NAVIGATION_TASK.ObsMode,
              navMode: DEFAULT_NAVIGATION_TASK.NavMode,
              status: "draft",
            },
          ],
          robotPose?.yaw ?? 0,
          true,
        ),
      );
      setTaskDispatchStatus("idle");
      setTaskDispatchMessage(`已添加${TASK_POINT_TYPE_META[pendingTaskPointType].label}，方向按拖动朝向写入。`);
    },
    onSetInitialPose: (point) => {
      setInitialPose({
        x: point.x.toFixed(3),
        y: point.y.toFixed(3),
        z: "0.000",
        yaw: point.yaw.toFixed(6),
      });
      setInitialPoseEditorEnabled(false);
      setInitialPoseStatus("idle");
      setInitialPoseMessage(
        `已选定 2D Pose Estimate：X=${point.x.toFixed(3)}，Y=${point.y.toFixed(3)}，Z=0.000，Yaw=${point.yaw.toFixed(6)} rad。`,
      );
    },
    onFloorSegmentationPointCountChange: setFloorSegmentationCurrentPointCount,
    onStatus: setStatus,
    onSceneReady: setSceneInfo,
  });

  useRobotPosePolling(performanceProfile.posePollingMs);

  const loadPcdList = useCallback(
    async ({
      preferredId,
      isManualRefresh = false,
    }: {
      preferredId?: string;
      isManualRefresh?: boolean;
    } = {}) => {
      setPcdListLoading(true);
      if (isManualRefresh) {
        setPcdListMessage("正在刷新可切换的 PCD 地图列表。");
      }

      try {
        const response = await fetch("/api/map/pcd-files", {
          method: "GET",
          cache: "no-store",
          headers: {
            Accept: "application/json",
          },
        });
        const result = (await response.json()) as {
          ok: boolean;
          error?: string;
          defaultPcdId?: string;
          items?: PcdMapItem[];
        };

        if (!response.ok || !result.ok || !Array.isArray(result.items) || result.items.length === 0) {
          throw new Error(result.error || `PCD 地图列表读取失败: HTTP ${response.status}`);
        }

        const nextSelectedItem =
          (preferredId ? result.items.find((item) => item.id === preferredId) : null) ??
          result.items.find((item) => item.id === result.defaultPcdId) ??
          result.items[0];

        setPcdItems(result.items);
        setSelectedPcdId(nextSelectedItem.id);
        setSelectedPcdUrl(nextSelectedItem.url);
        setShowOccGrid(nextSelectedItem.hasLinkedOccGrid);
        setInitialPoseEditorEnabled(false);
        setInitialPose(null);
        setInitialPoseStatus("idle");
        setInitialPoseMessage("点击“开始标注”后，在画布上按下并拖动即可设置 2D Pose Estimate；PosZ 默认按 0 下发。");

        if (isManualRefresh) {
          const selectionChanged = Boolean(preferredId) && preferredId !== nextSelectedItem.id;
          setPcdListMessage(
            selectionChanged
              ? `已刷新列表，原选择已不存在，已切换到 ${nextSelectedItem.label}。`
              : `已刷新列表，共发现 ${result.items.length} 个可切换 PCD，当前为 ${nextSelectedItem.label}。`,
          );
          return;
        }

        setPcdListMessage(
          nextSelectedItem.hasLinkedOccGrid
            ? `当前选择 ${nextSelectedItem.label}，可与当前 occ_grid 一起联看。`
            : `当前选择 ${nextSelectedItem.label}，该点云未绑定当前 occ_grid。`,
        );
      } catch (error) {
        setPcdListMessage(error instanceof Error ? error.message : "PCD 地图列表读取失败");
      } finally {
        setPcdListLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void loadPcdList();
  }, [loadPcdList]);

  useEffect(() => {
    saveRoutesToStorage(savedRoutes);
  }, [savedRoutes]);

  const statusTone =
    status === "error"
      ? "border-rose-400/40 bg-rose-400/10 text-rose-100"
      : status === "ready"
        ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-100"
        : "border-amber-300/40 bg-amber-300/10 text-amber-100";

  const robotStatusTone =
    robotConnectionStatus === "error"
      ? "border-rose-400/40 bg-rose-400/10 text-rose-100"
      : robotConnectionStatus === "ready"
        ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-100"
        : "border-amber-300/40 bg-amber-300/10 text-amber-100";

  const initialPoseTone = useMemo(() => {
    if (initialPoseStatus === "error") {
      return "border-rose-400/40 bg-rose-400/10 text-rose-100";
    }
    if (initialPoseStatus === "success") {
      return "border-emerald-400/40 bg-emerald-400/10 text-emerald-100";
    }
    return "border-amber-300/40 bg-amber-300/10 text-amber-100";
  }, [initialPoseStatus]);

  const navigationPayloads = useMemo<NavigationTaskPayload[]>(
    () =>
      taskPoints.map((point, index) => ({
        Value: index,
        MapID: DEFAULT_NAVIGATION_TASK.MapID,
        PosX: point.x,
        PosY: point.y,
        PosZ: point.z,
        AngleYaw: point.yaw,
        PointInfo: point.type,
        Gait: point.gait,
        Speed: point.speed,
        Manner: point.manner,
        ObsMode: point.obsMode,
        NavMode: point.navMode,
      })),
    [taskPoints],
  );

  const taskDispatchTone =
    taskDispatchStatus === "dispatching"
      ? "border-cyan-300/40 bg-cyan-300/10 text-cyan-100"
      : taskDispatchStatus === "error"
        ? "border-rose-400/40 bg-rose-400/10 text-rose-100"
      : taskDispatchStatus === "prepared"
        ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-100"
        : "border-amber-300/40 bg-amber-300/10 text-amber-100";

  const chargeActionTone = useMemo(() => {
    if (chargeActionStatus === "error") {
      return "border-rose-400/40 bg-rose-400/10 text-rose-100";
    }
    if (chargeActionStatus === "success") {
      return "border-emerald-400/40 bg-emerald-400/10 text-emerald-100";
    }
    return "border-amber-300/40 bg-amber-300/10 text-amber-100";
  }, [chargeActionStatus]);

  const navControlTone = useMemo(() => {
    if (navControlStatus === "error") {
      return "border-rose-400/40 bg-rose-400/10 text-rose-100";
    }
    if (navControlStatus === "success") {
      return "border-emerald-400/40 bg-emerald-400/10 text-emerald-100";
    }
    if (navControlStatus === "submitting") {
      return "border-cyan-300/40 bg-cyan-300/10 text-cyan-100";
    }
    return "border-white/10 bg-white/[0.03] text-slate-300";
  }, [navControlStatus]);

  const teleopTone = useMemo(() => {
    if (teleopStatus === "error") {
      return "border-rose-400/40 bg-rose-400/10 text-rose-100";
    }
    if (teleopStatus === "success") {
      return "border-emerald-400/40 bg-emerald-400/10 text-emerald-100";
    }
    if (teleopStatus === "submitting") {
      return "border-cyan-300/40 bg-cyan-300/10 text-cyan-100";
    }
    return "border-white/10 bg-white/[0.03] text-slate-300";
  }, [teleopStatus]);

  const floorSegmentationRange = useMemo(() => {
    if (floorSegmentationDraftRange) {
      return {
        minZ: Math.min(floorSegmentationDraftRange.minZ, floorSegmentationDraftRange.maxZ),
        maxZ: Math.max(floorSegmentationDraftRange.minZ, floorSegmentationDraftRange.maxZ),
      };
    }
    return {
      minZ: mapMin.z,
      maxZ: mapMax.z,
    };
  }, [floorSegmentationDraftRange, mapMax.z, mapMin.z]);

  const floorSegmentationStep = useMemo(
    () => Math.max(Number((Math.max(bounds.height, 1) / 240).toFixed(3)), 0.01),
    [bounds.height],
  );

  const mappingActionTone = useMemo(() => {
    if (mappingActionStatus === "error") {
      return "border-rose-400/40 bg-rose-400/10 text-rose-100";
    }
    if (mappingActionStatus === "success") {
      return "border-emerald-400/40 bg-emerald-400/10 text-emerald-100";
    }
    return "border-amber-300/40 bg-amber-300/10 text-amber-100";
  }, [mappingActionStatus]);

  useEffect(() => {
    let disposed = false;
    let timer: number | null = null;

    const loadMappingRuntime = async () => {
      setMappingRuntime((current) => ({
        ...current,
        connection: current.connection === "idle" ? "loading" : current.connection,
      }));

      try {
        const response = await fetch("/api/mapping/status?includeMapList=true", {
          method: "GET",
          headers: {
            Accept: "application/json",
          },
        });

        const result = (await response.json()) as {
          ok: boolean;
          error?: string;
          errorCode?: number;
          errorMessage?: string;
          taskState?: string;
          activeMapName?: string;
          activeMapDir?: string;
          mappingService?: string;
          localizationService?: string;
          rsdriverService?: string;
          artifactsOk?: boolean;
          maps?: MappingMapSummary[];
          timestamp?: string;
        };

        if (!response.ok || !result.ok) {
          throw new Error(result.error || `建图状态查询失败: HTTP ${response.status}`);
        }

        if (disposed) {
          return;
        }

        setMappingRuntime({
          connection: "ready",
          taskState: result.taskState ?? "",
          errorCode: result.errorCode ?? null,
          errorMessage: result.errorMessage ?? "",
          activeMapName: result.activeMapName ?? "",
          activeMapDir: result.activeMapDir ?? "",
          mappingService: result.mappingService ?? "",
          localizationService: result.localizationService ?? "",
          rsdriverService: result.rsdriverService ?? "",
          artifactsOk: Boolean(result.artifactsOk),
          maps: Array.isArray(result.maps) ? result.maps : [],
          timestamp: result.timestamp ?? "",
        });
      } catch (error) {
        if (disposed) {
          return;
        }
        setMappingRuntime((current) => ({
          ...current,
          connection: "error",
          errorMessage: error instanceof Error ? error.message : "建图状态查询失败",
        }));
      } finally {
        if (!disposed) {
          timer = window.setTimeout(loadMappingRuntime, performanceProfile.mappingPollingMs);
        }
      }
    };

    loadMappingRuntime();

    return () => {
      disposed = true;
      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, [performanceProfile.mappingPollingMs]);

  useEffect(() => {
    let disposed = false;
    let timer: number | null = null;

    const loadNavigationRuntime = async () => {
      setNavigationRuntime((current) => ({
        ...current,
        connection: current.connection === "idle" ? "loading" : current.connection,
      }));

      try {
        const response = await fetch("/api/robot/navigation-task-status", {
          method: "GET",
          headers: {
            Accept: "application/json",
          },
        });

        const result = (await response.json()) as {
          ok: boolean;
          value?: number;
          status?: number;
          errorCode?: number;
          timestamp?: string;
          error?: string;
        };

        if (!response.ok || !result.ok) {
          throw new Error(result.error || `导航状态查询失败: HTTP ${response.status}`);
        }

        if (disposed) {
          return;
        }

        setNavigationRuntime({
          connection: "ready",
          value: result.value ?? null,
          status: result.status ?? null,
          errorCode: result.errorCode ?? null,
          timestamp: result.timestamp ?? "",
          message: formatNavigationRuntimeMessage(result.status ?? null, result.errorCode ?? null),
        });
      } catch (error) {
        if (disposed) {
          return;
        }

        setNavigationRuntime((current) => ({
          ...current,
          connection: "error",
          message: error instanceof Error ? error.message : "导航状态查询失败",
        }));
      } finally {
        if (!disposed) {
          timer = window.setTimeout(loadNavigationRuntime, performanceProfile.navigationPollingMs);
        }
      }
    };

    loadNavigationRuntime();

    return () => {
      disposed = true;
      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, [performanceProfile.navigationPollingMs]);

  const fillFromCurrentPose = () => {
    if (!robotPose) {
      return;
    }

    setInitialPose({
      x: robotPose.x.toFixed(3),
      y: robotPose.y.toFixed(3),
      z: "0.000",
      yaw: robotPose.yaw.toFixed(6),
    });
    setInitialPoseStatus("idle");
    setInitialPoseEditorEnabled(false);
    setInitialPoseMessage("已用机器人当前位置填充 2D Pose Estimate，PosZ 默认按 0 下发。");
  };

  const handleSubmitInitialPose = async () => {
    if (!initialPoseSelection) {
      setInitialPoseStatus("error");
      setInitialPoseMessage("请先在画布上拖动选择 2D Pose Estimate，或使用当前位置填充。");
      return;
    }

    setInitialPoseStatus("submitting");
    setInitialPoseMessage("");

    try {
      const response = await fetch("/api/robot/initial-pose", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          x: initialPoseSelection.x,
          y: initialPoseSelection.y,
          z: initialPoseSelection.z,
          yaw: initialPoseSelection.yaw,
        }),
      });

      const result = (await response.json()) as {
        ok: boolean;
        error?: string;
        errorCode?: number;
        timestamp?: string;
      };

      if (!response.ok || !result.ok) {
        throw new Error(result.error || `初始位姿发布失败: HTTP ${response.status}`);
      }

      setInitialPoseStatus(result.errorCode === 0 ? "success" : "error");
      setInitialPoseMessage(formatInitialPoseResultMessage(result.errorCode ?? null, result.timestamp ?? null));
    } catch (error) {
      setInitialPoseStatus("error");
      setInitialPoseMessage(error instanceof Error ? error.message : "初始位姿发布失败");
    }
  };

  const submitRobotChargeAction = async (charge: 0 | 1, pendingMessage?: string) => {
    setChargeActionStatus("submitting");
    setChargeActionMessage(pendingMessage ?? (charge === 1 ? "正在下发开始充电指令。" : "正在下发结束充电指令。"));

    const response = await fetch("/api/robot/charge", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ charge }),
    });

    const result = (await response.json()) as {
      ok: boolean;
      error?: string;
      errorCode?: number;
      timestamp?: string;
      charge?: number;
    };

    if (!response.ok || !result.ok) {
      throw new Error(result.error || `自主充电指令下发失败: HTTP ${response.status}`);
    }

    if ((result.errorCode ?? 0) !== 0) {
      throw new Error(`${charge === 1 ? "开始充电" : "结束充电"}返回 ErrorCode=${result.errorCode}`);
    }

    setChargeActionStatus("success");
    setChargeActionMessage(`${charge === 1 ? "开始充电" : "结束充电"}指令已下发，返回时间 ${result.timestamp || "-"}。`);
    setRobotChargeState(charge === 1 ? "charging" : "idle");
    return result;
  };

  const handleRobotChargeAction = async (charge: 0 | 1) => {
    try {
      await submitRobotChargeAction(charge);
    } catch (error) {
      setChargeActionStatus("error");
      setChargeActionMessage(error instanceof Error ? error.message : "自主充电指令下发失败");
    }
  };

  const submitTeleopAxisControl = useCallback(async (payload: TeleopAxisPayload) => {
    if (teleopSendingRef.current) {
      return;
    }

    teleopSendingRef.current = true;
    setTeleopStatus("submitting");

    try {
      const response = await fetch("/api/robot/axis-control", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
      });

      const result = (await response.json()) as {
        ok: boolean;
        error?: string;
        timestamp?: string;
      };

      if (!response.ok || !result.ok) {
        throw new Error(result.error || `轴指令下发失败: HTTP ${response.status}`);
      }

      setTeleopStatus("success");
      setTeleopMessage(formatTeleopAxisMessage(payload, result.timestamp ?? null));
    } catch (error) {
      setTeleopStatus("error");
      setTeleopMessage(error instanceof Error ? error.message : "轴指令下发失败");
    } finally {
      teleopSendingRef.current = false;
    }
  }, []);

  const syncTeleopAxisControl = useCallback(
    (force = false) => {
      const payload = buildTeleopAxisPayload(teleopPressedKeysRef.current);
      const signature = serializeTeleopAxisPayload(payload);
      const zeroSignature = serializeTeleopAxisPayload(ZERO_TELEOP_AXIS_PAYLOAD);

      if (!force && signature === zeroSignature && signature === teleopLastSignatureRef.current) {
        return;
      }

      teleopLastSignatureRef.current = signature;
      void submitTeleopAxisControl(payload);
    },
    [submitTeleopAxisControl],
  );

  useEffect(() => {
    if (!teleopEnabled) {
      const hadMotion = teleopLastSignatureRef.current !== serializeTeleopAxisPayload(ZERO_TELEOP_AXIS_PAYLOAD);
      teleopPressedKeysRef.current.clear();
      teleopLastSignatureRef.current = serializeTeleopAxisPayload(ZERO_TELEOP_AXIS_PAYLOAD);
      setTeleopStatus("idle");
      setTeleopMessage("键盘控狗已关闭。开启后使用 W/X/A/D/Q/E 控制机器人移动与偏航，仅常规模式生效。");
      if (hadMotion) {
        void submitTeleopAxisControl(ZERO_TELEOP_AXIS_PAYLOAD);
      }
      return;
    }

    setTeleopStatus("success");
    setTeleopMessage("键盘控狗已开启：W前进，X后退，A左移，D右移，Q左转，E右转。仅常规模式生效。");

    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLSelectElement ||
        (event.target instanceof HTMLElement && event.target.isContentEditable)
      ) {
        return;
      }

      const key = normalizeTeleopKey(event.key);
      if (!key) {
        return;
      }

      event.preventDefault();
      teleopPressedKeysRef.current.add(key);
      syncTeleopAxisControl(true);
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      const key = normalizeTeleopKey(event.key);
      if (!key) {
        return;
      }

      event.preventDefault();
      teleopPressedKeysRef.current.delete(key);
      syncTeleopAxisControl(true);
    };

    const handleBlur = () => {
      teleopPressedKeysRef.current.clear();
      syncTeleopAxisControl(true);
    };

    const timer = window.setInterval(() => {
      if (teleopPressedKeysRef.current.size === 0) {
        return;
      }
      syncTeleopAxisControl(false);
    }, 120);

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
      if (teleopPressedKeysRef.current.size > 0) {
        teleopPressedKeysRef.current.clear();
        teleopLastSignatureRef.current = serializeTeleopAxisPayload(ZERO_TELEOP_AXIS_PAYLOAD);
        void submitTeleopAxisControl(ZERO_TELEOP_AXIS_PAYLOAD);
      }
    };
  }, [syncTeleopAxisControl, submitTeleopAxisControl, teleopEnabled]);

  const handleCancelNavigationTask = async () => {
    setNavControlStatus("submitting");
    setNavControlMessage("正在下发取消导航任务指令。");

    try {
      const response = await fetch("/api/robot/navigation-task-cancel", {
        method: "POST",
        headers: {
          Accept: "application/json",
        },
      });

      const result = (await response.json()) as {
        ok: boolean;
        error?: string;
        errorCode?: number;
        timestamp?: string;
      };

      if (!response.ok || !result.ok) {
        throw new Error(result.error || `取消导航任务失败: HTTP ${response.status}`);
      }

      if ((result.errorCode ?? 0) !== 0) {
        throw new Error(`取消导航任务返回 ErrorCode=${result.errorCode}`);
      }

      setNavControlStatus("success");
      setNavControlMessage(`已下发取消导航任务，返回时间 ${result.timestamp || "-"}`);
    } catch (error) {
      setNavControlStatus("error");
      setNavControlMessage(error instanceof Error ? error.message : "取消导航任务失败");
    }
  };

  const handleSoftEstop = async () => {
    setNavControlStatus("submitting");
    setNavControlMessage("正在下发软急停指令（MotionParam=2）。");

    try {
      const response = await fetch("/api/robot/soft-estop", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ motion: 2 }),
      });

      const result = (await response.json()) as {
        ok: boolean;
        error?: string;
        errorCode?: number;
        timestamp?: string;
      };

      if (!response.ok || !result.ok) {
        throw new Error(result.error || `软急停下发失败: HTTP ${response.status}`);
      }

      if ((result.errorCode ?? 0) !== 0) {
        throw new Error(`软急停返回 ErrorCode=${result.errorCode}`);
      }

      setNavControlStatus("success");
      setNavControlMessage(`软急停已下发，返回时间 ${result.timestamp || "-"}`);
    } catch (error) {
      setNavControlStatus("error");
      setNavControlMessage(error instanceof Error ? error.message : "软急停下发失败");
    }
  };

  const handleRecoverStand = async () => {
    setNavControlStatus("submitting");
    setNavControlMessage("正在下发恢复站立指令（MotionParam=1）。");

    try {
      const response = await fetch("/api/robot/soft-estop", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ motion: 1 }),
      });

      const result = (await response.json()) as {
        ok: boolean;
        error?: string;
        errorCode?: number;
        timestamp?: string;
      };

      if (!response.ok || !result.ok) {
        throw new Error(result.error || `恢复站立下发失败: HTTP ${response.status}`);
      }

      if ((result.errorCode ?? 0) !== 0) {
        throw new Error(`恢复站立返回 ErrorCode=${result.errorCode}`);
      }

      setNavControlStatus("success");
      setNavControlMessage(`恢复站立已下发，返回时间 ${result.timestamp || "-"}`);
    } catch (error) {
      setNavControlStatus("error");
      setNavControlMessage(error instanceof Error ? error.message : "恢复站立下发失败");
    }
  };

  const updateMappingFormField = (field: keyof typeof mappingForm, value: string | boolean) => {
    setMappingForm((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const startFloorSegmentation = () => {
    const initialRange = floorSegmentationAppliedRange ?? {
      minZ: mapMin.z,
      maxZ: mapMax.z,
    };
    setFloorSegmentationDraftRange(initialRange);
    setFloorSegmentationEnabled(true);
    setFloorSegmentationMessage("已切到前视图，请调整上下两条分割线高度。");
    setFrontView();
  };

  const updateFloorSegmentationDraft = (field: "minZ" | "maxZ", value: number) => {
    const clamped = Math.min(Math.max(value, mapMin.z), mapMax.z);
    setFloorSegmentationDraftRange((current) => ({
      minZ: current?.minZ ?? mapMin.z,
      maxZ: current?.maxZ ?? mapMax.z,
      [field]: clamped,
    }));
  };

  const applyFloorSegmentation = () => {
    const nextRange = {
      minZ: Math.min(floorSegmentationRange.minZ, floorSegmentationRange.maxZ),
      maxZ: Math.max(floorSegmentationRange.minZ, floorSegmentationRange.maxZ),
    };
    setFloorSegmentationAppliedRange(nextRange);
    setFloorSegmentationEnabled(false);
    setFloorSegmentationMessage(
      `已确认楼层范围 Z=${nextRange.minZ.toFixed(2)} ~ ${nextRange.maxZ.toFixed(2)}，当前仅显示选中楼层点云。`,
    );
  };

  const clearFloorSegmentation = () => {
    setFloorSegmentationAppliedRange(null);
    setFloorSegmentationEnabled(false);
    setFloorSegmentationDraftRange(null);
    setFloorSegmentationMessage("已恢复显示全部点云。");
  };

  const saveCurrentFloorSegment = () => {
    const nextRange = {
      minZ: Math.min(floorSegmentationRange.minZ, floorSegmentationRange.maxZ),
      maxZ: Math.max(floorSegmentationRange.minZ, floorSegmentationRange.maxZ),
    };
    const name = floorPresetName.trim() || `楼层 ${savedFloorSegments.length + 1}`;
    setSavedFloorSegments((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        name,
        minZ: nextRange.minZ,
        maxZ: nextRange.maxZ,
      },
    ]);
    setFloorPresetName("");
    setFloorSegmentationMessage(`已保存楼层预设“${name}”，可在下方预设列表快速切换。`);
  };

  const applySavedFloorSegment = (segment: SavedFloorSegment) => {
    setFloorSegmentationDraftRange({
      minZ: segment.minZ,
      maxZ: segment.maxZ,
    });
    setFloorSegmentationAppliedRange({
      minZ: segment.minZ,
      maxZ: segment.maxZ,
    });
    setFloorSegmentationEnabled(false);
    setFloorSegmentationMessage(
      `已切换到楼层预设“${segment.name}”，当前显示 Z=${segment.minZ.toFixed(2)} ~ ${segment.maxZ.toFixed(2)} 的点云。`,
    );
  };

  const loadSavedFloorSegmentForEditing = (segment: SavedFloorSegment) => {
    setFloorSegmentationDraftRange({
      minZ: segment.minZ,
      maxZ: segment.maxZ,
    });
    setFloorSegmentationEnabled(true);
    setFloorPresetName(segment.name);
    setFloorSegmentationMessage(`已载入楼层预设“${segment.name}”，请继续调整分割线后确认。`);
    setFrontView();
  };

  const removeSavedFloorSegment = (segmentId: string) => {
    setSavedFloorSegments((current) => current.filter((segment) => segment.id !== segmentId));
    setFloorSegmentationMessage("已删除对应楼层预设。");
  };

  const switchPcdMap = (nextItem: PcdMapItem) => {
    setSelectedPcdId(nextItem.id);
    setSelectedPcdUrl(nextItem.url);
    setShowOccGrid(nextItem.hasLinkedOccGrid);
    setTaskEditorEnabled(false);
    setInitialPoseEditorEnabled(false);
    setInitialPose(null);
    setInitialPoseStatus("idle");
    setInitialPoseMessage("点击“开始标注”后，在画布上按下并拖动即可设置 2D Pose Estimate；PosZ 默认按 0 下发。");
    setTaskPoints([]);
    setTaskDispatchStatus("idle");
    setTaskDispatchMessage("地图已切换。点击“编辑任务点”后，长按并拖动鼠标即可添加点位并标定方向。");
    setFloorSegmentationEnabled(false);
    setFloorSegmentationDraftRange(null);
    setFloorSegmentationAppliedRange(null);
    setSavedFloorSegments([]);
    setFloorPresetName("");
    setFloorSegmentationMessage("地图已切换。若要按楼层分割，请重新选择当前 PCD 的 Z 轴范围。");
    setPcdListMessage(
      nextItem.hasLinkedOccGrid
        ? `已切换到 ${nextItem.label}，已自动切换对应 2D 栅格地图。`
        : `已切换到 ${nextItem.label}，样例点云不显示 2D 栅格。`,
    );
  };

  const handleStartMapping = async () => {
    setMappingActionStatus("submitting");
    setMappingActionMessage("正在下发开始建图指令。");

    try {
      const response = await fetch("/api/mapping/start", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(mappingForm),
      });

      const result = (await response.json()) as {
        ok: boolean;
        error?: string;
        errorCode?: number;
        errorMessage?: string;
        taskState?: string;
        activeMapDir?: string;
        activeMapName?: string;
        timestamp?: string;
      };

      if (!response.ok || !result.ok) {
        throw new Error(result.error || `开始建图失败: HTTP ${response.status}`);
      }

      if ((result.errorCode ?? 0) !== 0) {
        throw new Error(result.errorMessage || `开始建图返回错误码 ${formatHexCode(result.errorCode ?? 0)}`);
      }

      setMappingActionStatus("success");
      setMappingActionMessage(
        `建图已开始，状态 ${formatMappingTaskState(result.taskState)}，地图 ${result.activeMapName || result.activeMapDir || "-"}。`,
      );
    } catch (error) {
      setMappingActionStatus("error");
      setMappingActionMessage(error instanceof Error ? error.message : "开始建图失败");
    }
  };

  const handleStopMapping = async () => {
    setMappingActionStatus("submitting");
    setMappingActionMessage("正在下发停止建图并保存指令，可能需要较长时间。");

    try {
      const response = await fetch("/api/mapping/stop", {
        method: "POST",
        headers: {
          Accept: "application/json",
        },
      });

      const result = (await response.json()) as {
        ok: boolean;
        error?: string;
        errorCode?: number;
        errorMessage?: string;
        taskState?: string;
        activeMapDir?: string;
        timestamp?: string;
      };

      if (!response.ok || !result.ok) {
        throw new Error(result.error || `停止建图失败: HTTP ${response.status}`);
      }

      if ((result.errorCode ?? 0) !== 0) {
        throw new Error(result.errorMessage || `停止建图返回错误码 ${formatHexCode(result.errorCode ?? 0)}`);
      }

      setMappingActionStatus("success");
      setMappingActionMessage(
        `停止建图请求已完成，状态 ${formatMappingTaskState(result.taskState)}，目录 ${result.activeMapDir || "-"}`,
      );
    } catch (error) {
      setMappingActionStatus("error");
      setMappingActionMessage(error instanceof Error ? error.message : "停止建图失败");
    }
  };

  const handleApplyMapping = async (mapName: string) => {
    setMappingApplyingName(mapName);
    setMappingActionStatus("submitting");
    setMappingActionMessage(`正在切换导航地图到 ${mapName}。`);

    try {
      const response = await fetch("/api/mapping/apply", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ mapName }),
      });

      const result = (await response.json()) as {
        ok: boolean;
        error?: string;
        errorCode?: number;
        errorMessage?: string;
        activeMapDir?: string;
        activeMapName?: string;
      };

      if (!response.ok || !result.ok) {
        throw new Error(result.error || `切换导航地图失败: HTTP ${response.status}`);
      }

      if ((result.errorCode ?? 0) !== 0) {
        throw new Error(result.errorMessage || `切换地图返回错误码 ${formatHexCode(result.errorCode ?? 0)}`);
      }

      setMappingActionStatus("success");
      setMappingActionMessage(`已切换导航地图到 ${result.activeMapName || mapName}。`);
    } catch (error) {
      setMappingActionStatus("error");
      setMappingActionMessage(error instanceof Error ? error.message : "切换导航地图失败");
    } finally {
      setMappingApplyingName("");
    }
  };

  const updateTaskPointType = (id: string, nextType: TaskPointType) => {
    setTaskPoints((current) =>
      reindexTaskPoints(
        current.map((point) => (point.id === id ? { ...point, type: nextType } : point)),
        robotPose?.yaw ?? 0,
        true,
      ),
    );
    setTaskDispatchStatus("idle");
    setTaskDispatchMessage("已更新点位类型，顺序任务预览已刷新。");
  };

  const updateTaskPointNavigationField = (
    id: string,
    field: "gait" | "speed" | "manner" | "obsMode" | "navMode",
    value: number,
  ) => {
    setTaskPoints((current) =>
      reindexTaskPoints(
        current.map((point) => (point.id === id ? { ...point, [field]: value } : point)),
        robotPose?.yaw ?? 0,
        true,
      ),
    );
    setTaskDispatchStatus("idle");
    setTaskDispatchMessage("已更新点位导航参数，顺序任务预览已刷新。");
  };

  const removeTaskPoint = (id: string) => {
    setTaskPoints((current) => reindexTaskPoints(current.filter((point) => point.id !== id), robotPose?.yaw ?? 0, true));
    setTaskDispatchStatus("idle");
    setTaskDispatchMessage("已删除任务点，剩余点位顺序已刷新。");
  };

  const removeLastTaskPoint = () => {
    setTaskPoints((current) => reindexTaskPoints(current.slice(0, -1), robotPose?.yaw ?? 0, true));
    setTaskDispatchStatus("idle");
    setTaskDispatchMessage("已删除最后一个任务点。");
  };

  const clearTaskPoints = () => {
    setTaskPoints([]);
    setTaskDispatchStatus("idle");
    setTaskDispatchMessage("已清空任务点。");
  };

  const saveCurrentRoute = () => {
    if (taskPoints.length === 0) {
      setRouteMessage("当前没有任务点，无法保存路线。");
      return;
    }

    const trimmedName = routeNameInput.trim();
    if (!trimmedName) {
      setRouteMessage("请先输入路线名称。");
      return;
    }

    const normalizedPoints = reindexTaskPoints(taskPoints, robotPose?.yaw ?? 0, true);
    const now = new Date().toISOString();

    setSavedRoutes((current) => {
      const existing = current.find((route) => route.id === selectedRouteId && route.name === trimmedName);
      const nextRoute: SavedRoute = existing
        ? {
            ...existing,
            name: trimmedName,
            points: normalizedPoints,
            updatedAt: now,
          }
        : {
            id: crypto.randomUUID(),
            name: trimmedName,
            points: normalizedPoints,
            createdAt: now,
            updatedAt: now,
          };

      const nextRoutes = existing
        ? current.map((route) => (route.id === existing.id ? nextRoute : route))
        : [nextRoute, ...current];

      setSelectedRouteId(nextRoute.id);
      setRouteMessage(existing ? `已更新路线“${trimmedName}”。` : `已保存新路线“${trimmedName}”。`);
      return nextRoutes;
    });
  };

  const loadSelectedRoute = (routeId: string) => {
    setSelectedRouteId(routeId);
    const route = savedRoutes.find((item) => item.id === routeId);
    if (!route) {
      setRouteMessage("未找到所选路线。");
      return;
    }

    setTaskPoints(reindexTaskPoints(route.points, robotPose?.yaw ?? 0, true));
    setTaskEditorEnabled(false);
    setTaskDispatchStatus("idle");
    setTaskDispatchMessage(`已加载路线“${route.name}”，共 ${route.points.length} 个点位。`);
    setRouteNameInput(route.name);
    setRouteMessage(`已切换到路线“${route.name}”。`);
  };

  const deleteSelectedRoute = () => {
    if (!selectedRoute) {
      setRouteMessage("请先选择要删除的路线。");
      return;
    }

    const routeName = selectedRoute.name;
    setSavedRoutes((current) => current.filter((route) => route.id !== selectedRoute.id));
    setSelectedRouteId("");
    setRouteNameInput("");
    setRouteMessage(`已删除路线“${routeName}”。`);
  };

  const importRouteFromJsonl = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      const raw = await file.text();
      const lines = raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

      if (lines.length === 0) {
        throw new Error("JSONL 文件为空。");
      }

      const parsedPoints = lines.map((line, index) => {
        const item = JSON.parse(line) as Partial<TaskPoint> & {
          type?: number;
          gait?: number;
          speed?: number;
          manner?: number;
          obs_mode?: number;
          nav_mode?: number;
          obsMode?: number;
          navMode?: number;
        };

        const type = item.type === 0 || item.type === 1 || item.type === 3 ? item.type : 1;
        return {
          id: item.id ?? crypto.randomUUID(),
          index: index + 1,
          label: typeof item.label === "string" && item.label.trim() ? item.label : `P${index + 1}`,
          type,
          x: Number(item.x ?? 0),
          y: Number(item.y ?? 0),
          z: Number(item.z ?? 0),
          yaw: Number(item.yaw ?? robotPose?.yaw ?? 0),
          gait: Number(item.gait ?? DEFAULT_NAVIGATION_TASK.Gait),
          speed: Number(item.speed ?? DEFAULT_NAVIGATION_TASK.Speed),
          manner: Number(item.manner ?? DEFAULT_NAVIGATION_TASK.Manner),
          obsMode: Number(item.obsMode ?? item.obs_mode ?? DEFAULT_NAVIGATION_TASK.ObsMode),
          navMode: Number(item.navMode ?? item.nav_mode ?? DEFAULT_NAVIGATION_TASK.NavMode),
          status: "draft" as const,
        };
      });

      if (
        parsedPoints.some((point) =>
          [point.x, point.y, point.z, point.yaw, point.gait, point.speed, point.manner, point.obsMode, point.navMode].some(
            (value) => Number.isNaN(value),
          ),
        )
      ) {
        throw new Error("JSONL 中存在无效数值字段。");
      }

      const normalized = reindexTaskPoints(parsedPoints, robotPose?.yaw ?? 0, true);
      const inferredName = file.name.replace(/\.jsonl$/i, "").trim();
      setTaskPoints(normalized);
      setTaskEditorEnabled(false);
      setTaskDispatchStatus("idle");
      setTaskDispatchMessage(`已从 ${file.name} 导入 ${normalized.length} 个任务点。`);
      setRouteNameInput(inferredName || "导入路线");
      setRouteMessage(`已导入 JSONL：${file.name}。可直接保存为本地路线。`);
    } catch (error) {
      setRouteMessage(error instanceof Error ? error.message : "JSONL 导入失败。");
    } finally {
      event.target.value = "";
    }
  };

  const submitNavigationSequence = async () => {
    if (navigationPayloads.length === 0 || taskDispatchStatus === "dispatching") {
      return;
    }

    setTaskDispatchStatus("dispatching");
    setTaskDispatchMessage("正在按顺序真实下发 1003/1 单点导航任务，请勿重复点击。");
    setTaskEditorEnabled(false);
    setTaskPoints((current) => current.map((point) => ({ ...point, status: "queued" })));

    try {
      let isCharging = robotChargeState === "charging";

      for (let index = 0; index < navigationPayloads.length; index += 1) {
        const payload = navigationPayloads[index];
        const pointLabel = taskPoints[index]?.label ?? `P${index + 1}`;

        if (isCharging) {
          setTaskDispatchMessage(`检测到当前为充电状态，正在结束充电后下发 ${pointLabel}。`);
          await submitRobotChargeAction(0, `检测到当前为充电状态，正在结束充电后下发 ${pointLabel}。`);
          isCharging = false;
        }

        setTaskPoints((current) =>
          current.map((point, pointIndex) => ({
            ...point,
            status: pointIndex < index ? "done" : pointIndex === index ? "running" : "queued",
          })),
        );
        setTaskDispatchMessage(`正在下发 ${pointLabel}，类型为 ${TASK_POINT_TYPE_META[payload.PointInfo].label}。`);

        const response = await fetch("/api/robot/navigation-task", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(payload),
        });

        const result = (await response.json()) as {
          ok: boolean;
          error?: string;
          errorCode?: number;
          status?: number;
          timestamp?: string;
        };

        if (!response.ok || !result.ok) {
          throw new Error(result.error || `${pointLabel} 下发失败: HTTP ${response.status}`);
        }

        if (!NAVIGATION_SUCCESS_ERROR_CODES.has(result.errorCode ?? 0)) {
          throw new Error(`${pointLabel} 返回 ErrorCode=${result.errorCode}`);
        }

        setTaskPoints((current) =>
          current.map((point, pointIndex) => ({
            ...point,
            status: pointIndex <= index ? "done" : "queued",
          })),
        );
        setTaskDispatchMessage(
          `已下发 ${pointLabel}，返回 Status=${result.status ?? "-"}，时间 ${result.timestamp || "-"}`,
        );

        if (payload.PointInfo === 3) {
          await submitRobotChargeAction(1, `${pointLabel} 为充电点，已到点，正在自动开始充电。`);
          isCharging = true;
          setTaskDispatchMessage(`${pointLabel} 为充电点，已自动下发开始充电。`);
        }
      }

      setTaskDispatchStatus("prepared");
      setTaskDispatchMessage(`已按顺序完成 ${navigationPayloads.length} 个点位的真实下发，请结合机器人实际执行状态继续验证。`);
    } catch (error) {
      const failedMessage = error instanceof Error ? error.message : "导航任务下发失败";
      setTaskDispatchStatus("error");
      setTaskPoints((current) =>
        current.map((point) => {
          if (point.status === "done") {
            return point;
          }
          if (point.status === "running") {
            return { ...point, status: "error" };
          }
          return { ...point, status: "draft" };
        }),
      );
      setTaskDispatchMessage(failedMessage);
    }
  };

  const exportRouteToJsonl = () => {
    if (taskPoints.length === 0) {
      return;
    }

    const lines = taskPoints.map((point) =>
      JSON.stringify({
        index: point.index,
        label: point.label,
        type: point.type,
        type_name: TASK_POINT_TYPE_META[point.type].label,
        x: Number(point.x.toFixed(3)),
        y: Number(point.y.toFixed(3)),
        z: Number(point.z.toFixed(3)),
        yaw: Number(point.yaw.toFixed(6)),
        gait: point.gait,
        speed: point.speed,
        manner: point.manner,
        obs_mode: point.obsMode,
        nav_mode: point.navMode,
      }),
    );

    const blob = new Blob([lines.join("\n") + "\n"], { type: "application/x-ndjson" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const baseName = (routeNameInput.trim() || selectedRoute?.name || "inspection_route").replace(/[^\w\u4e00-\u9fa5-]+/g, "_");
    anchor.download = `${baseName}_${timestamp}.jsonl`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
    setTaskDispatchMessage(`已导出 ${taskPoints.length} 个巡检点位为 JSONL 文件。`);
  };

  return (
    <main className="h-screen overflow-hidden bg-[#020817] px-4 py-5 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto flex h-[calc(100vh-2.5rem)] max-w-[1600px] flex-col gap-4 rounded-[32px] border border-white/10 bg-slate-950/70 p-4 shadow-[0_24px_80px_rgba(2,8,23,0.55)] backdrop-blur xl:p-5">
        <header className="flex flex-col gap-4 rounded-[28px] border border-white/10 bg-white/[0.04] px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-xs uppercase tracking-[0.35em] text-cyan-100">
              Open Source Robot Inspection Platform
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                开源机器人巡检平台
              </h1>
              <p className="mt-1 text-sm text-slate-400 sm:text-base">
                面向开源机器人巡检场景，集成点云地图浏览、实时定位监看、初始位姿发布与任务点编辑能力。
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <ControlButton
              onClick={() => setTeleopEnabled((current) => !current)}
              className={teleopEnabled ? "border-cyan-300/40 bg-cyan-400/10 text-cyan-100 hover:bg-cyan-400/20" : undefined}
            >
              <Hand className="h-4 w-4" />
              {teleopEnabled ? "关闭键盘控狗" : "键盘控狗"}
            </ControlButton>
            <ControlButton
              onClick={handleCancelNavigationTask}
              disabled={navControlStatus === "submitting"}
              className="border-amber-300/40 bg-amber-400/10 text-amber-100 hover:bg-amber-400/20"
            >
              <Hand className="h-4 w-4" />
              取消导航
            </ControlButton>
            <ControlButton
              onClick={handleSoftEstop}
              disabled={navControlStatus === "submitting"}
              className="border-rose-500/50 bg-rose-500/20 text-rose-100 hover:bg-rose-500/30"
            >
              <Hand className="h-4 w-4" />
              紧急停止
            </ControlButton>
            <ControlButton
              onClick={handleRecoverStand}
              disabled={navControlStatus === "submitting"}
              className="border-emerald-400/40 bg-emerald-400/10 text-emerald-100 hover:bg-emerald-400/20"
            >
              <Hand className="h-4 w-4" />
              恢复站立
            </ControlButton>
            <ControlButton onClick={resetView}>
              <RotateCcw className="h-4 w-4" />
              重置视角
            </ControlButton>
            <ControlButton onClick={setTopView}>
              <ScanSearch className="h-4 w-4" />
              顶视角
            </ControlButton>
            <ControlButton onClick={toggleBackground}>
              {darkBackground ? <SunMedium className="h-4 w-4" /> : <MoonStar className="h-4 w-4" />}
              {darkBackground ? "浅色背景" : "深色背景"}
            </ControlButton>
          </div>
        </header>

        <section className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
          <aside className="min-h-0 overflow-y-auto rounded-[28px] border border-white/10 bg-white/[0.04] p-4">
            <div className="flex flex-col gap-4 pr-1">
            <div className="grid grid-cols-2 gap-3">
              <MetricCard label="点数" value={formatPointCount(pointCount)} />
              <MetricCard label="文件" value={fileName} />
              <MetricCard label="宽度" value={formatMeters(bounds.width)} />
              <MetricCard label="深度" value={formatMeters(bounds.depth)} />
            </div>

            <div className="rounded-[24px] border border-white/10 bg-slate-950/60 p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-white">
                <ScanSearch className="h-4 w-4 text-cyan-200" />
                地图与定位工具
              </div>
              <div className="mt-2 text-sm text-slate-400">
                将地图切换、楼层分割和初始化定位放在同一个操作区，便于按“选图 到 分层 到 定位”的顺序完成操作。
              </div>

              <div className="mt-4 text-xs uppercase tracking-[0.25em] text-slate-500">PCD 地图切换</div>
              <div className="mt-3 flex items-center gap-2">
                <select
                  className="min-w-0 flex-1 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-cyan-300/40"
                  value={selectedPcdId}
                  disabled={pcdListLoading}
                  onChange={(event) => {
                    const nextId = event.target.value;
                    const nextItem = pcdItems.find((item) => item.id === nextId);
                    if (nextItem) {
                      switchPcdMap(nextItem);
                    }
                  }}
                >
                  {pcdItems.length === 0 ? (
                    <option value={selectedPcdId}>读取中...</option>
                  ) : (
                    pcdItems.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))
                  )}
                </select>
                <ControlButton
                  className="shrink-0 px-3 py-2 text-xs"
                  onClick={() => {
                    void loadPcdList({
                      preferredId: selectedPcdId,
                      isManualRefresh: true,
                    });
                  }}
                  disabled={pcdListLoading}
                  aria-label="刷新 PCD 地图列表"
                  title="刷新 PCD 地图列表"
                >
                  <RotateCcw className={`h-4 w-4 ${pcdListLoading ? "animate-spin" : ""}`} />
                  刷新
                </ControlButton>
              </div>
              <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-sm text-slate-300">
                {pcdListMessage}
              </div>
              {selectedPcdItem ? (
                <div className="mt-3 space-y-1 text-xs text-slate-400">
                  <div>来源：{selectedPcdItem.source === "map" ? `地图目录 ${selectedPcdItem.mapName || "-"}` : "样例点云"}</div>
                  <div>occ_grid：{selectedPcdItem.hasLinkedOccGrid ? "将自动切换对应栅格" : "样例资源不显示栅格"}</div>
                </div>
              ) : null}

              <div className="mt-5 text-xs uppercase tracking-[0.25em] text-slate-500">楼层分割</div>
              <div className="mt-3 flex flex-wrap gap-3">
                <ControlButton
                  onClick={startFloorSegmentation}
                  disabled={status !== "ready"}
                  className="border-cyan-300/40 bg-cyan-400/10 text-cyan-100 hover:bg-cyan-400/20"
                >
                  {floorSegmentationEnabled ? "重新对齐前视图" : "开始楼层分割"}
                </ControlButton>
                <ControlButton onClick={applyFloorSegmentation} disabled={!floorSegmentationEnabled || status !== "ready"}>
                  确认只显示该楼层
                </ControlButton>
                <ControlButton
                  onClick={() => setFloorSegmentationEnabled(false)}
                  disabled={!floorSegmentationEnabled}
                >
                  取消编辑
                </ControlButton>
                <ControlButton onClick={clearFloorSegmentation} disabled={!floorSegmentationAppliedRange && !floorSegmentationEnabled}>
                  恢复全部点云
                </ControlButton>
              </div>
              <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-sm text-slate-300">
                {floorSegmentationMessage}
              </div>
              <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-300">
                当前楼层点数：{formatPointCount(floorSegmentationCurrentPointCount)}
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <div className="text-xs uppercase tracking-[0.25em] text-slate-500">下分割线 Z</div>
                  <input
                    className="mt-2 h-2 w-full cursor-pointer appearance-none rounded-full bg-white/10 accent-amber-300"
                    type="range"
                    min={mapMin.z}
                    max={mapMax.z}
                    step={floorSegmentationStep}
                    value={floorSegmentationRange.minZ}
                    disabled={!floorSegmentationEnabled || status !== "ready"}
                    onChange={(event) => updateFloorSegmentationDraft("minZ", Number(event.target.value))}
                  />
                  <div className="mt-2 font-mono text-sm text-amber-100">{floorSegmentationRange.minZ.toFixed(3)} m</div>
                </label>
                <label className="block">
                  <div className="text-xs uppercase tracking-[0.25em] text-slate-500">上分割线 Z</div>
                  <input
                    className="mt-2 h-2 w-full cursor-pointer appearance-none rounded-full bg-white/10 accent-cyan-300"
                    type="range"
                    min={mapMin.z}
                    max={mapMax.z}
                    step={floorSegmentationStep}
                    value={floorSegmentationRange.maxZ}
                    disabled={!floorSegmentationEnabled || status !== "ready"}
                    onChange={(event) => updateFloorSegmentationDraft("maxZ", Number(event.target.value))}
                  />
                  <div className="mt-2 font-mono text-sm text-cyan-100">{floorSegmentationRange.maxZ.toFixed(3)} m</div>
                </label>
              </div>
              <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-300">
                当前楼层厚度：{Math.max(floorSegmentationRange.maxZ - floorSegmentationRange.minZ, 0).toFixed(3)} m
              </div>
              <div className="mt-4 text-xs uppercase tracking-[0.25em] text-slate-500">保存为楼层预设</div>
              <div className="mt-3 flex flex-wrap gap-3">
                <input
                  className="min-w-0 flex-1 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-cyan-300/40"
                  value={floorPresetName}
                  onChange={(event) => setFloorPresetName(event.target.value)}
                  placeholder={`例如：${savedFloorSegments.length + 1}F / 夹层 / 设备层`}
                />
                <ControlButton onClick={saveCurrentFloorSegment} disabled={status !== "ready"}>
                  保存当前楼层
                </ControlButton>
              </div>
              {floorSegmentationAppliedRange ? (
                <div className="mt-3 rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-3 py-2 text-sm text-emerald-100">
                  已应用楼层过滤：Z={floorSegmentationAppliedRange.minZ.toFixed(3)} ~ {floorSegmentationAppliedRange.maxZ.toFixed(3)} m
                </div>
              ) : null}
              <div className="mt-4 text-xs uppercase tracking-[0.25em] text-slate-500">预设楼层列表</div>
              <div className="mt-3 space-y-3">
                {savedFloorSegments.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.03] px-3 py-3 text-sm text-slate-400">
                    还没有保存的楼层。先调整分割线，再点“保存当前楼层”。
                  </div>
                ) : (
                  savedFloorSegments.map((segment) => {
                    const isApplied =
                      !!floorSegmentationAppliedRange &&
                      Math.abs(floorSegmentationAppliedRange.minZ - segment.minZ) < 0.0001 &&
                      Math.abs(floorSegmentationAppliedRange.maxZ - segment.maxZ) < 0.0001;
                    return (
                      <div key={segment.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="font-medium text-white">{segment.name}</div>
                            <div className="mt-1 font-mono text-xs text-slate-400">
                              Z={segment.minZ.toFixed(3)} ~ {segment.maxZ.toFixed(3)} m
                            </div>
                          </div>
                          <div className="rounded-full border border-white/10 px-2 py-1 text-xs text-slate-300">
                            {isApplied ? "当前楼层" : "预设"}
                          </div>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <ControlButton onClick={() => applySavedFloorSegment(segment)}>
                            直接显示
                          </ControlButton>
                          <ControlButton onClick={() => loadSavedFloorSegmentForEditing(segment)}>
                            载入编辑
                          </ControlButton>
                          <ControlButton onClick={() => removeSavedFloorSegment(segment.id)}>
                            删除
                          </ControlButton>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              <div className="mt-5 text-xs uppercase tracking-[0.25em] text-slate-500">初始化定位</div>
              <div className="mt-2 text-sm text-slate-400">
                使用 2D Pose Estimate 重新初始化定位。点击“开始标注”后，在画布上按下并拖动选择位置和朝向，最终按完整格式下发 `X / Y / Z / Yaw`，其中 `PosZ` 固定为 `0`。
              </div>
              <div className="mt-3 grid grid-cols-4 gap-3">
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-3">
                  <div className="text-xs uppercase tracking-[0.25em] text-slate-500">PosX</div>
                  <div className="mt-2 font-mono text-sm text-slate-100">{initialPose?.x ?? "-"}</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-3">
                  <div className="text-xs uppercase tracking-[0.25em] text-slate-500">PosY</div>
                  <div className="mt-2 font-mono text-sm text-slate-100">{initialPose?.y ?? "-"}</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-3">
                  <div className="text-xs uppercase tracking-[0.25em] text-slate-500">PosZ</div>
                  <div className="mt-2 font-mono text-sm text-slate-100">{initialPose?.z ?? "0.000"}</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-3">
                  <div className="text-xs uppercase tracking-[0.25em] text-slate-500">Yaw</div>
                  <div className="mt-2 font-mono text-sm text-slate-100">{initialPose?.yaw ?? "-"}</div>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-3">
                <ControlButton
                  onClick={() => {
                    setInitialPoseEditorEnabled((current) => {
                      const next = !current;
                      if (next) {
                        setTaskEditorEnabled(false);
                        setInitialPoseStatus("idle");
                        setInitialPoseMessage("初始化定位标注已开启：请在画布上按下并拖动，松开后记录 2D Pose Estimate；PosZ 将固定按 0 下发。");
                      }
                      return next;
                    });
                  }}
                  disabled={initialPoseStatus === "submitting"}
                  className={initialPoseEditorEnabled ? "border-cyan-300/40 bg-cyan-400/10 text-cyan-100 hover:bg-cyan-400/20" : undefined}
                >
                  {initialPoseEditorEnabled ? "结束标注" : "开始标注"}
                </ControlButton>
                <ControlButton onClick={fillFromCurrentPose} disabled={!robotPose || initialPoseStatus === "submitting"}>
                  使用当前位置
                </ControlButton>
                <ControlButton
                  onClick={() => {
                    setInitialPose(null);
                    setInitialPoseEditorEnabled(false);
                    setInitialPoseStatus("idle");
                    setInitialPoseMessage("已清除当前 2D Pose Estimate。");
                  }}
                  disabled={!initialPose || initialPoseStatus === "submitting"}
                >
                  清除标注
                </ControlButton>
                <ControlButton
                  onClick={handleSubmitInitialPose}
                  disabled={initialPoseStatus === "submitting" || !initialPoseSelection}
                  className="border-cyan-300/40 bg-cyan-400/10 text-cyan-100 hover:bg-cyan-400/20"
                >
                  <Send className="h-4 w-4" />
                  {initialPoseStatus === "submitting" ? "发布中" : "发布 2D Pose Estimate"}
                </ControlButton>
              </div>
              <div className={`mt-4 inline-flex rounded-full border px-3 py-1.5 text-sm ${initialPoseTone}`}>
                {initialPoseStatus === "submitting" && "正在下发 2101/1"}
                {initialPoseStatus === "success" && "下发成功"}
                {initialPoseStatus === "error" && "下发异常"}
                {initialPoseStatus === "idle" && "等待手动发布"}
              </div>
              {initialPoseMessage ? (
                <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-sm text-slate-300">
                  {initialPoseMessage}
                </div>
              ) : null}
            </div>

            <div className="rounded-[24px] border border-white/10 bg-slate-950/60 p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-white">
                <Crosshair className="h-4 w-4 text-cyan-200" />
                地图坐标
              </div>
              <div className="mt-3 space-y-3 text-sm text-slate-300">
                <div>
                  <div className="text-xs uppercase tracking-[0.25em] text-slate-500">地图原点</div>
                  <div className="mt-1 font-mono text-cyan-100">{formatVector3(mapOrigin)}</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-[0.25em] text-slate-500">地图起始位置 Min</div>
                  <div className="mt-1 font-mono text-slate-100">{formatVector3(mapMin)}</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-[0.25em] text-slate-500">地图边界 Max</div>
                  <div className="mt-1 font-mono text-slate-100">{formatVector3(mapMax)}</div>
                </div>
              </div>
            </div>

            <div className="rounded-[24px] border border-white/10 bg-slate-950/60 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-white">点大小</div>
                  <div className="text-xs text-slate-400">调整渲染颗粒感，适配大点云观察。</div>
                </div>
                <div className="font-mono text-sm text-cyan-100">{pointSize.toFixed(3)}</div>
              </div>
              <input
                className="mt-4 h-2 w-full cursor-pointer appearance-none rounded-full bg-white/10 accent-cyan-300"
                type="range"
                min="0.005"
                max="0.3"
                step="0.001"
                value={pointSize}
                onChange={(event) => setPointSize(Number(event.target.value))}
              />
              <div className="mt-4 text-sm font-medium text-white">点形状</div>
              <div className="mt-3 flex flex-wrap gap-2">
                <ToggleChip label="圆点" active={pointShape === "round"} onClick={() => setPointShape("round")} />
                <ToggleChip label="方格" active={pointShape === "square"} onClick={() => setPointShape("square")} />
              </div>
            </div>

            <div className="rounded-[24px] border border-white/10 bg-slate-950/60 p-4">
              <div className="text-sm font-medium text-white">辅助层</div>
              <div className="mt-3 flex flex-wrap gap-2">
                <ToggleChip label="网格" active={showGrid} onClick={toggleGrid} />
                <ToggleChip label="坐标轴" active={showAxes} onClick={toggleAxes} />
                {selectedPcdItem?.hasLinkedOccGrid ? (
                  <ToggleChip label="2D栅格" active={showOccGrid} onClick={() => setShowOccGrid((current) => !current)} />
                ) : null}
              </div>
              <div className="mt-3 text-xs text-slate-400">
                {selectedPcdItem?.hasLinkedOccGrid
                  ? "当前地图会自动加载对应的 occ_grid 2D 栅格，可手动开关显示。"
                  : "当前资源为样例点云，不显示 2D 栅格。"}
              </div>
            </div>

            <div className="rounded-[24px] border border-white/10 bg-slate-950/60 p-4">
              <div className="text-sm font-medium text-white">当前状态</div>
              <div className={`mt-3 inline-flex rounded-full border px-3 py-1.5 text-sm ${statusTone}`}>
                {status === "loading" && "加载点云中"}
                {status === "ready" && "点云已就绪"}
                {status === "error" && "加载失败"}
                {status === "idle" && "等待初始化"}
              </div>
              <div className="mt-3 rounded-2xl border border-cyan-300/20 bg-cyan-300/10 px-3 py-2 text-sm text-cyan-100">
                已自动启用 {performanceProfile.label} 性能策略：DPR 上限 {performanceProfile.dprCap}，空闲渲染 {performanceProfile.idleFps} FPS，
                机器人/导航/建图轮询 {Math.round(performanceProfile.posePollingMs / 1000)}/
                {Math.round(performanceProfile.navigationPollingMs / 1000)}/
                {Math.round(performanceProfile.mappingPollingMs / 1000)}s。
              </div>
              <div className="mt-3 text-sm text-slate-400">{performanceProfile.description}</div>
              <div className="mt-3 space-y-2 text-sm text-slate-400">
                <div className="flex items-center gap-2">
                  <Aperture className="h-4 w-4 text-cyan-200" />
                  左键旋转，中键缩放，右键平移。
                </div>
                <div className="flex items-center gap-2">
                  <Grid2x2 className="h-4 w-4 text-cyan-200" />
                  顶视角适合快速对齐地图式观察。
                </div>
                <div className="flex items-center gap-2">
                  <Box className="h-4 w-4 text-cyan-200" />
                  当前高度范围：{formatMeters(bounds.height)}
                </div>
              </div>
              {errorMessage ? (
                <div className="mt-4 rounded-2xl border border-rose-400/30 bg-rose-400/10 p-3 text-sm text-rose-100">
                  {errorMessage}
                </div>
              ) : null}
            </div>

            <div className="rounded-[24px] border border-white/10 bg-slate-950/60 p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-white">
                <LocateFixed className="h-4 w-4 text-emerald-300" />
                机器人定位
              </div>
              <div className={`mt-3 inline-flex rounded-full border px-3 py-1.5 text-sm ${robotStatusTone}`}>
                {robotConnectionStatus === "loading" && "接口请求中"}
                {robotConnectionStatus === "ready" && "接口已连接"}
                {robotConnectionStatus === "error" && "接口异常"}
                {robotConnectionStatus === "idle" && "等待启动"}
              </div>
              <div className="mt-3 text-xs uppercase tracking-[0.25em] text-slate-500">多机器人接口预留</div>
              <div className="mt-2 rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-300">
                当前轮询 `/api/robots/poses`，场景默认显示主机器人，已为多机器人定位接口和主机器人切换预留。
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {robots.length === 0 ? (
                  <div className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-slate-400">暂无机器人</div>
                ) : (
                  robots.map((robot) => (
                    <button
                      key={robot.id}
                      type="button"
                      className={`rounded-full border px-3 py-1.5 text-xs transition ${
                        primaryRobotId === robot.id
                          ? "border-cyan-300/40 bg-cyan-400/10 text-cyan-100"
                          : "border-white/10 bg-white/[0.03] text-slate-300 hover:bg-white/[0.06]"
                      }`}
                      onClick={() => setPrimaryRobot(robot.id)}
                    >
                      <span className="inline-flex items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: robot.color || (primaryRobotId === robot.id ? "#22c55e" : "#64748b") }}
                        />
                        {robot.name}
                      </span>
                    </button>
                  ))
                )}
              </div>
              {robots.length > 0 ? (
                <div className="mt-3 space-y-2 rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-sm text-slate-300">
                  {robots.map((robot) => (
                    <div key={`${robot.id}-summary`} className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-white">{robot.name}</div>
                        <div className="truncate text-xs text-slate-500">{robot.id}</div>
                      </div>
                      <div className="text-right text-xs">
                        <div className={robot.connectionStatus === "ready" ? "text-emerald-200" : "text-rose-200"}>
                          {formatRobotConnectionStatus(robot.connectionStatus)}
                        </div>
                        <div className="text-slate-500">
                          {robot.pose ? `${robot.pose.x.toFixed(2)}, ${robot.pose.y.toFixed(2)}` : "-"}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
              {robotPose ? (
                <div className="mt-3 space-y-2 text-sm text-slate-300">
                  <div>
                    <div className="text-xs uppercase tracking-[0.25em] text-slate-500">Location</div>
                    <div className="mt-1 font-mono text-emerald-100">
                      {robotLocationState === 0 ? "0 (定位正常)" : `${robotLocationState} (定位异常/丢失)`}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-[0.25em] text-slate-500">Position</div>
                    <div className="mt-1 font-mono text-emerald-100">{formatVector3(robotPose)}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-[0.25em] text-slate-500">Yaw</div>
                    <div className="mt-1 font-mono text-emerald-100">{formatYawRadians(robotPose.yaw)}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-[0.25em] text-slate-500">Time</div>
                    <div className="mt-1 font-mono text-emerald-100">{robotPoseTime || "-"}</div>
                  </div>
                </div>
              ) : (
                <div className="mt-3 rounded-2xl border border-dashed border-white/10 bg-white/[0.03] px-3 py-3 text-sm text-slate-400">
                  暂无机器人位姿输入。页面会轮询 `/api/robots/poses`，当前默认显示主机器人位姿。
                </div>
              )}
              {robotErrorMessage ? (
                <div className="mt-3 rounded-2xl border border-rose-400/30 bg-rose-400/10 p-3 text-sm text-rose-100">
                  {robotErrorMessage}
                </div>
              ) : null}
            </div>

            <div className="rounded-[24px] border border-white/10 bg-slate-950/60 p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-white">
                <ScanSearch className="h-4 w-4 text-fuchsia-300" />
                建图与地图
              </div>
              <div className="mt-2 text-sm text-slate-400">
                已接入 `2200` 建图 UDP 网关，支持开始建图、停止保存、状态轮询和切换导航地图。
              </div>

              <div className="mt-4 inline-flex rounded-full border px-3 py-1.5 text-sm">
                {mappingRuntime.connection === "loading" && "建图状态查询中"}
                {mappingRuntime.connection === "ready" && `当前状态：${formatMappingTaskState(mappingRuntime.taskState)}`}
                {mappingRuntime.connection === "error" && "建图状态异常"}
                {mappingRuntime.connection === "idle" && "等待查询建图状态"}
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="block sm:col-span-2">
                  <div className="text-xs uppercase tracking-[0.25em] text-slate-500">MapName</div>
                  <input
                    className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-cyan-300/40"
                    value={mappingForm.mapName}
                    onChange={(event) => updateMappingFormField("mapName", event.target.value)}
                    placeholder="可选，留空则由网关自动生成"
                    disabled={mappingActionStatus === "submitting"}
                  />
                </label>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <ToggleChip
                  label="Headless"
                  active={mappingForm.headless}
                  onClick={() => updateMappingFormField("headless", !mappingForm.headless)}
                />
                <ToggleChip
                  label="室外模式"
                  active={mappingForm.outdoor}
                  onClick={() => updateMappingFormField("outdoor", !mappingForm.outdoor)}
                />
                <ToggleChip
                  label="建完生效"
                  active={mappingForm.activateAfterStop}
                  onClick={() => updateMappingFormField("activateAfterStop", !mappingForm.activateAfterStop)}
                />
              </div>

              <div className="mt-4 flex flex-wrap gap-3">
                <ControlButton
                  onClick={handleStartMapping}
                  disabled={mappingActionStatus === "submitting" || mappingRuntime.taskState === "running" || mappingRuntime.taskState === "saving"}
                  className="border-cyan-300/40 bg-cyan-400/10 text-cyan-100 hover:bg-cyan-400/20"
                >
                  <Send className="h-4 w-4" />
                  {mappingActionStatus === "submitting" ? "处理中" : "开始建图"}
                </ControlButton>
                <ControlButton
                  onClick={handleStopMapping}
                  disabled={mappingActionStatus === "submitting" || mappingRuntime.taskState !== "running"}
                  className="border-amber-300/40 bg-amber-400/10 text-amber-100 hover:bg-amber-400/20"
                >
                  <Send className="h-4 w-4" />
                  停止并保存
                </ControlButton>
              </div>

              <div className={`mt-4 inline-flex rounded-full border px-3 py-1.5 text-sm ${mappingActionTone}`}>
                {mappingActionStatus === "submitting" && "建图指令处理中"}
                {mappingActionStatus === "success" && "建图指令成功"}
                {mappingActionStatus === "error" && "建图指令异常"}
                {mappingActionStatus === "idle" && "等待手动控制"}
              </div>

              <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-sm text-slate-300">
                {mappingActionMessage}
              </div>

              <div className="mt-4 grid gap-2 text-sm text-slate-300">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-slate-500">任务状态</span>
                  <span>{formatMappingTaskState(mappingRuntime.taskState)}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-slate-500">当前地图</span>
                  <span className="truncate text-right">{mappingRuntime.activeMapName || "-"}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-slate-500">MappingService</span>
                  <span>{mappingRuntime.mappingService || "-"}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-slate-500">Localization</span>
                  <span>{mappingRuntime.localizationService || "-"}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-slate-500">Rsdriver</span>
                  <span>{mappingRuntime.rsdriverService || "-"}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-slate-500">产物完整</span>
                  <span>{mappingRuntime.artifactsOk ? "是" : "否"}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-slate-500">错误码</span>
                  <span>{formatHexCode(mappingRuntime.errorCode)}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-slate-500">更新时间</span>
                  <span>{mappingRuntime.timestamp || "-"}</span>
                </div>
              </div>

              <div className="mt-4 text-xs uppercase tracking-[0.25em] text-slate-500">本地地图列表</div>
              <div className="mt-3 max-h-72 space-y-3 overflow-auto pr-1">
                {mappingRuntime.maps.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.03] px-3 py-3 text-sm text-slate-400">
                    暂无地图列表，等待网关返回。
                  </div>
                ) : (
                  mappingRuntime.maps.map((item) => (
                    <div key={item.path || item.name} className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate font-medium text-white">{item.name || "-"}</div>
                          <div className="mt-1 break-all text-xs text-slate-500">{item.path || "-"}</div>
                        </div>
                        <div className="rounded-full border border-white/10 px-2 py-1 text-xs text-slate-300">
                          {item.isActive ? "当前激活" : "待切换"}
                        </div>
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-3 text-xs text-slate-400">
                        <span>产物：{item.artifactsOk ? "完整" : "不完整"}</span>
                        <span>{item.mtime || "-"}</span>
                      </div>
                      <div className="mt-3">
                        <ControlButton
                          onClick={() => handleApplyMapping(item.name)}
                          disabled={
                            mappingActionStatus === "submitting" ||
                            mappingRuntime.taskState === "running" ||
                            mappingRuntime.taskState === "saving" ||
                            item.isActive
                          }
                        >
                          {mappingApplyingName === item.name ? "切换中" : item.isActive ? "当前地图" : "切换到该地图"}
                        </ControlButton>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-[24px] border border-white/10 bg-slate-950/60 p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-white">
                <ListOrdered className="h-4 w-4 text-amber-300" />
                任务点编辑
              </div>
              <div className="mt-2 text-sm text-slate-400">
                开启编辑后，在画布上长按并拖动鼠标即可按顺序添加点位，拖动方向会写入该点位朝向，并自动与前一个点直线连接。
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <ControlButton
                  onClick={() => {
                    setTaskEditorEnabled((current) => {
                      const next = !current;
                      if (next) {
                        setInitialPoseEditorEnabled(false);
                      }
                      return next;
                    });
                  }}
                  disabled={taskDispatchStatus === "dispatching"}
                  className={taskEditorEnabled ? "border-cyan-300/40 bg-cyan-400/10 text-cyan-100 hover:bg-cyan-400/20" : undefined}
                >
                  {taskEditorEnabled ? "结束编辑" : "编辑任务点"}
                </ControlButton>
                <ControlButton onClick={removeLastTaskPoint} disabled={taskPoints.length === 0 || taskDispatchStatus === "dispatching"}>
                  <Trash2 className="h-4 w-4" />
                  删除最后一个
                </ControlButton>
                <ControlButton onClick={clearTaskPoints} disabled={taskPoints.length === 0 || taskDispatchStatus === "dispatching"}>
                  清空点位
                </ControlButton>
              </div>

              <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                <div className="text-xs uppercase tracking-[0.25em] text-slate-500">路线管理</div>
                <div className="mt-3 grid gap-3">
                  <input
                    className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-cyan-300/40"
                    value={routeNameInput}
                    onChange={(event) => setRouteNameInput(event.target.value)}
                    placeholder="输入路线名称，例如 1F_白班巡检"
                  />
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                    <select
                      className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-cyan-300/40"
                      value={selectedRouteId}
                      onChange={(event) => loadSelectedRoute(event.target.value)}
                    >
                      <option value="">选择已保存路线</option>
                      {savedRoutes.map((route) => (
                        <option key={route.id} value={route.id}>
                          {route.name} ({route.points.length} 点)
                        </option>
                      ))}
                    </select>
                    <div className="flex flex-wrap gap-2">
                      <ControlButton
                        onClick={saveCurrentRoute}
                        disabled={taskPoints.length === 0}
                        className="border-cyan-300/40 bg-cyan-400/10 text-cyan-100 hover:bg-cyan-400/20"
                      >
                        <Save className="h-4 w-4" />
                        保存路线
                      </ControlButton>
                      <ControlButton
                        onClick={deleteSelectedRoute}
                        disabled={!selectedRoute}
                        className="border-rose-400/40 bg-rose-400/10 text-rose-100 hover:bg-rose-400/20"
                      >
                        <Trash2 className="h-4 w-4" />
                        删除路线
                      </ControlButton>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <ControlButton
                      onClick={() => routeImportInputRef.current?.click()}
                      className="border-emerald-400/40 bg-emerald-400/10 text-emerald-100 hover:bg-emerald-400/20"
                    >
                      <Upload className="h-4 w-4" />
                      导入 JSONL
                    </ControlButton>
                    <input
                      ref={routeImportInputRef}
                      type="file"
                      accept=".jsonl,application/x-ndjson,application/json"
                      className="hidden"
                      onChange={importRouteFromJsonl}
                    />
                  </div>
                </div>
                <div className="mt-3 rounded-2xl border border-white/10 bg-slate-950/40 px-3 py-2 text-sm text-slate-300">
                  {routeMessage}
                </div>
              </div>

              <div className="mt-4 text-xs uppercase tracking-[0.25em] text-slate-500">当前添加类型</div>
              <div className="mt-3 flex flex-wrap gap-2">
                {TASK_POINT_TYPE_ORDER.map((type) => (
                  <button
                    key={type}
                    type="button"
                    className={`rounded-full border px-3 py-1.5 text-sm transition ${
                      pendingTaskPointType === type
                        ? "border-white/30 bg-white/10 text-white"
                        : "border-white/10 bg-white/[0.03] text-slate-300 hover:bg-white/[0.06]"
                    }`}
                    onClick={() => setPendingTaskPointType(type)}
                  >
                    <span className="inline-flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: TASK_POINT_TYPE_META[type].color }} />
                      {TASK_POINT_TYPE_META[type].label}
                    </span>
                  </button>
                ))}
              </div>

              <div className={`mt-4 inline-flex rounded-full border px-3 py-1.5 text-sm ${taskDispatchTone}`}>
                {taskDispatchStatus === "idle" && "等待编辑任务点"}
                {taskDispatchStatus === "prepared" && "顺序任务已准备"}
                {taskDispatchStatus === "dispatching" && "正在真实顺序下发"}
                {taskDispatchStatus === "error" && "顺序下发异常"}
              </div>
              <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-sm text-slate-300">
                {taskDispatchMessage}
              </div>
              <div className="mt-3 flex flex-wrap gap-3">
                <ControlButton
                  onClick={submitNavigationSequence}
                  disabled={navigationPayloads.length === 0 || taskDispatchStatus === "dispatching"}
                  className="border-cyan-300/40 bg-cyan-400/10 text-cyan-100 hover:bg-cyan-400/20"
                >
                  <Send className="h-4 w-4" />
                  {taskDispatchStatus === "dispatching" ? "下发中" : "真实顺序下发"}
                </ControlButton>
                <ControlButton
                  onClick={() => exportRouteToJsonl()}
                  disabled={taskPoints.length === 0}
                  className="border-emerald-400/40 bg-emerald-400/10 text-emerald-100 hover:bg-emerald-400/20"
                >
                  <Download className="h-4 w-4" />
                  导出 JSONL
                </ControlButton>
              </div>
            </div>

            <div className="rounded-[24px] border border-white/10 bg-slate-950/60 p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-white">
                <Crosshair className="h-4 w-4 text-cyan-200" />
                点位列表
              </div>
              <div className="mt-2 text-sm text-slate-400">
                支持三种点位类型：过渡点、任务点、充电点。编辑后会自动刷新顺序任务 payload。
              </div>
              <div className="mt-4 space-y-3">
                {taskPoints.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.03] px-3 py-3 text-sm text-slate-400">
                    还没有任务点。先切到顶视角，再开启“编辑任务点”并长按拖动画布添加。
                  </div>
                ) : (
                  taskPoints.map((point) => (
                    <div key={point.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: TASK_POINT_TYPE_META[point.type].color }} />
                          <div className="font-medium text-white">{point.label}</div>
                          <div className="text-xs text-slate-500">{TASK_POINT_TYPE_META[point.type].shortLabel}</div>
                        </div>
                        <div className="rounded-full border border-white/10 px-2 py-1 text-xs text-slate-300">
                          {formatTaskPointStatus(point.status)}
                        </div>
                      </div>
                      <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] gap-3">
                        <div className="space-y-1 text-sm text-slate-300">
                          <div className="font-mono">{formatVector3(point)}</div>
                          <div className="font-mono text-slate-400">{formatYawRadians(point.yaw)}</div>
                        </div>
                        <div className="flex items-start gap-2">
                          <select
                            className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-cyan-300/40"
                            value={point.type}
                            disabled={taskDispatchStatus === "dispatching"}
                            onChange={(event) => updateTaskPointType(point.id, Number(event.target.value) as TaskPointType)}
                          >
                            {TASK_POINT_TYPE_ORDER.map((type) => (
                              <option key={type} value={type}>
                                {TASK_POINT_TYPE_META[type].label}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            className="rounded-2xl border border-white/10 bg-white/[0.04] p-2 text-slate-300 transition hover:bg-white/[0.08]"
                            disabled={taskDispatchStatus === "dispatching"}
                            onClick={() => removeTaskPoint(point.id)}
                            aria-label={`删除 ${point.label}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        <label className="block">
                          <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">步态</div>
                          <select
                            className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-cyan-300/40"
                            value={point.gait}
                            disabled={taskDispatchStatus === "dispatching"}
                            onChange={(event) => updateTaskPointNavigationField(point.id, "gait", Number(event.target.value))}
                          >
                            {NAVIGATION_GAIT_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="block">
                          <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">速度</div>
                          <select
                            className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-cyan-300/40"
                            value={point.speed}
                            disabled={taskDispatchStatus === "dispatching"}
                            onChange={(event) => updateTaskPointNavigationField(point.id, "speed", Number(event.target.value))}
                          >
                            {NAVIGATION_SPEED_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="block">
                          <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">运动方式</div>
                          <select
                            className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-cyan-300/40"
                            value={point.manner}
                            disabled={taskDispatchStatus === "dispatching"}
                            onChange={(event) => updateTaskPointNavigationField(point.id, "manner", Number(event.target.value))}
                          >
                            {NAVIGATION_MANNER_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="block">
                          <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">停避障</div>
                          <select
                            className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-cyan-300/40"
                            value={point.obsMode}
                            disabled={taskDispatchStatus === "dispatching"}
                            onChange={(event) => updateTaskPointNavigationField(point.id, "obsMode", Number(event.target.value))}
                          >
                            {NAVIGATION_OBS_MODE_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="block sm:col-span-2">
                          <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">导航方式</div>
                          <select
                            className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-cyan-300/40"
                            value={point.navMode}
                            disabled={taskDispatchStatus === "dispatching"}
                            onChange={(event) => updateTaskPointNavigationField(point.id, "navMode", Number(event.target.value))}
                          >
                            {NAVIGATION_MODE_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-[24px] border border-white/10 bg-slate-950/60 p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-white">
                <Send className="h-4 w-4 text-cyan-200" />
                顺序任务预览
              </div>
              <div className="mt-2 text-sm text-slate-400">
                当前按 `1003/1` 单点导航协议生成 payload，默认 `MapID=0`、`Gait=0x3002`、`Speed=0`、`NavMode=1`。各点位可单独调整步态、速度、运动方式、停避障和导航方式。
              </div>
              <div className="mt-4 max-h-72 space-y-3 overflow-auto pr-1">
                {navigationPayloads.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.03] px-3 py-3 text-sm text-slate-400">
                    暂无顺序任务 payload。添加点位后会自动生成。
                  </div>
                ) : (
                  navigationPayloads.map((payload, index) => (
                    <div key={`${payload.Value}-${index}`} className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 font-mono text-xs text-slate-300">
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <div className="text-sm text-white">
                          {taskPoints[index]?.label} · {TASK_POINT_TYPE_META[payload.PointInfo].label}
                        </div>
                        <div className="text-slate-500">Value={payload.Value}</div>
                      </div>
                      <div>Pos=({payload.PosX.toFixed(3)}, {payload.PosY.toFixed(3)}, {payload.PosZ.toFixed(3)})</div>
                      <div>Yaw={payload.AngleYaw.toFixed(3)} rad | PointInfo={payload.PointInfo}</div>
                      <div>Gait={payload.Gait} | Speed={payload.Speed} | Manner={payload.Manner}</div>
                      <div>ObsMode={payload.ObsMode} | NavMode={payload.NavMode}</div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-[24px] border border-white/10 bg-slate-950/60 p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-white">
                <Send className="h-4 w-4 text-cyan-200" />
                自主充电
              </div>
              <div className="mt-2 text-sm text-slate-400">
                手动下发 `2 / 24` 指令：`Charge=1` 开始充电，`Charge=0` 结束充电。
              </div>

              <div className="mt-4 flex flex-wrap gap-3">
                <ControlButton
                  onClick={() => handleRobotChargeAction(1)}
                  disabled={chargeActionStatus === "submitting"}
                  className="border-cyan-300/40 bg-cyan-400/10 text-cyan-100 hover:bg-cyan-400/20"
                >
                  <Send className="h-4 w-4" />
                  开始充电
                </ControlButton>
                <ControlButton
                  onClick={() => handleRobotChargeAction(0)}
                  disabled={chargeActionStatus === "submitting"}
                  className="border-amber-300/40 bg-amber-400/10 text-amber-100 hover:bg-amber-400/20"
                >
                  <Send className="h-4 w-4" />
                  结束充电
                </ControlButton>
              </div>

              <div className={`mt-4 inline-flex rounded-full border px-3 py-1.5 text-sm ${chargeActionTone}`}>
                {chargeActionStatus === "submitting" && "正在下发自主充电指令"}
                {chargeActionStatus === "success" && "下发成功"}
                {chargeActionStatus === "error" && "下发异常"}
                {chargeActionStatus === "idle" && "等待手动发布"}
              </div>

              <div className="mt-3 text-xs uppercase tracking-[0.25em] text-slate-500">当前记录状态</div>
              <div className="mt-2 rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-300">
                {robotChargeState === "charging" && "充电中"}
                {robotChargeState === "idle" && "空闲/未充电"}
                {robotChargeState === "unknown" && "未知"}
              </div>

              <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-sm text-slate-300">
                {chargeActionMessage}
              </div>
            </div>
            </div>
          </aside>

          <section className="relative min-h-0 overflow-hidden rounded-[28px] border border-white/10 bg-slate-950">
            <div
              ref={containerRef}
              className="absolute inset-0"
              aria-label="PCD 点云查看画布"
            />

            <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-slate-950 via-slate-950/45 to-transparent" />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-slate-950 via-slate-950/60 to-transparent" />

            <div className="absolute left-4 top-4 rounded-2xl border border-white/10 bg-slate-950/75 px-4 py-3 text-sm text-slate-300 shadow-[0_12px_40px_rgba(0,0,0,0.3)] backdrop-blur">
              <div className="font-mono text-xs uppercase tracking-[0.35em] text-cyan-100">Active File</div>
              <div className="mt-2 text-base text-white">{fileName}</div>
              <div className="mt-1 text-xs text-slate-400">{selectedPcdUrl}</div>
              <div className="mt-3 text-xs text-slate-400">XYZ 坐标轴 | 绿色箭头: 机器人位姿</div>
              <div className="mt-1 text-xs text-slate-400">
                黄: 过渡点 | 青: 任务点 | 紫: 充电点
              </div>
            </div>

            <div className="absolute right-4 top-4 w-[320px] rounded-2xl border border-white/10 bg-slate-950/75 px-4 py-3 text-sm text-slate-300 shadow-[0_12px_40px_rgba(0,0,0,0.3)] backdrop-blur">
              <div className="text-xs uppercase tracking-[0.35em] text-cyan-100">定位与导航状态</div>
              <div className={`mt-3 rounded-2xl border px-3 py-2 text-xs ${teleopTone}`}>
                {teleopMessage}
              </div>
              <div className={`mt-3 rounded-2xl border px-3 py-2 text-xs ${navControlTone}`}>
                {navControlMessage}
              </div>
              <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                <div className="text-[11px] uppercase tracking-[0.25em] text-emerald-200">定位状态</div>
                <div className="mt-2 flex items-center gap-2">
                  <div className={`inline-flex rounded-full border px-2.5 py-1 text-xs ${robotStatusTone}`}>
                    {robotConnectionStatus === "loading" && "接口请求中"}
                    {robotConnectionStatus === "ready" && "接口已连接"}
                    {robotConnectionStatus === "error" && "接口异常"}
                    {robotConnectionStatus === "idle" && "等待启动"}
                  </div>
                  <div className="text-xs text-slate-400">
                    {robotLocationState === 0 ? "定位正常" : robotLocationState === null ? "等待位姿" : `定位异常/丢失 (${robotLocationState})`}
                  </div>
                </div>
                <div className="mt-2 text-xs text-slate-400">
                  {robotPose ? `位置 ${robotPose.x.toFixed(2)}, ${robotPose.y.toFixed(2)} | Yaw ${robotPose.yaw.toFixed(2)} rad` : "暂无机器人位姿输入"}
                </div>
                <div className="mt-1 text-xs text-slate-500">更新时间：{robotPoseTime || "-"}</div>
              </div>
              <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                <div className="text-[11px] uppercase tracking-[0.25em] text-cyan-100">导航状态</div>
                <div className="mt-2 text-base text-white">{navigationRuntime.message}</div>
                <div className="mt-2 text-xs text-slate-400">
                  {navigationRuntime.connection === "loading" && "状态查询中"}
                  {navigationRuntime.connection === "ready" && `目标点 ${navigationRuntime.value ?? "-"} | Status ${formatNavigationStatusLabel(navigationRuntime.status)}`}
                  {navigationRuntime.connection === "error" && "状态查询异常"}
                  {navigationRuntime.connection === "idle" && "等待查询"}
                </div>
                <div className="mt-1 text-xs text-slate-400">
                  错误码：{formatNavigationErrorCode(navigationRuntime.errorCode)}
                </div>
                <div className="mt-1 text-xs text-slate-500">更新时间：{navigationRuntime.timestamp || "-"}</div>
              </div>
            </div>

            {taskEditorEnabled ? (
              <div className="absolute left-4 top-32 rounded-2xl border border-cyan-300/30 bg-cyan-300/10 px-4 py-3 text-sm text-cyan-100 shadow-[0_12px_40px_rgba(0,0,0,0.25)] backdrop-blur">
                编辑模式已开启：长按并拖动画布，添加{TASK_POINT_TYPE_META[pendingTaskPointType].label}并标定方向
              </div>
            ) : null}
            {initialPoseEditorEnabled ? (
              <div className="absolute left-4 top-48 rounded-2xl border border-amber-300/30 bg-amber-300/10 px-4 py-3 text-sm text-amber-100 shadow-[0_12px_40px_rgba(0,0,0,0.25)] backdrop-blur">
                初始化定位标注已开启：在画布上按下并拖动，松开后记录 2D Pose Estimate（PosZ 固定为 0）
              </div>
            ) : null}

            <div className="absolute bottom-4 right-4 rounded-2xl border border-white/10 bg-slate-950/75 px-4 py-3 text-sm text-slate-300 shadow-[0_12px_40px_rgba(0,0,0,0.3)] backdrop-blur">
              <div>鼠标左键: 旋转</div>
              <div>滚轮: 缩放</div>
              <div>右键: 平移</div>
            </div>
          </section>
        </section>
      </div>
    </main>
  );
}

function reindexTaskPoints(points: TaskPoint[], fallbackYaw: number, resetStatus: boolean) {
  return points.map((point, index) => {
    return {
      ...point,
      index: index + 1,
      label: `P${index + 1}`,
      yaw: Number.isFinite(point.yaw) ? point.yaw : fallbackYaw,
      status: resetStatus ? "draft" : point.status,
    };
  });
}

function formatTaskPointStatus(status: TaskPoint["status"]) {
  if (status === "queued") {
    return "已排队";
  }
  if (status === "running") {
    return "执行中";
  }
  if (status === "done") {
    return "已完成";
  }
  if (status === "error") {
    return "下发异常";
  }
  return "草稿";
}

function formatNavigationStatusLabel(status: number | null) {
  if (status === 0) {
    return "空闲";
  }
  if (status === 1) {
    return "退出充电桩中";
  }
  if (status === 2) {
    return "导航预处理";
  }
  if (status === 3) {
    return "导航中";
  }
  if (status === 4) {
    return "导航完成";
  }
  if (status === 5) {
    return "进入充电桩中";
  }
  if (status === 0xff) {
    return "暂停中";
  }
  return "未知";
}

function formatNavigationErrorCode(errorCode: number | null) {
  if (errorCode === null) {
    return "-";
  }
  return `0x${errorCode.toString(16).toUpperCase()}`;
}

function formatInitialPoseErrorCode(errorCode: number | null) {
  if (errorCode === null) {
    return "-";
  }
  if (errorCode >= 0 && errorCode <= 9) {
    return `${errorCode}`;
  }
  return formatHexCode(errorCode);
}

function formatProtocolErrorLabel(errorCode: number | null) {
  if (errorCode === 0xE001) {
    return "数据格式不支持";
  }
  if (errorCode === 0xE002) {
    return "数据解析失败";
  }
  if (errorCode === 0xE003) {
    return "不支持的协议";
  }
  if (errorCode === 0xE004) {
    return "缺少必要字段";
  }
  if (errorCode === 0xE005) {
    return "字段类型不匹配";
  }
  if (errorCode === 0xE006) {
    return "请求客户端不匹配";
  }
  if (errorCode === 0xE007) {
    return "无操作权限";
  }
  if (errorCode === 0xE008) {
    return "不允许的操作";
  }
  if (errorCode === 0xE009) {
    return "操作失败";
  }
  if (errorCode === 0xE00A) {
    return "不支持的功能";
  }
  if (errorCode === 0xE00B) {
    return "内部错误";
  }
  if (errorCode === 0xA313) {
    return "定位异常";
  }
  return null;
}

function formatInitialPoseResultMessage(errorCode: number | null, timestamp: string | null) {
  if (errorCode === 0) {
    return `初始位姿已下发，返回时间 ${timestamp || "-"}。建议等待约 5s 后观察定位状态。`;
  }
  if (errorCode === 1) {
    return "初始化定位失败。请检查所选位置与朝向是否和当前地图一致；协议说明该即时失败不一定代表最终重定位失败，建议等待约 5s 后再观察定位状态。";
  }

  const label = formatProtocolErrorLabel(errorCode);
  if (label) {
    return `初始化定位失败：${label}（错误码 ${formatInitialPoseErrorCode(errorCode)}）。`;
  }

  return `初始化定位失败：未知错误（错误码 ${formatInitialPoseErrorCode(errorCode)}）。`;
}

function formatNavigationRuntimeMessage(status: number | null, errorCode: number | null) {
  if (errorCode === 0x2300) {
    return "导航任务正常结束";
  }
  if (errorCode === 0x2302) {
    return "导航任务已取消";
  }
  if (errorCode === 0x8605) {
    return "移动到点超时";
  }
  if (errorCode === 0xA301) {
    return "运动状态异常";
  }
  if (errorCode === 0xA302) {
    return "低电量或电池模式";
  }
  if (errorCode === 0xA303) {
    return "电机状态异常";
  }
  if (errorCode === 0xA305) {
    return "雷达异常";
  }
  if (errorCode === 0xA313) {
    return "定位异常";
  }
  if (errorCode === 0xA34C) {
    return "导航全局规划失败";
  }
  if (errorCode === 0xA34B) {
    return "局部导航持续避障";
  }
  if (errorCode && errorCode !== 0) {
    return `导航异常 ${formatNavigationErrorCode(errorCode)}`;
  }
  return formatNavigationStatusLabel(status);
}

function formatRobotConnectionStatus(status: "idle" | "loading" | "ready" | "error") {
  if (status === "ready") {
    return "在线";
  }
  if (status === "loading") {
    return "请求中";
  }
  if (status === "error") {
    return "异常";
  }
  return "待机";
}

function formatHexCode(value: number | null) {
  if (value === null) {
    return "-";
  }
  return `0x${value.toString(16).toUpperCase()}`;
}

function formatMappingTaskState(taskState: string) {
  if (taskState === "idle") {
    return "空闲";
  }
  if (taskState === "running") {
    return "建图中";
  }
  if (taskState === "saving") {
    return "保存中";
  }
  if (taskState === "failed") {
    return "异常";
  }
  return taskState || "未知";
}
