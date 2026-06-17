import { create } from "zustand";

export type ViewerStatus = "idle" | "loading" | "ready" | "error";

export type SceneBounds = {
  width: number;
  depth: number;
  height: number;
};

export type Vector3State = {
  x: number;
  y: number;
  z: number;
};

export type RobotPose = Vector3State & {
  yaw: number;
};

export type RobotPoseConnectionStatus = "idle" | "loading" | "ready" | "error";

type ViewerStore = {
  pointSize: number;
  showGrid: boolean;
  showAxes: boolean;
  darkBackground: boolean;
  pointCount: number;
  fileName: string;
  status: ViewerStatus;
  errorMessage: string;
  bounds: SceneBounds;
  mapOrigin: Vector3State;
  mapMin: Vector3State;
  mapMax: Vector3State;
  robotPose: RobotPose | null;
  robotConnectionStatus: RobotPoseConnectionStatus;
  robotLocationState: number | null;
  robotErrorMessage: string;
  robotPoseTime: string;
  setPointSize: (value: number) => void;
  toggleGrid: () => void;
  toggleAxes: () => void;
  toggleBackground: () => void;
  setStatus: (status: ViewerStatus, errorMessage?: string) => void;
  setSceneInfo: (
    pointCount: number,
    fileName: string,
    bounds: SceneBounds,
    mapOrigin: Vector3State,
    mapMin: Vector3State,
    mapMax: Vector3State,
  ) => void;
  setRobotPose: (robotPose: RobotPose | null) => void;
  setRobotConnectionState: (
    status: RobotPoseConnectionStatus,
    locationState?: number | null,
    errorMessage?: string,
    robotPoseTime?: string,
  ) => void;
};

export const defaultBounds: SceneBounds = {
  width: 0,
  depth: 0,
  height: 0,
};

export const defaultVector3: Vector3State = {
  x: 0,
  y: 0,
  z: 0,
};

export const useViewerStore = create<ViewerStore>((set) => ({
  pointSize: 0.025,
  showGrid: true,
  showAxes: true,
  darkBackground: true,
  pointCount: 0,
  fileName: "full_cloud.pcd",
  status: "idle",
  errorMessage: "",
  bounds: defaultBounds,
  mapOrigin: defaultVector3,
  mapMin: defaultVector3,
  mapMax: defaultVector3,
  robotPose: null,
  robotConnectionStatus: "idle",
  robotLocationState: null,
  robotErrorMessage: "",
  robotPoseTime: "",
  setPointSize: (value) => set({ pointSize: value }),
  toggleGrid: () => set((state) => ({ showGrid: !state.showGrid })),
  toggleAxes: () => set((state) => ({ showAxes: !state.showAxes })),
  toggleBackground: () => set((state) => ({ darkBackground: !state.darkBackground })),
  setStatus: (status, errorMessage = "") => set({ status, errorMessage }),
  setSceneInfo: (pointCount, fileName, bounds, mapOrigin, mapMin, mapMax) =>
    set({ pointCount, fileName, bounds, mapOrigin, mapMin, mapMax }),
  setRobotPose: (robotPose) => set({ robotPose }),
  setRobotConnectionState: (status, locationState = null, errorMessage = "", robotPoseTime = "") =>
    set({ robotConnectionStatus: status, robotLocationState: locationState, robotErrorMessage: errorMessage, robotPoseTime }),
}));
