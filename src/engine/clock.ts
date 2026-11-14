import type { Clock } from "./types";

/**
 * The real clock. This is the one place wall-clock time enters the engine.
 * It is for production wiring (web app, scripts); tests inject a fake Clock.
 * Not used by src/engine/core or src/engine/serialize.
 */
export const systemClock: Clock = { now: () => new Date() };
