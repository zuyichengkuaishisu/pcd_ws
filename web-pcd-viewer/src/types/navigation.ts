export type TaskPointType = 0 | 1 | 3;

export type TaskPointStatus = "draft" | "queued" | "running" | "done" | "error";

export type TaskPoint = {
  id: string;
  index: number;
  label: string;
  type: TaskPointType;
  x: number;
  y: number;
  z: number;
  yaw: number;
  gait: number;
  speed: number;
  manner: number;
  obsMode: number;
  navMode: number;
  status: TaskPointStatus;
};

export type NavigationTaskPayload = {
  Value: number;
  MapID: number;
  PosX: number;
  PosY: number;
  PosZ: number;
  AngleYaw: number;
  PointInfo: TaskPointType;
  Gait: number;
  Speed: number;
  Manner: number;
  ObsMode: number;
  NavMode: number;
};

export const TASK_POINT_TYPE_META: Record<
  TaskPointType,
  { label: string; shortLabel: string; color: string; glow: string }
> = {
  0: {
    label: "过渡点",
    shortLabel: "Transit",
    color: "#f59e0b",
    glow: "#78350f",
  },
  1: {
    label: "任务点",
    shortLabel: "Task",
    color: "#22d3ee",
    glow: "#164e63",
  },
  3: {
    label: "充电点",
    shortLabel: "Charge",
    color: "#e879f9",
    glow: "#701a75",
  },
};

export const NAVIGATION_GAIT_OPTIONS = [
  { value: 0x3002, label: "平地" },
  { value: 0x3003, label: "楼梯" },
] as const;

export const NAVIGATION_SPEED_OPTIONS = [
  { value: 0, label: "正常" },
  { value: 1, label: "低速" },
  { value: 2, label: "高速" },
] as const;

export const NAVIGATION_MANNER_OPTIONS = [
  { value: 0, label: "前进" },
  { value: 1, label: "倒退" },
] as const;

export const NAVIGATION_OBS_MODE_OPTIONS = [
  { value: 0, label: "开启" },
  { value: 1, label: "关闭" },
] as const;

export const NAVIGATION_MODE_OPTIONS = [
  { value: 0, label: "直线导航" },
  { value: 1, label: "自主导航" },
] as const;
