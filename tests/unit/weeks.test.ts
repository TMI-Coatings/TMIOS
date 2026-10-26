import { describe, expect, it } from "vitest";
import { addDays, currentWeek, isFriday, mondayOf, weekEnding, weekList } from "../../src/domain/weeks";

describe("weeks end on Friday", () => {
  it("maps every day to its Friday", () => {
    expect(weekEnding("2026-10-26")).toBe("2026-10-30"); // Mon
    expect(weekEnding("2026-10-30")).toBe("2026-10-30"); // Fri
    expect(weekEnding("2026-10-31")).toBe("2026-11-06"); // Sat rolls forward
    expect(weekEnding("2026-11-01")).toBe("2026-11-06"); // Sun
  });
  it("Monday is Friday minus 4", () => {
    expect(mondayOf("2026-10-30")).toBe("2026-10-26");
  });
  it("lists consecutive Fridays", () => {
    const ws = weekList("2026-10-30", 13);
    expect(ws).toHaveLength(13);
    expect(ws.every(isFriday)).toBe(true);
    expect(ws[12]).toBe(addDays("2026-10-30", 84));
  });
  it("uses Central time for the current week", () => {
    // 03:00 UTC Saturday is still Friday evening in Chicago.
    expect(currentWeek(new Date("2026-10-31T03:00:00Z"))).toBe("2026-10-30");
    expect(currentWeek(new Date("2026-10-31T06:00:00Z"))).toBe("2026-11-06");
  });
});
