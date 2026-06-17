import { useCallback, useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { PCDLoader } from "three/examples/jsm/loaders/PCDLoader.js";

import type { RobotPose, SceneBounds, ViewerStatus } from "@/store/useViewerStore";
import { TASK_POINT_TYPE_META, type TaskPoint } from "@/types/navigation";

const ROBOT_YAW_OFFSET = -Math.PI / 2;

type UsePcdSceneOptions = {
  fileUrl: string;
  pointSize: number;
  pointShape: "round" | "square";
  showGrid: boolean;
  showAxes: boolean;
  darkBackground: boolean;
  showOccGrid: boolean;
  robotPose: RobotPose | null;
  taskPoints: TaskPoint[];
  taskEditorEnabled: boolean;
  mapPlaneZ: number;
  onAddTaskPoint: (point: { x: number; y: number; z: number; yaw: number }) => void;
  onStatus: (status: ViewerStatus, errorMessage?: string) => void;
  onSceneReady: (
    pointCount: number,
    fileName: string,
    bounds: SceneBounds,
    mapOrigin: { x: number; y: number; z: number },
    mapMin: { x: number; y: number; z: number },
    mapMax: { x: number; y: number; z: number },
  ) => void;
};

type CameraPose = {
  position: THREE.Vector3;
  target: THREE.Vector3;
  up: THREE.Vector3;
};

type DraftTaskPointerState = {
  pointerId: number;
  origin: THREE.Vector3;
  current: THREE.Vector3;
  startClientX: number;
  startClientY: number;
  hasDirection: boolean;
};

type UsePcdSceneResult = {
  containerRef: React.RefObject<HTMLDivElement>;
  resetView: () => void;
  setTopView: () => void;
};

export function usePcdScene({
  fileUrl,
  pointSize,
  pointShape,
  showGrid,
  showAxes,
  darkBackground,
  showOccGrid,
  robotPose,
  taskPoints,
  taskEditorEnabled,
  mapPlaneZ,
  onAddTaskPoint,
  onStatus,
  onSceneReady,
}: UsePcdSceneOptions): UsePcdSceneResult {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const frameRef = useRef<number | null>(null);
  const gridRef = useRef<THREE.GridHelper | null>(null);
  const axesRef = useRef<THREE.AxesHelper | null>(null);
  const pointsRef = useRef<THREE.Points | null>(null);
  const occGridMeshRef = useRef<THREE.Mesh | null>(null);
  const robotMarkerRef = useRef<THREE.Group | null>(null);
  const taskPointGroupRef = useRef<THREE.Group | null>(null);
  const taskLineRef = useRef<THREE.Line | null>(null);
  const draftTaskMarkerRef = useRef<THREE.Group | null>(null);
  const draftTaskLineRef = useRef<THREE.Line | null>(null);
  const defaultPoseRef = useRef<CameraPose | null>(null);
  const topPoseRef = useRef<CameraPose | null>(null);
  const robotMarkerLiftRef = useRef(0.15);
  const pointSizeRef = useRef(pointSize);
  const pointShapeRef = useRef(pointShape);
  const showGridRef = useRef(showGrid);
  const showAxesRef = useRef(showAxes);
  const showOccGridRef = useRef(showOccGrid);
  const darkBackgroundRef = useRef(darkBackground);
  const robotPoseRef = useRef(robotPose);
  const taskPointsRef = useRef(taskPoints);
  const taskEditorEnabledRef = useRef(taskEditorEnabled);
  const mapPlaneZRef = useRef(mapPlaneZ);
  const addTaskPointRef = useRef(onAddTaskPoint);
  const draftTaskStateRef = useRef<DraftTaskPointerState | null>(null);

  useEffect(() => {
    pointSizeRef.current = pointSize;
  }, [pointSize]);

  useEffect(() => {
    pointShapeRef.current = pointShape;
  }, [pointShape]);

  useEffect(() => {
    showGridRef.current = showGrid;
  }, [showGrid]);

  useEffect(() => {
    showAxesRef.current = showAxes;
  }, [showAxes]);

  useEffect(() => {
    showOccGridRef.current = showOccGrid;
    if (occGridMeshRef.current) {
      occGridMeshRef.current.visible = showOccGrid;
    }
  }, [showOccGrid]);

  useEffect(() => {
    darkBackgroundRef.current = darkBackground;
  }, [darkBackground]);

  useEffect(() => {
    robotPoseRef.current = robotPose;
  }, [robotPose]);

  useEffect(() => {
    taskPointsRef.current = taskPoints;
  }, [taskPoints]);

  useEffect(() => {
    taskEditorEnabledRef.current = taskEditorEnabled;
  }, [taskEditorEnabled]);

  useEffect(() => {
    mapPlaneZRef.current = mapPlaneZ;
  }, [mapPlaneZ]);

  useEffect(() => {
    addTaskPointRef.current = onAddTaskPoint;
  }, [onAddTaskPoint]);

  const applyPose = useCallback((pose: CameraPose | null) => {
    if (!pose || !cameraRef.current || !controlsRef.current) {
      return;
    }

    cameraRef.current.position.copy(pose.position);
    cameraRef.current.up.copy(pose.up);
    controlsRef.current.target.copy(pose.target);
    controlsRef.current.update();
  }, []);

  const resetView = useCallback(() => {
    applyPose(defaultPoseRef.current);
  }, [applyPose]);

  const setTopView = useCallback(() => {
    applyPose(topPoseRef.current);
  }, [applyPose]);

  useEffect(() => {
    if (!robotMarkerRef.current) {
      return;
    }

    if (robotPose) {
      robotMarkerRef.current.visible = true;
      robotMarkerRef.current.position.set(robotPose.x, robotPose.y, robotPose.z + robotMarkerLiftRef.current);
      robotMarkerRef.current.rotation.z = robotPose.yaw + ROBOT_YAW_OFFSET;
    } else {
      robotMarkerRef.current.visible = false;
    }
  }, [robotPose]);

  useEffect(() => {
    if (!rendererRef.current || !sceneRef.current) {
      return;
    }

    rendererRef.current.setClearColor(darkBackground ? "#020817" : "#e2e8f0");
    sceneRef.current.fog = new THREE.Fog(darkBackground ? "#020817" : "#e2e8f0", 90, 280);

    if (pointsRef.current) {
      const material = pointsRef.current.material as THREE.PointsMaterial;
      material.color = new THREE.Color(darkBackground ? "#a5f3fc" : "#0369a1");
      material.needsUpdate = true;
    }

  }, [darkBackground]);

  useEffect(() => {
    if (pointsRef.current) {
      const material = pointsRef.current.material as THREE.PointsMaterial;
      material.size = pointSize;
      applyPointShape(material, pointShapeRef.current);
      material.needsUpdate = true;
    }
  }, [pointShape, pointSize]);

  useEffect(() => {
    if (gridRef.current) {
      gridRef.current.visible = showGrid;
    }
  }, [showGrid]);

  useEffect(() => {
    if (axesRef.current) {
      axesRef.current.visible = showAxes;
    }
  }, [showAxes]);

  useEffect(() => {
    if (controlsRef.current) {
      controlsRef.current.enabled = !taskEditorEnabled;
    }

    if (!taskEditorEnabled) {
      draftTaskStateRef.current = null;
      if (draftTaskMarkerRef.current) {
        draftTaskMarkerRef.current.visible = false;
      }
      if (draftTaskLineRef.current) {
        draftTaskLineRef.current.visible = false;
      }
    }
  }, [taskEditorEnabled]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) {
      return;
    }

    if (taskLineRef.current) {
      scene.remove(taskLineRef.current);
      taskLineRef.current.geometry.dispose();
      (taskLineRef.current.material as THREE.Material).dispose();
      taskLineRef.current = null;
    }

    if (taskPointGroupRef.current) {
      scene.remove(taskPointGroupRef.current);
      taskPointGroupRef.current.traverse((object: THREE.Object3D) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          const material = object.material;
          if (Array.isArray(material)) {
            material.forEach((item) => item.dispose());
          } else {
            material.dispose();
          }
        }
      });
      taskPointGroupRef.current = null;
    }

    const pointGroup = new THREE.Group();
    const markerRadius = Math.max(Math.min(Math.max(boundsLength(scene) * 0.0028, 0.06), 0.22), 0.06);

    taskPoints.forEach((point) => {
      const { color, glow } = TASK_POINT_TYPE_META[point.type];
      const marker = createTaskMarker(markerRadius, color, glow);
      marker.position.set(point.x, point.y, point.z + markerRadius * 0.65);
      marker.rotation.z = point.yaw + ROBOT_YAW_OFFSET;
      pointGroup.add(marker);
    });

    taskPointGroupRef.current = pointGroup;
    scene.add(pointGroup);

    if (taskPoints.length >= 2) {
      const positions = taskPoints.flatMap((point) => [point.x, point.y, point.z + markerRadius * 0.35]);
      const lineGeometry = new THREE.BufferGeometry();
      lineGeometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      const lineMaterial = new THREE.LineBasicMaterial({
        color: darkBackground ? 0xe2e8f0 : 0x0f172a,
        transparent: true,
        opacity: 0.78,
      });
      const line = new THREE.Line(lineGeometry, lineMaterial);
      taskLineRef.current = line;
      scene.add(line);
    }
  }, [darkBackground, taskPoints]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 4000);
    camera.position.set(10, -10, 8);
    camera.up.set(0, 0, 1);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(darkBackgroundRef.current ? "#020817" : "#e2e8f0");
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.screenSpacePanning = true;
    controls.maxDistance = 3000;
    controls.enabled = !taskEditorEnabledRef.current;
    controlsRef.current = controls;

    const ambientLight = new THREE.AmbientLight(0xffffff, 1.3);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0x8bd3ff, 0.8);
    directionalLight.position.set(10, -8, 12);
    scene.add(directionalLight);

    void loadOccGridOverlay(scene, mapPlaneZRef.current, showOccGridRef.current).then((mesh) => {
      occGridMeshRef.current = mesh;
    });

    const grid = new THREE.GridHelper(120, 24, 0x5eead4, 0x1e293b);
    grid.rotation.x = Math.PI / 2;
    grid.material.opacity = 0.22;
    grid.material.transparent = true;
    grid.visible = showGridRef.current;
    scene.add(grid);
    gridRef.current = grid;

    const axes = new THREE.AxesHelper(12);
    axes.visible = showAxesRef.current;
    scene.add(axes);
    axesRef.current = axes;

    const resize = () => {
      const width = container.clientWidth || 1;
      const height = container.clientHeight || 1;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);

    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -mapPlaneZRef.current);
    const getPlanePoint = (clientX: number, clientY: number) => {
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);
      plane.constant = -mapPlaneZRef.current;
      return raycaster.ray.intersectPlane(plane, new THREE.Vector3());
    };

    const hideDraftTaskPreview = () => {
      if (draftTaskMarkerRef.current) {
        draftTaskMarkerRef.current.visible = false;
      }
      if (draftTaskLineRef.current) {
        draftTaskLineRef.current.visible = false;
      }
    };

    const updateDraftTaskPreview = (origin: THREE.Vector3, current: THREE.Vector3, yaw: number, showDirection: boolean) => {
      const previewRadius = Math.max(Math.min(boundsLength(scene) * 0.0028, 0.22), 0.06);

      if (!draftTaskMarkerRef.current) {
        draftTaskMarkerRef.current = createTaskMarker(previewRadius, "#f8fafc", darkBackgroundRef.current ? "#0f172a" : "#94a3b8");
        scene.add(draftTaskMarkerRef.current);
      }
      if (!draftTaskLineRef.current) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3));
        draftTaskLineRef.current = new THREE.Line(
          geometry,
          new THREE.LineBasicMaterial({
            color: darkBackgroundRef.current ? 0xf8fafc : 0x0f172a,
            transparent: true,
            opacity: 0.88,
          }),
        );
        scene.add(draftTaskLineRef.current);
      }

      draftTaskMarkerRef.current.position.set(origin.x, origin.y, origin.z + previewRadius * 0.65);
      draftTaskMarkerRef.current.rotation.z = yaw + ROBOT_YAW_OFFSET;
      draftTaskMarkerRef.current.visible = true;

      if (showDirection) {
        setLinePositions(
          draftTaskLineRef.current.geometry as THREE.BufferGeometry,
          [origin.x, origin.y, origin.z + previewRadius * 0.35, current.x, current.y, current.z + previewRadius * 0.35],
        );
        draftTaskLineRef.current.visible = true;
      } else {
        draftTaskLineRef.current.visible = false;
      }
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (!taskEditorEnabledRef.current) {
        return;
      }

      if (event.button !== 0) {
        return;
      }

      const target = getPlanePoint(event.clientX, event.clientY);
      if (!target) {
        return;
      }

      event.preventDefault();
      draftTaskStateRef.current = {
        pointerId: event.pointerId,
        origin: target.clone(),
        current: target.clone(),
        startClientX: event.clientX,
        startClientY: event.clientY,
        hasDirection: false,
      };
      renderer.domElement.setPointerCapture(event.pointerId);
      updateDraftTaskPreview(target, target, taskPointsRef.current.at(-1)?.yaw ?? robotPoseRef.current?.yaw ?? 0, false);
    };

    const handlePointerMove = (event: PointerEvent) => {
      const draftState = draftTaskStateRef.current;
      if (!draftState || draftState.pointerId !== event.pointerId) {
        return;
      }

      const target = getPlanePoint(event.clientX, event.clientY);
      if (!target) {
        return;
      }

      draftState.current.copy(target);
      draftState.hasDirection =
        Math.hypot(event.clientX - draftState.startClientX, event.clientY - draftState.startClientY) >= 6;

      const yaw = draftState.hasDirection
        ? Math.atan2(target.y - draftState.origin.y, target.x - draftState.origin.x)
        : taskPointsRef.current.at(-1)?.yaw ?? robotPoseRef.current?.yaw ?? 0;

      updateDraftTaskPreview(draftState.origin, target, yaw, draftState.hasDirection);
    };

    const finishDraftTaskPoint = (event: PointerEvent) => {
      const draftState = draftTaskStateRef.current;
      if (!draftState || draftState.pointerId !== event.pointerId) {
        return;
      }

      const target = getPlanePoint(event.clientX, event.clientY) ?? draftState.current.clone();
      const shouldAddPoint = draftState.hasDirection;
      draftTaskStateRef.current = null;
      hideDraftTaskPreview();

      if (renderer.domElement.hasPointerCapture(event.pointerId)) {
        renderer.domElement.releasePointerCapture(event.pointerId);
      }

      if (!shouldAddPoint) {
        return;
      }

      const yaw = Math.atan2(target.y - draftState.origin.y, target.x - draftState.origin.x);
      addTaskPointRef.current({
        x: Number(draftState.origin.x.toFixed(3)),
        y: Number(draftState.origin.y.toFixed(3)),
        z: Number(mapPlaneZRef.current.toFixed(3)),
        yaw: Number(yaw.toFixed(6)),
      });
    };

    renderer.domElement.addEventListener("pointerdown", handlePointerDown);
    renderer.domElement.addEventListener("pointermove", handlePointerMove);
    renderer.domElement.addEventListener("pointerup", finishDraftTaskPoint);
    renderer.domElement.addEventListener("pointercancel", finishDraftTaskPoint);

    onStatus("loading");
    const loader = new PCDLoader();
    loader.load(
      fileUrl,
      (loadedPoints: THREE.Object3D) => {
        if (pointsRef.current) {
          scene.remove(pointsRef.current);
        }

        const points = loadedPoints as THREE.Points;
        const material = points.material as THREE.PointsMaterial;
        material.size = pointSizeRef.current;
        material.sizeAttenuation = true;
        material.color = new THREE.Color(darkBackgroundRef.current ? "#a5f3fc" : "#0369a1");
        material.transparent = true;
        material.opacity = 0.96;
        applyPointShape(material, pointShapeRef.current);

        const position = points.geometry.getAttribute("position");
        points.geometry.computeBoundingBox();
        const box = points.geometry.boundingBox?.clone() ?? new THREE.Box3();
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const min = box.min.clone();
        const max = box.max.clone();

        pointsRef.current = points;
        scene.add(points);

        if (robotMarkerRef.current) {
          scene.remove(robotMarkerRef.current);
        }

        const robotMarkerRadius = Math.max(Math.min(size.length() * 0.0032, 0.28), 0.05);
        robotMarkerLiftRef.current = robotMarkerRadius * 0.9;

        const robotMarker = new THREE.Group();
        const robotDisc = new THREE.Mesh(
          new THREE.CylinderGeometry(robotMarkerRadius * 0.68, robotMarkerRadius * 0.68, robotMarkerRadius * 0.18, 24),
          new THREE.MeshStandardMaterial({
            color: "#22c55e",
            emissive: "#14532d",
            metalness: 0.08,
            roughness: 0.42,
          }),
        );
        const tailWidth = robotMarkerRadius * 0.26;
        const headWidth = robotMarkerRadius * 0.78;
        const tailY = -robotMarkerRadius * 0.92;
        const neckY = robotMarkerRadius * 0.08;
        const tipY = robotMarkerRadius * 1.02;
        const arrowShape = new THREE.Shape([
          new THREE.Vector2(0, tipY),
          new THREE.Vector2(headWidth, neckY),
          new THREE.Vector2(tailWidth, neckY),
          new THREE.Vector2(tailWidth, tailY),
          new THREE.Vector2(-tailWidth, tailY),
          new THREE.Vector2(-tailWidth, neckY),
          new THREE.Vector2(-headWidth, neckY),
        ]);
        const robotArrow = new THREE.Mesh(
          new THREE.ShapeGeometry(arrowShape),
          new THREE.MeshStandardMaterial({
            color: "#86efac",
            emissive: "#166534",
            metalness: 0.02,
            roughness: 0.52,
            side: THREE.DoubleSide,
          }),
        );
        robotDisc.position.z = robotMarkerRadius * 0.08;
        robotArrow.position.z = robotMarkerRadius * 0.22;
        robotMarker.add(robotDisc);
        robotMarker.add(robotArrow);
        robotMarker.visible = false;
        scene.add(robotMarker);
        robotMarkerRef.current = robotMarker;

        const radius = Math.max(size.length() * 0.45, 12);
        defaultPoseRef.current = {
          position: new THREE.Vector3(center.x + radius, center.y - radius, center.z + radius * 0.72),
          target: center.clone(),
          up: new THREE.Vector3(0, 0, 1),
        };
        topPoseRef.current = {
          position: new THREE.Vector3(center.x, center.y, center.z + Math.max(size.z, radius) * 1.8),
          target: center.clone(),
          up: new THREE.Vector3(0, 1, 0),
        };
        resetView();

        if (robotPoseRef.current) {
          robotMarker.position.set(
            robotPoseRef.current.x,
            robotPoseRef.current.y,
            robotPoseRef.current.z + robotMarkerLiftRef.current,
          );
          robotMarker.rotation.z = robotPoseRef.current.yaw + ROBOT_YAW_OFFSET;
          robotMarker.visible = true;
        }

        const bounds = {
          width: size.x,
          depth: size.y,
          height: size.z,
        };
        onSceneReady(
          position.count,
          fileUrl.split("/").pop() ?? "full_cloud.pcd",
          bounds,
          { x: 0, y: 0, z: 0 },
          { x: min.x, y: min.y, z: min.z },
          { x: max.x, y: max.y, z: max.z },
        );
        onStatus("ready");
      },
      undefined,
      (error: unknown) => {
        const message = error instanceof Error ? error.message : "点云文件加载失败";
        onStatus("error", message);
      },
    );

    const animate = () => {
      controls.update();
      renderer.render(scene, camera);
      frameRef.current = window.requestAnimationFrame(animate);
    };
    animate();

    return () => {
      observer.disconnect();
      renderer.domElement.removeEventListener("pointerdown", handlePointerDown);
      renderer.domElement.removeEventListener("pointermove", handlePointerMove);
      renderer.domElement.removeEventListener("pointerup", finishDraftTaskPoint);
      renderer.domElement.removeEventListener("pointercancel", finishDraftTaskPoint);
      if (occGridMeshRef.current) {
        scene.remove(occGridMeshRef.current);
        occGridMeshRef.current.geometry.dispose();
        const material = occGridMeshRef.current.material;
        if (material instanceof THREE.Material) {
          if ("map" in material && material.map) {
            material.map.dispose();
          }
          material.dispose();
        }
        occGridMeshRef.current = null;
      }
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
      }
      controls.dispose();
      renderer.dispose();
      scene.clear();
      container.removeChild(renderer.domElement);
    };
  }, [fileUrl, onSceneReady, onStatus, resetView]);

  return {
    containerRef,
    resetView,
    setTopView,
  };
}

async function loadOccGridOverlay(scene: THREE.Scene, planeZ: number, visible: boolean) {
  const metaResponse = await fetch("/api/map/occ-grid/meta", {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  });
  const metaResult = (await metaResponse.json()) as {
    ok: boolean;
    width?: number;
    height?: number;
    resolution?: number;
    origin?: { x: number; y: number; yaw: number };
    error?: string;
  };
  if (!metaResponse.ok || !metaResult.ok || !metaResult.width || !metaResult.height || !metaResult.resolution || !metaResult.origin) {
    return null;
  }

  const imageResponse = await fetch("/api/map/occ-grid/image");
  if (!imageResponse.ok) {
    return null;
  }
  const imageBuffer = await imageResponse.arrayBuffer();
  const textureCanvas = decodePgmToCanvas(new Uint8Array(imageBuffer), metaResult.width, metaResult.height);
  const texture = new THREE.CanvasTexture(textureCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = false;
  texture.needsUpdate = true;

  const planeWidth = metaResult.width * metaResult.resolution;
  const planeHeight = metaResult.height * metaResult.resolution;
  const geometry = new THREE.PlaneGeometry(planeWidth, planeHeight);
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    opacity: 0.72,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  const centerOffset = new THREE.Vector3(planeWidth / 2, planeHeight / 2, 0).applyAxisAngle(
    new THREE.Vector3(0, 0, 1),
    metaResult.origin.yaw,
  );
  mesh.position.set(
    metaResult.origin.x + centerOffset.x,
    metaResult.origin.y + centerOffset.y,
    planeZ - 0.03,
  );
  mesh.rotation.z = metaResult.origin.yaw;
  mesh.visible = visible;
  scene.add(mesh);
  return mesh;
}

function boundsLength(scene: THREE.Scene) {
  const box = new THREE.Box3().setFromObject(scene);
  const size = box.getSize(new THREE.Vector3());
  return Math.max(size.length(), 1);
}

function createTaskMarker(
  radius: number,
  color: THREE.ColorRepresentation,
  glow: THREE.ColorRepresentation,
) {
  const marker = new THREE.Group();
  const disc = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, radius * 0.24, 20),
    new THREE.MeshStandardMaterial({
      color,
      emissive: glow,
      metalness: 0.08,
      roughness: 0.4,
    }),
  );
  const arrowShape = new THREE.Shape([
    new THREE.Vector2(0, radius * 1.15),
    new THREE.Vector2(radius * 0.72, radius * 0.1),
    new THREE.Vector2(radius * 0.24, radius * 0.1),
    new THREE.Vector2(radius * 0.24, -radius * 0.95),
    new THREE.Vector2(-radius * 0.24, -radius * 0.95),
    new THREE.Vector2(-radius * 0.24, radius * 0.1),
    new THREE.Vector2(-radius * 0.72, radius * 0.1),
  ]);
  const arrow = new THREE.Mesh(
    new THREE.ShapeGeometry(arrowShape),
    new THREE.MeshStandardMaterial({
      color,
      emissive: glow,
      metalness: 0.02,
      roughness: 0.5,
      side: THREE.DoubleSide,
    }),
  );
  disc.position.z = radius * 0.08;
  arrow.position.z = radius * 0.22;
  marker.add(disc);
  marker.add(arrow);
  return marker;
}

function setLinePositions(geometry: THREE.BufferGeometry, positions: number[]) {
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeBoundingSphere();
}

function applyPointShape(material: THREE.PointsMaterial, pointShape: "round" | "square") {
  material.map = null;
  material.alphaTest = 0;

  if (pointShape === "square") {
    material.needsUpdate = true;
    return;
  }

  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) {
    material.needsUpdate = true;
    return;
  }

  context.clearRect(0, 0, size, size);
  context.fillStyle = "#ffffff";
  context.beginPath();
  context.arc(size / 2, size / 2, size * 0.32, 0, Math.PI * 2);
  context.fill();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  material.map = texture;
  material.alphaTest = 0.45;
  material.needsUpdate = true;
}

function decodePgmToCanvas(buffer: Uint8Array, width: number, height: number) {
  let index = 0;
  let tokenCount = 0;

  while (tokenCount < 4 && index < buffer.length) {
    const byte = buffer[index];
    if (byte === 35) {
      while (index < buffer.length && buffer[index] !== 10) {
        index += 1;
      }
      index += 1;
      continue;
    }
    if (byte <= 32) {
      index += 1;
      continue;
    }

    while (index < buffer.length && buffer[index] > 32) {
      index += 1;
    }
    tokenCount += 1;
  }

  while (index < buffer.length && buffer[index] <= 32) {
    index += 1;
  }

  const pixels = buffer.subarray(index, index + width * height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    return canvas;
  }

  const imageData = context.createImageData(width, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sourceIndex = (height - 1 - y) * width + x;
      const pixel = pixels[sourceIndex] ?? 205;
      const targetIndex = (y * width + x) * 4;
      imageData.data[targetIndex] = pixel;
      imageData.data[targetIndex + 1] = pixel;
      imageData.data[targetIndex + 2] = pixel;
      imageData.data[targetIndex + 3] = pixel === 205 ? 0 : 190;
    }
  }
  context.putImageData(imageData, 0, 0);
  return canvas;
}
