import { useEffect } from "react";

import { useViewerStore } from "@/store/useViewerStore";

type RobotPoseApiResponse = {
  ok: boolean;
  robots?: Array<{
    id: string;
    name: string;
    color?: string;
    connectionStatus: "idle" | "loading" | "ready" | "error";
    location?: number;
    pose?: {
      x: number;
      y: number;
      z: number;
      yaw: number;
    };
    timestamp?: string;
    error?: string;
  }>;
  error?: string;
};

export function useRobotPosePolling(intervalMs = 2000) {
  const setRobotConnectionState = useViewerStore((state) => state.setRobotConnectionState);
  const setRobotStates = useViewerStore((state) => state.setRobotStates);
  const setRobotPose = useViewerStore((state) => state.setRobotPose);

  useEffect(() => {
    let disposed = false;
    let timer: number | null = null;

    const loadPose = async () => {
      setRobotConnectionState("loading");

      try {
        const response = await fetch("/api/robots/poses", {
          method: "GET",
          headers: {
            Accept: "application/json",
          },
        });

        const result = (await response.json()) as RobotPoseApiResponse;
        if (!response.ok || !result.ok || !Array.isArray(result.robots)) {
          throw new Error(result.error || `机器人位姿请求失败: HTTP ${response.status}`);
        }

        if (disposed) {
          return;
        }

        const robots = result.robots.map((robot) => ({
          id: robot.id,
          name: robot.name,
          color: robot.color,
          pose: robot.pose
            ? {
                x: robot.pose.x,
                y: robot.pose.y,
                z: robot.pose.z,
                yaw: robot.pose.yaw,
              }
            : null,
          locationState: robot.location ?? null,
          connectionStatus: robot.connectionStatus,
          errorMessage: robot.error ?? "",
          poseTime: robot.timestamp ?? "",
        }));

        setRobotStates(robots);
      } catch (error) {
        if (disposed) {
          return;
        }
        setRobotStates([]);
        setRobotPose(null);
        setRobotConnectionState("error", null, error instanceof Error ? error.message : "机器人位姿请求失败");
      } finally {
        if (!disposed) {
          timer = window.setTimeout(loadPose, intervalMs);
        }
      }
    };

    loadPose();

    return () => {
      disposed = true;
      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, [intervalMs, setRobotConnectionState, setRobotPose]);
}
