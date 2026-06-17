import { useEffect } from "react";

import { useViewerStore } from "@/store/useViewerStore";

type RobotPoseApiResponse = {
  ok: boolean;
  location?: number;
  pose?: {
    x: number;
    y: number;
    z: number;
    yaw: number;
  };
  timestamp?: string;
  error?: string;
};

export function useRobotPosePolling(intervalMs = 2000) {
  const setRobotPose = useViewerStore((state) => state.setRobotPose);
  const setRobotConnectionState = useViewerStore((state) => state.setRobotConnectionState);

  useEffect(() => {
    let disposed = false;
    let timer: number | null = null;

    const loadPose = async () => {
      setRobotConnectionState("loading");

      try {
        const response = await fetch("/api/robot/pose", {
          method: "GET",
          headers: {
            Accept: "application/json",
          },
        });

        const result = (await response.json()) as RobotPoseApiResponse;
        if (!response.ok || !result.ok || !result.pose) {
          throw new Error(result.error || `机器人位姿请求失败: HTTP ${response.status}`);
        }

        if (disposed) {
          return;
        }

        setRobotPose({
          x: result.pose.x,
          y: result.pose.y,
          z: result.pose.z,
          yaw: result.pose.yaw,
        });
        setRobotConnectionState("ready", result.location ?? null, "", result.timestamp ?? "");
      } catch (error) {
        if (disposed) {
          return;
        }
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
