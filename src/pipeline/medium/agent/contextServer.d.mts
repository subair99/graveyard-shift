// Declarations for contextServer.mjs (the .mjs body is not type-checked).

export interface ContextServerTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: {
    readonly type: "object";
    readonly properties: Readonly<Record<string, { readonly type: "string"; readonly description: string }>>;
    readonly required?: readonly string[];
    readonly additionalProperties: false;
  };
}

/** Equals INTAKE_LIMITS.maxFileBytes. */
export declare const MAX_FILE_BYTES: number;
export declare const MAX_LINE_BYTES: number;
export declare const SUPPORTED_PROTOCOL_VERSIONS: readonly string[];
export declare const NOT_ALLOWED_TEXT: "path not found or not allowed";
export declare const TOOLS: readonly ContextServerTool[];

/**
 * Pure. Returns the JSON text of the get_advisories result. Throws an Error with a plain message when the
 * certificate text does not parse or holds no openVulnerabilities data, when the measurement text does not parse, or
 * when an advisory.sources entry of the measurement has a checkedOn that is neither YYYY-MM-DD nor a valid Fetch_Date.
 * Each such entry gains fetchedAt (and fetchedAtPrecision "date-only" for a date-only checkedOn).
 */
export declare function buildAdvisories(certificateText: string, measurementText: string | null): string;
