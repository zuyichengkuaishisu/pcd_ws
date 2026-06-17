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

export type RobotState = {
  id: string;
  name: string;
  pose: RobotPose | null;
  locationState: number | null;
  connectionStatus: RobotPoseConnectionStatus;
  errorMessage: string;
  poseTime: string;
  color?: string;
};

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
  robots: RobotState[];
  primaryRobotId: string;
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
  setRobotStates: (robots: RobotState[]) => void;
  setPrimaryRobot: (robotId: string) => void;
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

const DEFAULT_PRIMARY_ROBOT_ID = "robot-1";

function pickPrimaryRobot(robots: RobotState[], primaryRobotId: string) {
  return robots.find((robot) => robot.id === primaryRobotId) ?? robots[0] ?? null;
}

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
  robots: [],
  primaryRobotId: DEFAULT_PRIMARY_ROBOT_ID,
  setPointSize: (value) => set({ pointSize: value }),
  toggleGrid: () => set((state) => ({ showGrid: !state.showGrid })),
  toggleAxes: () => set((state) => ({ showAxes: !state.showAxes })),
  toggleBackground: () => set((state) => ({ darkBackground: !state.darkBackground })),
  setStatus: (status, errorMessage = "") => set({ status, errorMessage }),
  setSceneInfo: (pointCount, fileName, bounds, mapOrigin, mapMin, mapMax) =>
    set({ pointCount, fileName, bounds, mapOrigin, mapMin, mapMax }),
  setRobotPose: (robotPose) =>
    set((state) => {
      const primaryRobotId = state.primaryRobotId || DEFAULT_PRIMARY_ROBOT_ID;
      const robots = state.robots.length
        ? state.robots.map((robot) => (robot.id === primaryRobotId ? { ...robot, pose: robotPose } : robot))
        : [
            {
              id: primaryRobotId,
              name: "Robot 1",
              pose: robotPose,
              locationState: state.robotLocationState,
              connectionStatus: state.robotConnectionStatus,
              errorMessage: state.robotErrorMessage,
              poseTime: state.robotPoseTime,
            },
          ];
      return { robotPose, robots };
    }),
  setRobotConnectionState: (status, locationState = null, errorMessage = "", robotPoseTime = "") =>
    set((state) => {
      const primaryRobotId = state.primaryRobotId || DEFAULT_PRIMARY_ROBOT_ID;
      const robots = state.robots.length
        ? state.robots.map((robot) =>
            robot.id === primaryRobotId
              ? {
                  ...robot,
                  connectionStatus: status,
                  locationState,
                  errorMessage,
                  poseTime: robotPoseTime,
                }
              : robot,
          )
        : [
            {
              id: primaryRobotId,
              name: "Robot 1",
              pose: state.robotPose,
              locationState,
              connectionStatus: status,
              errorMessage,
              poseTime: robotPoseTime,
            },
          ];
      return {
        robotConnectionStatus: status,
        robotLocationState: locationState,
        robotErrorMessage: errorMessage,
        robotPoseTime,
        robots,
      };
    }),
  setRobotStates: (robots) =>
    set((state) => {
      const nextPrimaryRobotId = robots.some((robot) => robot.id === state.primaryRobotId)
        ? state.primaryRobotId
        : robots[0]?.id ?? DEFAULT_PRIMARY_ROBOT_ID;
      const primaryRobot = pickPrimaryRobot(robots, nextPrimaryRobotId);
      return {
        robots,
        primaryRobotId: nextPrimaryRobotId,
        robotPose: primaryRobot?.pose ?? null,
        robotConnectionStatus: primaryRobot?.connectionStatus ?? "idle",
        robotLocationState: primaryRobot?.locationState ?? null,
        robotErrorMessage: primaryRobot?.errorMessage ?? "",
        robotPoseTime: primaryRobot?.poseTime ?? "",
      };
    }),
  setPrimaryRobot: (robotId) =>
    set((state) => {
      const primaryRobot = pickPrimaryRobot(state.robots, robotId);
      return {
        primaryRobotId: primaryRobot?.id ?? robotId,
        robotPose: primaryRobot?.pose ?? null,
        robotConnectionStatus: primaryRobot?.connectionStatus ?? "idle",
        robotLocationState: primaryRobot?.locationState ?? null,
        robotErrorMessage: primaryRobot?.errorMessage ?? "",
        robotPoseTime: primaryRobot?.poseTime ?? "",
      };
    }),
}));
