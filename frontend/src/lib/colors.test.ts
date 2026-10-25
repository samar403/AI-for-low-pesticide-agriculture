import { describe, expect, it } from "vitest";
import { hexToRgb, sprayRamp, vegRamp } from "./colors";
import { fmt } from "./format";

describe("colour ramps", () => {
  it("clamps and interpolates", () => {
    expect(vegRamp(-1)).toEqual(vegRamp(0));
    expect(vegRamp(2)).toEqual([30, 74, 44]);
    expect(sprayRamp(0.5)).toEqual([120, 165, 172]);
  });
  it("parses hex", () => {
    expect(hexToRgb("#c4452d")).toEqual([196, 69, 45]);
  });
});

describe("formatters", () => {
  it("formats units", () => {
    expect(fmt.frac(0.256)).toBe("26%");
    expect(fmt.litres(6.78)).toBe("6.78 L");
    expect(fmt.usd(2541.67)).toBe("$2,542");
  });
});
