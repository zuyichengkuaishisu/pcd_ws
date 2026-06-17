import { describe, expect, it } from "vitest";

import {
  formatCoordinate,
  formatMeters,
  formatPointCount,
  formatVector3,
  formatYawRadians,
} from "@/utils/viewerFormat";

describe("viewerFormat", () => {
  it("formats point counts using K and M units", () => {
    expect(formatPointCount(824)).toBe("824");
    expect(formatPointCount(12_800)).toBe("12.8 K");
    expect(formatPointCount(2_309_183)).toBe("2.31 M");
  });

  it("formats meters using two decimals", () => {
    expect(formatMeters(13.456)).toBe("13.46 m");
  });

  it("formats coordinates and pose values", () => {
    expect(formatCoordinate(1.23456)).toBe("1.235");
    expect(formatVector3({ x: 1.23456, y: -2.5, z: 0 })).toBe("(1.235, -2.500, 0.000)");
    expect(formatYawRadians(0.785398)).toBe("0.785 rad");
  });
});
