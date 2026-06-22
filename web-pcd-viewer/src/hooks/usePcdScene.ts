import { useCallback, useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { PCDLoader } from "three/examples/jsm/loaders/PCDLoader.js";

import type { RobotPose, SceneBounds, ViewerStatus } from "@/store/useViewerStore";
import { TASK_POINT_TYPE_META, type TaskPoint } from "@/types/navigation";
import { downsamplePointCloudData, type PerformanceProfile } from "@/utils/performance";

const ROBOT_YAW_OFFSET = -Math.PI / 2;

type UsePcdSceneOptions = {
  fileUrl: string;
  occGridAssetId: string | null;
  performanceProfile: PerformanceProfile;
  keyboardCameraEnabled: boolean;
  pointSize: number;
  pointShape: "round" | "square";
  showGrid: boolean;
  showAxes: boolean;
  darkBackground: boolean;
  showOccGrid: boolean;
  robotPose: RobotPose | null;
  floorSegmentationEnabled: boolean;
  floorSegmentationPreviewRange: { minZ: number; maxZ: number } | null;
  floorSegmentationAppliedRange: { minZ: number; maxZ: number } | null;
  taskPoints: TaskPoint[];
  taskEditorEnabled: boolean;
  initialPoseEditorEnabled: boolean;
  initialPoseSelection: { x: number; y: number; yaw: number } | null;
  mapPlaneZ: number;
  onAddTaskPoint: (point: { x: number; y: number; z: number; yaw: number }) => void;
  onSetInitialPose: (point: { x: number; y: number; yaw: number }) => void;
  onFloorSegmentationPointCountChange?: (pointCount: number) => void;
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
  setFrontView: () => void;
};

export function usePcdScene({
  fileUrl,
  occGridAssetId,
  performanceProfile,
  keyboardCameraEnabled,
  pointSize,
  pointShape,
  showGrid,
  showAxes,
  darkBackground,
  showOccGrid,
  robotPose,
  floorSegmentationEnabled,
  floorSegmentationPreviewRange,
  floorSegmentationAppliedRange,
  taskPoints,
  taskEditorEnabled,
  initialPoseEditorEnabled,
  initialPoseSelection,
  mapPlaneZ,
  onAddTaskPoint,
  onSetInitialPose,
  onFloorSegmentationPointCountChange,
  onStatus,
  onSceneReady,
}: UsePcdSceneOptions): UsePcdSceneResult {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const frameRef = useRef<number | null>(null);
  const idleTimerRef = useRef<number | null>(null);
  const gridRef = useRef<THREE.GridHelper | null>(null);
  const axesRef = useRef<THREE.AxesHelper | null>(null);
  const pointsRef = useRef<THREE.Points | null>(null);
  const occGridMeshRef = useRef<THREE.Mesh | null>(null);
  const robotMarkerRef = useRef<THREE.Group | null>(null);
  const floorSegmentationGroupRef = useRef<THREE.Group | null>(null);
  const taskPointGroupRef = useRef<THREE.Group | null>(null);
  const taskLineRef = useRef<THREE.Line | null>(null);
  const draftTaskMarkerRef = useRef<THREE.Group | null>(null);
  const draftTaskLineRef = useRef<THREE.Line | null>(null);
  const initialPoseMarkerRef = useRef<THREE.Group | null>(null);
  const defaultPoseRef = useRef<CameraPose | null>(null);
  const topPoseRef = useRef<CameraPose | null>(null);
  const frontPoseRef = useRef<CameraPose | null>(null);
  const robotMarkerLiftRef = useRef(0.15);
  const floorSegmentationBoundsRef = useRef<THREE.Box3 | null>(null);
  const fullPointDataRef = useRef<{
    position: Float32Array;
    color: Float32Array | null;
  } | null>(null);
  const pointSizeRef = useRef(pointSize);
  const pointShapeRef = useRef(pointShape);
  const keyboardCameraEnabledRef = useRef(keyboardCameraEnabled);
  const showGridRef = useRef(showGrid);
  const showAxesRef = useRef(showAxes);
  const showOccGridRef = useRef(showOccGrid);
  const darkBackgroundRef = useRef(darkBackground);
  const robotPoseRef = useRef(robotPose);
  const taskPointsRef = useRef(taskPoints);
  const floorSegmentationEnabledRef = useRef(floorSegmentationEnabled);
  const floorSegmentationPreviewRangeRef = useRef(floorSegmentationPreviewRange);
  const floorSegmentationAppliedRangeRef = useRef(floorSegmentationAppliedRange);
  const taskEditorEnabledRef = useRef(taskEditorEnabled);
  const initialPoseEditorEnabledRef = useRef(initialPoseEditorEnabled);
  const mapPlaneZRef = useRef(mapPlaneZ);
  const addTaskPointRef = useRef(onAddTaskPoint);
  const setInitialPoseRef = useRef(onSetInitialPose);
  const draftTaskStateRef = useRef<DraftTaskPointerState | null>(null);
  const keysPressedRef = useRef(new Set<string>());
  const interactionUntilRef = useRef(0);
  const renderRequestedRef = useRef(true);

  const requestRender = useCallback((interactionMs = 800) => {
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    interactionUntilRef.current = Math.max(interactionUntilRef.current, now + interactionMs);
    renderRequestedRef.current = true;
  }, []);

  useEffect(() => {
    keyboardCameraEnabledRef.current = keyboardCameraEnabled;
    if (!keyboardCameraEnabled) {
      keysPressedRef.current.clear();
    }
    requestRender();
  }, [keyboardCameraEnabled, requestRender]);

  useEffect(() => {
    pointSizeRef.current = pointSize;
    requestRender();
  }, [pointSize, requestRender]);

  useEffect(() => {
    pointShapeRef.current = pointShape;
    requestRender();
  }, [pointShape, requestRender]);

  useEffect(() => {
    showGridRef.current = showGrid;
    requestRender();
  }, [showGrid, requestRender]);

  useEffect(() => {
    showAxesRef.current = showAxes;
    requestRender();
  }, [showAxes, requestRender]);

  useEffect(() => {
    showOccGridRef.current = showOccGrid;
    if (occGridMeshRef.current) {
      occGridMeshRef.current.visible = showOccGrid;
    }
    requestRender();
  }, [showOccGrid, requestRender]);

  useEffect(() => {
    darkBackgroundRef.current = darkBackground;
    requestRender();
  }, [darkBackground, requestRender]);

  useEffect(() => {
    robotPoseRef.current = robotPose;
    requestRender(1200);
  }, [robotPose, requestRender]);

  useEffect(() => {
    taskPointsRef.current = taskPoints;
    requestRender(1200);
  }, [taskPoints, requestRender]);

  useEffect(() => {
    floorSegmentationEnabledRef.current = floorSegmentationEnabled;
    requestRender();
  }, [floorSegmentationEnabled, requestRender]);

  useEffect(() => {
    floorSegmentationPreviewRangeRef.current = floorSegmentationPreviewRange;
    requestRender();
  }, [floorSegmentationPreviewRange, requestRender]);

  useEffect(() => {
    floorSegmentationAppliedRangeRef.current = floorSegmentationAppliedRange;
    requestRender();
  }, [floorSegmentationAppliedRange, requestRender]);

  useEffect(() => {
    taskEditorEnabledRef.current = taskEditorEnabled;
    requestRender();
  }, [taskEditorEnabled, requestRender]);

  useEffect(() => {
    initialPoseEditorEnabledRef.current = initialPoseEditorEnabled;
    requestRender();
  }, [initialPoseEditorEnabled, requestRender]);

  useEffect(() => {
    mapPlaneZRef.current = mapPlaneZ;
    requestRender();
  }, [mapPlaneZ, requestRender]);

  useEffect(() => {
    addTaskPointRef.current = onAddTaskPoint;
  }, [onAddTaskPoint]);

  useEffect(() => {
    setInitialPoseRef.current = onSetInitialPose;
  }, [onSetInitialPose]);

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

  const setFrontView = useCallback(() => {
    applyPose(frontPoseRef.current);
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
    requestRender();
  }, [pointShape, pointSize, requestRender]);

  useEffect(() => {
    updateFloorSegmentationPreview(
      sceneRef.current,
      floorSegmentationGroupRef.current,
      floorSegmentationBoundsRef.current,
      floorSegmentationEnabled,
      floorSegmentationPreviewRange,
      darkBackground,
    );
    requestRender();
  }, [darkBackground, floorSegmentationEnabled, floorSegmentationPreviewRange, requestRender]);

  useEffect(() => {
    applyFloorSegmentationRange(pointsRef.current, fullPointDataRef.current, floorSegmentationAppliedRange);
    requestRender();
  }, [floorSegmentationAppliedRange, requestRender]);

  useEffect(() => {
    if (!onFloorSegmentationPointCountChange) {
      return;
    }

    const effectiveRange = floorSegmentationEnabled ? floorSegmentationPreviewRange : floorSegmentationAppliedRange;
    onFloorSegmentationPointCountChange(countPointsInRange(fullPointDataRef.current, effectiveRange));
  }, [floorSegmentationAppliedRange, floorSegmentationEnabled, floorSegmentationPreviewRange, onFloorSegmentationPointCountChange]);

  useEffect(() => {
    if (gridRef.current) {
      gridRef.current.visible = showGrid;
    }
    requestRender();
  }, [showGrid, requestRender]);

  useEffect(() => {
    if (axesRef.current) {
      axesRef.current.visible = showAxes;
    }
    requestRender();
  }, [showAxes, requestRender]);

  useEffect(() => {
    if (controlsRef.current) {
      controlsRef.current.enabled = !(taskEditorEnabled || initialPoseEditorEnabled);
    }

    if (!(taskEditorEnabled || initialPoseEditorEnabled)) {
      draftTaskStateRef.current = null;
      if (draftTaskMarkerRef.current) {
        draftTaskMarkerRef.current.visible = false;
      }
      if (draftTaskLineRef.current) {
        draftTaskLineRef.current.visible = false;
      }
    }
    requestRender();
  }, [initialPoseEditorEnabled, taskEditorEnabled, requestRender]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) {
      return;
    }

    if (!initialPoseSelection) {
      if (initialPoseMarkerRef.current) {
        initialPoseMarkerRef.current.visible = false;
      }
      return;
    }

    const markerRadius = Math.max(Math.min(boundsLength(scene) * 0.003, 0.24), 0.07);
    if (!initialPoseMarkerRef.current) {
      initialPoseMarkerRef.current = createTaskMarker(markerRadius, "#f59e0b", darkBackgroundRef.current ? "#78350f" : "#fcd34d");
      scene.add(initialPoseMarkerRef.current);
    }

    initialPoseMarkerRef.current.position.set(
      initialPoseSelection.x,
      initialPoseSelection.y,
      mapPlaneZRef.current + markerRadius * 0.65,
    );
    initialPoseMarkerRef.current.rotation.z = initialPoseSelection.yaw + ROBOT_YAW_OFFSET;
    initialPoseMarkerRef.current.visible = true;
    requestRender();
  }, [fileUrl, initialPoseSelection, requestRender]);

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
    requestRender();
  }, [darkBackground, taskPoints, requestRender]);

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

    const renderer = new THREE.WebGLRenderer({ antialias: performanceProfile.antialias, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, performanceProfile.dprCap));
    renderer.setClearColor(darkBackgroundRef.current ? "#020817" : "#e2e8f0");
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.tabIndex = 0;
    renderer.domElement.style.outline = "none";
    renderer.domElement.setAttribute("aria-label", "PCD 点云画布");
    container.appendChild(renderer.domElement);
    window.setTimeout(() => {
      renderer.domElement.focus();
    }, 0);
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.screenSpacePanning = true;
    controls.maxDistance = 3000;
    controls.enableKeys = false;
    controls.enabled = !(taskEditorEnabledRef.current || initialPoseEditorEnabledRef.current);
    controlsRef.current = controls;

    const ambientLight = new THREE.AmbientLight(0xffffff, 1.3);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0x8bd3ff, 0.8);
    directionalLight.position.set(10, -8, 12);
    scene.add(directionalLight);

    void loadOccGridOverlay(scene, mapPlaneZRef.current, showOccGridRef.current, occGridAssetId).then((mesh) => {
      occGridMeshRef.current = mesh;
      requestRender(1200);
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
      requestRender(1200);
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    controls.addEventListener("change", () => {
      requestRender(1200);
    });

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
      renderer.domElement.focus();

      if (!taskEditorEnabledRef.current && !initialPoseEditorEnabledRef.current) {
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
      requestRender(1200);
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
      requestRender(1200);
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

      if (taskEditorEnabledRef.current) {
        const yaw = Math.atan2(target.y - draftState.origin.y, target.x - draftState.origin.x);
        addTaskPointRef.current({
          x: Number(draftState.origin.x.toFixed(3)),
          y: Number(draftState.origin.y.toFixed(3)),
          z: Number(mapPlaneZRef.current.toFixed(3)),
          yaw: Number(yaw.toFixed(6)),
        });
        return;
      }

      if (initialPoseEditorEnabledRef.current) {
        const yaw = Math.atan2(target.y - draftState.origin.y, target.x - draftState.origin.x);
        setInitialPoseRef.current({
          x: Number(draftState.origin.x.toFixed(3)),
          y: Number(draftState.origin.y.toFixed(3)),
          yaw: Number(yaw.toFixed(6)),
        });
      }
      requestRender(1200);
    };

    renderer.domElement.addEventListener("pointerdown", handlePointerDown);
    renderer.domElement.addEventListener("pointermove", handlePointerMove);
    renderer.domElement.addEventListener("pointerup", finishDraftTaskPoint);
    renderer.domElement.addEventListener("pointercancel", finishDraftTaskPoint);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!keyboardCameraEnabledRef.current) {
        return;
      }
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return;
      }

      if (
        event.key === "ArrowUp" ||
        event.key === "ArrowDown" ||
        event.key === "ArrowLeft" ||
        event.key === "ArrowRight" ||
        event.key === "w" ||
        event.key === "W" ||
        event.key === "a" ||
        event.key === "A" ||
        event.key === "s" ||
        event.key === "S" ||
        event.key === "d" ||
        event.key === "D"
      ) {
        event.preventDefault();
      }

      keysPressedRef.current.add(event.key);
      moveCameraWithKeys(camera, controls, new Set([event.key]), 0.05);
      requestRender(1200);
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (!keyboardCameraEnabledRef.current) {
        return;
      }
      keysPressedRef.current.delete(event.key);
      requestRender(800);
    };

    renderer.domElement.addEventListener("keydown", handleKeyDown);
    renderer.domElement.addEventListener("keyup", handleKeyUp);

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
        const color = points.geometry.getAttribute("color");
        points.geometry.computeBoundingBox();
        const box = points.geometry.boundingBox?.clone() ?? new THREE.Box3();
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const min = box.min.clone();
        const max = box.max.clone();
        const sampledPointData = downsamplePointCloudData(
          {
            position: Float32Array.from(position.array as ArrayLike<number>),
            color: color ? Float32Array.from(color.array as ArrayLike<number>) : null,
          },
          performanceProfile.pointBudget,
        );

        pointsRef.current = points;
        scene.add(points);
        floorSegmentationBoundsRef.current = box.clone();
        fullPointDataRef.current = {
          position: sampledPointData.position,
          color: sampledPointData.color,
        };
        points.geometry.setAttribute("position", new THREE.Float32BufferAttribute(sampledPointData.position, 3));
        if (sampledPointData.color) {
          points.geometry.setAttribute("color", new THREE.Float32BufferAttribute(sampledPointData.color, 3));
        } else {
          points.geometry.deleteAttribute("color");
        }
        applyFloorSegmentationRange(points, fullPointDataRef.current, floorSegmentationAppliedRangeRef.current);
        onFloorSegmentationPointCountChange?.(
          countPointsInRange(
            fullPointDataRef.current,
            floorSegmentationEnabledRef.current ? floorSegmentationPreviewRangeRef.current : floorSegmentationAppliedRangeRef.current,
          ),
        );

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
        frontPoseRef.current = {
          position: new THREE.Vector3(center.x, center.y - radius * 1.35, center.z + size.z * 0.08),
          target: center.clone(),
          up: new THREE.Vector3(0, 0, 1),
        };
        resetView();

        if (floorSegmentationGroupRef.current) {
          scene.remove(floorSegmentationGroupRef.current);
        }
        floorSegmentationGroupRef.current = new THREE.Group();
        scene.add(floorSegmentationGroupRef.current);
        updateFloorSegmentationPreview(
          scene,
          floorSegmentationGroupRef.current,
          box,
          floorSegmentationEnabledRef.current,
          floorSegmentationPreviewRangeRef.current,
          darkBackgroundRef.current,
        );

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
        requestRender(2000);
      },
      undefined,
      (error: unknown) => {
        const message = error instanceof Error ? error.message : "点云文件加载失败";
        onStatus("error", message);
      },
    );

    const clock = new THREE.Clock();

    const scheduleNextFrame = () => {
      const now = typeof performance !== "undefined" ? performance.now() : Date.now();
      const isInteracting =
        keysPressedRef.current.size > 0 ||
        draftTaskStateRef.current !== null ||
        now < interactionUntilRef.current;
      if (isInteracting) {
        idleTimerRef.current = window.setTimeout(() => {
          idleTimerRef.current = null;
          frameRef.current = window.requestAnimationFrame(animate);
        }, Math.max(1000 / performanceProfile.maxRenderFps, 16));
        return;
      }
      idleTimerRef.current = window.setTimeout(() => {
        idleTimerRef.current = null;
        frameRef.current = window.requestAnimationFrame(animate);
      }, Math.max(1000 / performanceProfile.idleFps, 16));
    };

    const animate = () => {
      const keys = keysPressedRef.current;
      if (keyboardCameraEnabledRef.current && keys.size > 0) {
        moveCameraWithKeys(camera, controls, keys, Math.min(clock.getDelta(), 0.1));
        requestRender(1200);
      } else {
        clock.getDelta();
      }

      controls.update();
      const now = typeof performance !== "undefined" ? performance.now() : Date.now();
      const isInteracting =
        keys.size > 0 ||
        draftTaskStateRef.current !== null ||
        now < interactionUntilRef.current;
      if (renderRequestedRef.current || isInteracting) {
        renderer.render(scene, camera);
        renderRequestedRef.current = false;
      }
      scheduleNextFrame();
    };
    animate();

    return () => {
      observer.disconnect();
      renderer.domElement.removeEventListener("pointerdown", handlePointerDown);
      renderer.domElement.removeEventListener("pointermove", handlePointerMove);
      renderer.domElement.removeEventListener("pointerup", finishDraftTaskPoint);
      renderer.domElement.removeEventListener("pointercancel", finishDraftTaskPoint);
      renderer.domElement.removeEventListener("keydown", handleKeyDown);
      renderer.domElement.removeEventListener("keyup", handleKeyUp);
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
      if (initialPoseMarkerRef.current) {
        scene.remove(initialPoseMarkerRef.current);
        initialPoseMarkerRef.current.traverse((child) => {
          const mesh = child as THREE.Mesh;
          if (mesh.geometry) {
            mesh.geometry.dispose();
          }
          const material = mesh.material;
          if (Array.isArray(material)) {
            material.forEach((item) => item.dispose());
          } else if (material instanceof THREE.Material) {
            material.dispose();
          }
        });
        initialPoseMarkerRef.current = null;
      }
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
      }
      if (idleTimerRef.current !== null) {
        window.clearTimeout(idleTimerRef.current);
      }
      fullPointDataRef.current = null;
      floorSegmentationBoundsRef.current = null;
      controls.dispose();
      renderer.dispose();
      scene.clear();
      container.removeChild(renderer.domElement);
    };
  }, [fileUrl, occGridAssetId, onSceneReady, onStatus, performanceProfile, requestRender, resetView]);

  return {
    containerRef,
    resetView,
    setTopView,
    setFrontView,
  };
}

async function loadOccGridOverlay(scene: THREE.Scene, planeZ: number, visible: boolean, occGridAssetId: string | null) {
  if (!occGridAssetId) {
    return null;
  }

  const requestQuery = `pcdId=${encodeURIComponent(occGridAssetId)}`;
  const metaResponse = await fetch(`/api/map/occ-grid/meta?${requestQuery}`, {
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

  const imageResponse = await fetch(`/api/map/occ-grid/image?${requestQuery}`);
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

function moveCameraWithKeys(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  keys: Set<string>,
  delta: number,
) {
  const forward = new THREE.Vector3().subVectors(controls.target, camera.position);
  forward.z = 0;
  const dist = forward.length();
  if (dist <= 0.001) {
    return;
  }

  forward.normalize();
  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 0, 1));
  const speed = dist * delta * 0.6;

  if (keys.has("ArrowUp") || keys.has("w") || keys.has("W")) {
    camera.position.addScaledVector(forward, speed);
    controls.target.addScaledVector(forward, speed);
  }
  if (keys.has("ArrowDown") || keys.has("s") || keys.has("S")) {
    camera.position.addScaledVector(forward, -speed);
    controls.target.addScaledVector(forward, -speed);
  }
  if (keys.has("ArrowLeft") || keys.has("a") || keys.has("A")) {
    camera.position.addScaledVector(right, speed);
    controls.target.addScaledVector(right, speed);
  }
  if (keys.has("ArrowRight") || keys.has("d") || keys.has("D")) {
    camera.position.addScaledVector(right, -speed);
    controls.target.addScaledVector(right, -speed);
  }
}

function applyFloorSegmentationRange(
  points: THREE.Points | null,
  source: { position: Float32Array; color: Float32Array | null } | null,
  range: { minZ: number; maxZ: number } | null,
) {
  if (!points || !source) {
    return;
  }

  const geometry = points.geometry as THREE.BufferGeometry;
  if (!range) {
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(source.position, 3));
    if (source.color) {
      geometry.setAttribute("color", new THREE.Float32BufferAttribute(source.color, 3));
    }
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return;
  }

  const minZ = Math.min(range.minZ, range.maxZ);
  const maxZ = Math.max(range.minZ, range.maxZ);
  const nextPositions: number[] = [];
  const nextColors: number[] = [];

  for (let index = 0; index < source.position.length; index += 3) {
    const z = source.position[index + 2];
    if (z < minZ || z > maxZ) {
      continue;
    }

    nextPositions.push(source.position[index], source.position[index + 1], z);
    if (source.color) {
      nextColors.push(source.color[index], source.color[index + 1], source.color[index + 2]);
    }
  }

  geometry.setAttribute("position", new THREE.Float32BufferAttribute(nextPositions, 3));
  if (source.color) {
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(nextColors, 3));
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
}

function countPointsInRange(
  source: { position: Float32Array; color: Float32Array | null } | null,
  range: { minZ: number; maxZ: number } | null,
) {
  if (!source) {
    return 0;
  }

  if (!range) {
    return source.position.length / 3;
  }

  const minZ = Math.min(range.minZ, range.maxZ);
  const maxZ = Math.max(range.minZ, range.maxZ);
  let count = 0;

  for (let index = 2; index < source.position.length; index += 3) {
    const z = source.position[index];
    if (z >= minZ && z <= maxZ) {
      count += 1;
    }
  }

  return count;
}

function updateFloorSegmentationPreview(
  scene: THREE.Scene | null,
  group: THREE.Group | null,
  bounds: THREE.Box3 | null,
  enabled: boolean,
  range: { minZ: number; maxZ: number } | null,
  darkBackground: boolean,
) {
  if (!scene || !group || !bounds) {
    return;
  }

  group.clear();
  if (!enabled || !range) {
    group.visible = false;
    return;
  }

  const min = bounds.min;
  const max = bounds.max;
  const inset = Math.max(Math.max(max.x - min.x, max.y - min.y) * 0.01, 0.08);
  const lowerZ = Math.min(range.minZ, range.maxZ);
  const upperZ = Math.max(range.minZ, range.maxZ);

  const lowerLoop = createFloorSegmentationLoop(min, max, inset, lowerZ, darkBackground ? 0xfbbf24 : 0xd97706);
  const upperLoop = createFloorSegmentationLoop(min, max, inset, upperZ, darkBackground ? 0x22d3ee : 0x0369a1);
  const fill = createFloorSegmentationFill(min, max, inset, lowerZ, upperZ, darkBackground);

  group.add(lowerLoop);
  group.add(upperLoop);
  group.add(fill);
  group.visible = true;
}

function createFloorSegmentationLoop(
  min: THREE.Vector3,
  max: THREE.Vector3,
  inset: number,
  z: number,
  color: THREE.ColorRepresentation,
) {
  const positions = [
    min.x + inset,
    min.y + inset,
    z,
    max.x - inset,
    min.y + inset,
    z,
    max.x - inset,
    max.y - inset,
    z,
    min.x + inset,
    max.y - inset,
    z,
    min.x + inset,
    min.y + inset,
    z,
  ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return new THREE.Line(
    geometry,
    new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 0.95,
    }),
  );
}

function createFloorSegmentationFill(
  min: THREE.Vector3,
  max: THREE.Vector3,
  inset: number,
  lowerZ: number,
  upperZ: number,
  darkBackground: boolean,
) {
  const geometry = new THREE.PlaneGeometry(Math.max(max.x - min.x - inset * 2, 0.1), Math.max(upperZ - lowerZ, 0.02));
  const material = new THREE.MeshBasicMaterial({
    color: darkBackground ? 0x22d3ee : 0x0891b2,
    transparent: true,
    opacity: 0.12,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const plane = new THREE.Mesh(geometry, material);
  plane.position.set(min.x + inset, (min.y + max.y) / 2, (lowerZ + upperZ) / 2);
  plane.rotation.y = Math.PI / 2;
  return plane;
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
