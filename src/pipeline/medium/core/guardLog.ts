export interface GuardLogSummary {
  lineCount: number;
  denyLines: string[];
}

/** Splits on "\n"; a line counts when non-empty; a DENY line has "DENY" as its second space-separated field. */
export function summarizeGuardLog(text: string): GuardLogSummary {
  let lineCount = 0;
  const denyLines: string[] = [];
  for (const line of text.split("\n")) {
    if (line === "") continue;
    lineCount += 1;
    if (line.split(" ")[1] === "DENY") denyLines.push(line);
  }
  return { lineCount, denyLines };
}
