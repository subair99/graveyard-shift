import { describe, expect, it } from "vitest";
import { timeOfDeath } from "../../../src/engine/core/timeOfDeath";

const NOW = new Date("2024-01-10T00:00:00Z");

describe("timeOfDeath", () => {
  it("picks the latest release timestamp, ignoring created and modified", () => {
    const r = timeOfDeath(
      {
        created: "2010-01-01T00:00:00.000Z",
        modified: "2024-01-09T00:00:00.000Z",
        "1.0.0": "2020-01-01T00:00:00.000Z",
        "1.0.1": "2021-06-15T12:30:45.678Z",
        "0.9.0": "2019-01-01T00:00:00.000Z",
      },
      NOW,
    );
    expect(r).toEqual({ timeOfDeath: "2021-06-15T12:30:45Z", daysSince: 938 });
  });

  it("rounds elapsed days down", () => {
    const r = timeOfDeath({ "1.0.0": "2024-01-08T00:00:01.000Z" }, NOW);
    expect(r).toEqual({ timeOfDeath: "2024-01-08T00:00:01Z", daysSince: 1 });
  });

  it("reports 0 days when the analysis date is earlier than the time of death", () => {
    const r = timeOfDeath({ "1.0.0": "2030-01-01T00:00:00.000Z" }, NOW);
    expect(r).toEqual({ timeOfDeath: "2030-01-01T00:00:00Z", daysSince: 0 });
  });

  it("normalizes offsets to UTC", () => {
    const r = timeOfDeath({ "1.0.0": "2024-01-01T02:00:00+02:00" }, NOW);
    expect(r).toEqual({ timeOfDeath: "2024-01-01T00:00:00Z", daysSince: 9 });
  });

  it("skips unparseable entries", () => {
    const r = timeOfDeath(
      { "1.0.0": "2020-01-01T00:00:00.000Z", "1.0.1": "not a date", "1.0.2": "2020-02-31T00:00:00Z" },
      NOW,
    );
    expect(r).toMatchObject({ timeOfDeath: "2020-01-01T00:00:00Z" });
  });

  it("is unavailable when only created and modified exist", () => {
    const r = timeOfDeath(
      { created: "2010-01-01T00:00:00.000Z", modified: "2011-01-01T00:00:00.000Z" },
      NOW,
    );
    expect(r).toEqual({ unavailable: true, reason: "no release publish date was found" });
  });

  it("is unavailable for an empty map or no parseable entry", () => {
    const expected = { unavailable: true, reason: "no release publish date was found" };
    expect(timeOfDeath({}, NOW)).toEqual(expected);
    expect(timeOfDeath({ "1.0.0": "garbage" }, NOW)).toEqual(expected);
  });
});
