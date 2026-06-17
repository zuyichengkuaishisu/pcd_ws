export function formatPointCount(value: number) {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(2)} M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)} K`;
  }
  return `${value}`;
}

export function formatMeters(value: number) {
  return `${value.toFixed(2)} m`;
}

export function formatCoordinate(value: number) {
  return value.toFixed(3);
}

export function formatVector3(vector: { x: number; y: number; z: number }) {
  return `(${formatCoordinate(vector.x)}, ${formatCoordinate(vector.y)}, ${formatCoordinate(vector.z)})`;
}

export function formatYawRadians(value: number) {
  return `${value.toFixed(3)} rad`;
}
