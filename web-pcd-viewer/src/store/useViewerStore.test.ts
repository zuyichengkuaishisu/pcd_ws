import { beforeEach, describe, expect, it } from "vitest";

import { defaultBounds, defaultVector3, useViewerStore } from "@/store/useViewerStore";

describe("useViewerStore", () => {
  beforeEach(() => {
    useViewerStore.setState({
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
      primaryRobotId: "robot-1",
    });
  });

  it("updates scene info and toggles helpers", () => {
    useViewerStore.getState().setSceneInfo(1200, "demo.pcd", {
      width: 10,
      depth: 20,
      height: 5,
    }, { x: 0, y: 0, z: 0 }, { x: -2, y: -3, z: -1 }, { x: 8, y: 17, z: 4 });
    useViewerStore.getState().toggleGrid();
    useViewerStore.getState().toggleAxes();

    const state = useViewerStore.getState();
    expect(state.pointCount).toBe(1200);
    expect(state.fileName).toBe("demo.pcd");
    expect(state.bounds.width).toBe(10);
    expect(state.mapMin.y).toBe(-3);
    expect(state.mapMax.z).toBe(4);
    expect(state.showGrid).toBe(false);
    expect(state.showAxes).toBe(false);
  });

  it("stores status and error message", () => {
    useViewerStore.getState().setStatus("error", "load failed");
    const state = useViewerStore.getState();
    expect(state.status).toBe("error");
    expect(state.errorMessage).toBe("load failed");
  });

  it("stores robot pose for later localization integration", () => {
    useViewerStore.getState().setRobotPose({ x: 1, y: 2, z: 0.1, yaw: 0.3 });
    expect(useViewerStore.getState().robotPose?.yaw).toBe(0.3);
  });

  it("stores robot connection state", () => {
    useViewerStore.getState().setRobotConnectionState("ready", 0, "", "2026-06-16 16:34:23.334");
    const state = useViewerStore.getState();
    expect(state.robotConnectionStatus).toBe("ready");
    expect(state.robotLocationState).toBe(0);
    expect(state.robotPoseTime).toBe("2026-06-16 16:34:23.334");
  });

  it("stores multi-robot states and switches primary robot", () => {
    useViewerStore.getState().setRobotStates([
      {
        id: "robot-a",
        name: "Robot A",
        pose: { x: 1, y: 2, z: 0.1, yaw: 0.3 },
        locationState: 0,
        connectionStatus: "ready",
        errorMessage: "",
        poseTime: "2026-06-17 10:00:00",
        color: "#22c55e",
      },
      {
        id: "robot-b",
        name: "Robot B",
        pose: { x: 5, y: 6, z: 0.1, yaw: 0.8 },
        locationState: 0,
        connectionStatus: "ready",
        errorMessage: "",
        poseTime: "2026-06-17 10:00:01",
        color: "#38bdf8",
      },
    ]);

    expect(useViewerStore.getState().primaryRobotId).toBe("robot-a");
    expect(useViewerStore.getState().robotPose?.x).toBe(1);

    useViewerStore.getState().setPrimaryRobot("robot-b");
    expect(useViewerStore.getState().primaryRobotId).toBe("robot-b");
    expect(useViewerStore.getState().robotPose?.x).toBe(5);
  });
});
