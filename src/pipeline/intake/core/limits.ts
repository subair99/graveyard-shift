// Intake limits and content rules. Values come from common/constants.ts (chosen upper bounds, decision A2).

import { ALLOWED_MEDIUM_PATHS, INTAKE_LIMITS } from "../../common/constants";

export { ALLOWED_MEDIUM_PATHS, INTAKE_LIMITS };

export const RESURRECTION_DIR = ALLOWED_MEDIUM_PATHS[0];
export const DELTAS_FILE = ALLOWED_MEDIUM_PATHS[1];
export const HARNESS_FILE = ALLOWED_MEDIUM_PATHS[2];
export const CONTROL_FILES: readonly string[] = [DELTAS_FILE, HARNESS_FILE];

export { FORBIDDEN_SEGMENTS } from "../../medium/agent/pathRules.mjs";
export const ALLOWED_EXTENSIONS: readonly string[] = [".js", ".cjs", ".json", ".md", ".txt"];
export const TEXT_EXTENSIONS: readonly string[] = ALLOWED_EXTENSIONS;
export const LICENSE_FILE_NAME = "LICENSE";
