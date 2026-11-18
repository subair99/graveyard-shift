export declare const VARIABLES: string[];
export interface NightlyRunValues {
  schemaVersion: 1;
  runId: number;
  runStartedAt: string;
  conclusion: string;
  headSha: string;
  buildSha: string;
}
export type NightlyCheck = { ok: true; record: NightlyRunValues } | { ok: false; variables: string[]; message: string };
export declare function checkNightlyRun(env: Record<string, string | undefined>): NightlyCheck;
export declare function writeNightlyRun(
  env: Record<string, string | undefined>,
  cwd: string,
): { exitCode: number; written: boolean; lines: string[] };
