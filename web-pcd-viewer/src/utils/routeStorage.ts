import type { TaskPoint } from "@/types/navigation";

export type SavedRoute = {
  id: string;
  name: string;
  mapId: string;
  createdAt: string;
  updatedAt: string;
  taskPoints: TaskPoint[];
};

const STORAGE_KEY = "inspection_routes";

function loadAllRoutes(): SavedRoute[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is SavedRoute =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as SavedRoute).id === "string" &&
        typeof (item as SavedRoute).name === "string" &&
        Array.isArray((item as SavedRoute).taskPoints),
    );
  } catch {
    return [];
  }
}

function saveAllRoutes(routes: SavedRoute[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(routes));
}

export function getRoutesForMap(mapId: string): SavedRoute[] {
  return loadAllRoutes()
    .filter((r) => r.mapId === mapId)
    .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
}

export function getAllRoutes(): SavedRoute[] {
  return loadAllRoutes().sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
}

export function saveRoute(route: SavedRoute): void {
  const routes = loadAllRoutes().filter((r) => r.id !== route.id);
  routes.push(route);
  saveAllRoutes(routes);
}

export function deleteRoute(routeId: string): void {
  const routes = loadAllRoutes().filter((r) => r.id !== routeId);
  saveAllRoutes(routes);
}

export function upsertRoute(
  mapId: string,
  name: string,
  taskPoints: TaskPoint[],
  existingId?: string,
): SavedRoute {
  const now = new Date().toISOString();
  const route: SavedRoute = {
    id: existingId ?? crypto.randomUUID(),
    name,
    mapId,
    createdAt: existingId
      ? (loadAllRoutes().find((r) => r.id === existingId)?.createdAt ?? now)
      : now,
    updatedAt: now,
    taskPoints: taskPoints.map((p) => ({ ...p, status: "draft" as const })),
  };
  saveRoute(route);
  return route;
}
