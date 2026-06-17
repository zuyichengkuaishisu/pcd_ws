import { useEffect, useMemo, useState } from "react";
import {
  Aperture,
  Box,
  Crosshair,
  Grid2x2,
  ListOrdered,
  LocateFixed,
  MoonStar,
  RotateCcw,
  ScanSearch,
  Send,
  SunMedium,
  Trash2,
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
import { formatMeters, formatPointCount, formatVector3, formatYawRadians } from "@/utils/viewerFormat";

const FILE_URL = "/api/map/pcd/outside_15cm_simpled.pcd";
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
    setPointSize,
    toggleGrid,
    toggleAxes,
    toggleBackground,
    setStatus,
    setSceneInfo,
  } = useViewerStore();
  const [taskEditorEnabled, setTaskEditorEnabled] = useState(false);
  const [pendingTaskPointType, setPendingTaskPointType] = useState<TaskPointType>(1);
  const [taskPoints, setTaskPoints] = useState<TaskPoint[]>([]);
  const [taskDispatchStatus, setTaskDispatchStatus] = useState<"idle" | "prepared" | "dispatching" | "error">("idle");
  const [taskDispatchMessage, setTaskDispatchMessage] = useState("点击“编辑任务点”后，长按并拖动鼠标即可添加点位并标定方向。");
  const [pointShape, setPointShape] = useState<"round" | "square">("round");
  const [initialPose, setInitialPose] = useState({
    x: "0.000",
    y: "0.000",
    z: "0.000",
    yaw: "0.000",
  });
  const [initialPoseStatus, setInitialPoseStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [initialPoseMessage, setInitialPoseMessage] = useState("");
  const [chargeActionStatus, setChargeActionStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [chargeActionMessage, setChargeActionMessage] = useState("手动触发开始充电或结束充电。");
  const [robotChargeState, setRobotChargeState] = useState<"unknown" | "idle" | "charging">("unknown");
  const [showOccGrid, setShowOccGrid] = useState(true);
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

  const { containerRef, resetView, setTopView } = usePcdScene({
    fileUrl: FILE_URL,
    pointSize,
    pointShape,
    showGrid,
    showAxes,
    darkBackground,
    showOccGrid,
    robotPose,
    taskPoints,
    taskEditorEnabled,
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
    onStatus: setStatus,
    onSceneReady: setSceneInfo,
  });

  useRobotPosePolling();

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
          timer = window.setTimeout(loadMappingRuntime, 3000);
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
  }, []);

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
          timer = window.setTimeout(loadNavigationRuntime, 1500);
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
  }, []);

  const updateInitialPoseField = (field: "x" | "y" | "z" | "yaw", value: string) => {
    setInitialPose((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const fillFromCurrentPose = () => {
    if (!robotPose) {
      return;
    }

    setInitialPose({
      x: robotPose.x.toFixed(3),
      y: robotPose.y.toFixed(3),
      z: robotPose.z.toFixed(3),
      yaw: robotPose.yaw.toFixed(3),
    });
    setInitialPoseStatus("idle");
    setInitialPoseMessage("已用当前位置填充初始位姿");
  };

  const handleSubmitInitialPose = async () => {
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
          x: Number(initialPose.x),
          y: Number(initialPose.y),
          z: Number(initialPose.z),
          yaw: Number(initialPose.yaw),
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
      setInitialPoseMessage(
        result.errorCode === 0
          ? `初始位姿已下发，返回时间 ${result.timestamp || "-"}。建议等待约 5s 后观察定位状态。`
          : `机器人返回 ErrorCode=${result.errorCode}。协议说明该返回不一定代表最终重定位失败。`,
      );
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

  const updateMappingFormField = (field: keyof typeof mappingForm, value: string | boolean) => {
    setMappingForm((current) => ({
      ...current,
      [field]: value,
    }));
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
                <ToggleChip label="2D栅格" active={showOccGrid} onClick={() => setShowOccGrid((current) => !current)} />
              </div>
              <div className="mt-3 text-xs text-slate-400">
                `occ_grid.yaml` 当前参数: `resolution=0.1`，`origin=(-9.3, -41.3, 0.0)`。
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
                  暂无机器人位姿输入。页面会轮询 `/api/robot/pose`，一旦拿到位姿就自动更新场景里的绿色 marker。
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
                <ListOrdered className="h-4 w-4 text-amber-300" />
                任务点编辑
              </div>
              <div className="mt-2 text-sm text-slate-400">
                开启编辑后，在画布上长按并拖动鼠标即可按顺序添加点位，拖动方向会写入该点位朝向，并自动与前一个点直线连接。
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <ControlButton
                  onClick={() => setTaskEditorEnabled((current) => !current)}
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
                Initial Pose Estimate
              </div>
              <div className="mt-2 text-sm text-slate-400">
                手动向机器人发布 `2101 / 1` 初始位姿，用于初始化或重置定位。
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3">
                {([
                  ["x", "PosX"],
                  ["y", "PosY"],
                  ["z", "PosZ"],
                  ["yaw", "Yaw"],
                ] as const).map(([field, label]) => (
                  <label key={field} className="block">
                    <div className="text-xs uppercase tracking-[0.25em] text-slate-500">{label}</div>
                    <input
                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 font-mono text-sm text-slate-100 outline-none transition focus:border-cyan-300/40 focus:bg-cyan-300/5"
                      value={initialPose[field]}
                      onChange={(event) => updateInitialPoseField(field, event.target.value)}
                    />
                  </label>
                ))}
              </div>

              <div className="mt-4 flex flex-wrap gap-3">
                <ControlButton onClick={fillFromCurrentPose} disabled={!robotPose || initialPoseStatus === "submitting"}>
                  使用当前位置
                </ControlButton>
                <ControlButton
                  onClick={handleSubmitInitialPose}
                  disabled={initialPoseStatus === "submitting"}
                  className="border-cyan-300/40 bg-cyan-400/10 text-cyan-100 hover:bg-cyan-400/20"
                >
                  <Send className="h-4 w-4" />
                  {initialPoseStatus === "submitting" ? "发布中" : "发布初始位姿"}
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
              <div className="mt-1 text-xs text-slate-400">{FILE_URL}</div>
              <div className="mt-3 text-xs text-slate-400">红色点: 地图原点 | 绿色箭头: 机器人位姿</div>
              <div className="mt-1 text-xs text-slate-400">
                黄: 过渡点 | 青: 任务点 | 紫: 充电点
              </div>
            </div>

            <div className="absolute right-4 top-4 rounded-2xl border border-white/10 bg-slate-950/75 px-4 py-3 text-sm text-slate-300 shadow-[0_12px_40px_rgba(0,0,0,0.3)] backdrop-blur">
              <div className="text-xs uppercase tracking-[0.35em] text-cyan-100">导航状态</div>
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

            {taskEditorEnabled ? (
              <div className="absolute left-4 top-32 rounded-2xl border border-cyan-300/30 bg-cyan-300/10 px-4 py-3 text-sm text-cyan-100 shadow-[0_12px_40px_rgba(0,0,0,0.25)] backdrop-blur">
                编辑模式已开启：长按并拖动画布，添加{TASK_POINT_TYPE_META[pendingTaskPointType].label}并标定方向
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
