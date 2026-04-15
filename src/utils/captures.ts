import type { CaptureEntry, CaptureTriageStatus } from "../types";
import { createCaptureId } from "./date";

const CAPTURE_META_PATTERN =
  /^<!--\s*nexus:capture-meta\s+id=([A-Za-z0-9-]+)\s+status=([A-Za-z0-9-]+)\s*-->$/;

function normalizeStatus(value: string | undefined): CaptureTriageStatus {
  switch (value) {
    case "kept":
    case "life-task":
    case "goal-task":
    case "tracker-yellow":
    case "tracker-green":
    case "tracker-red":
      return value;
    default:
      return "pending";
  }
}

function createLegacyCaptureId(sourcePath: string, timestamp: string, index: number): string {
  const sourceToken = sourcePath.replace(/[^A-Za-z0-9]/g, "").slice(-12) || "capture";
  const timeToken = timestamp.replace(/[^0-9]/g, "").slice(-12) || `${index}`;
  return `capture-${sourceToken}-${timeToken}-${index}`;
}

function finalizeEntry(
  entries: CaptureEntry[],
  working:
    | {
        id: string;
        triageStatus: CaptureTriageStatus;
        lines: string[];
      }
    | null,
  sourcePath: string,
  index: number
): void {
  if (!working || working.lines.length === 0) {
    return;
  }

  const timestamp = working.lines[0]?.replace(/^\[!note\]\s*/, "").trim() || "";
  const firstContentLine = working.lines[1] ?? "";
  const chipMatch = firstContentLine.match(/^\[(.*?)\]\s*(.*)$/);
  const chipLabels = chipMatch?.[1]?.split(/\s+/).filter(Boolean) ?? [];
  const textLines = chipMatch
    ? [chipMatch[2], ...working.lines.slice(2)]
    : working.lines.slice(1);

  entries.push({
    id: working.id || createLegacyCaptureId(sourcePath, timestamp, index),
    timestamp,
    chipLabels,
    text: textLines.join("\n").trim(),
    triageStatus: working.triageStatus,
    sourcePath
  });
}

export function parseCaptureEntries(body: string, sourcePath: string): CaptureEntry[] {
  const entries: CaptureEntry[] = [];
  const lines = body.split(/\r?\n/);
  let working:
    | {
        id: string;
        triageStatus: CaptureTriageStatus;
        lines: string[];
      }
    | null = null;
  let entryIndex = 0;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    const metaMatch = line.match(CAPTURE_META_PATTERN);
    if (metaMatch) {
      finalizeEntry(entries, working, sourcePath, entryIndex);
      entryIndex += 1;
      working = {
        id: metaMatch[1],
        triageStatus: normalizeStatus(metaMatch[2]),
        lines: []
      };
      continue;
    }

    if (!line.startsWith(">")) {
      continue;
    }

    const quoteLine = line.replace(/^>\s?/, "");
    const startsNewEntry = quoteLine.startsWith("[!note]");

    if (startsNewEntry && working?.lines.length) {
      finalizeEntry(entries, working, sourcePath, entryIndex);
      entryIndex += 1;
      working = null;
    }

    if (!working) {
      working = {
        id: createLegacyCaptureId(sourcePath, quoteLine, entryIndex),
        triageStatus: "pending",
        lines: []
      };
    }

    working.lines.push(quoteLine);
  }

  finalizeEntry(entries, working, sourcePath, entryIndex);

  return entries.filter((entry) => entry.timestamp && entry.text);
}

export function renderCaptureEntry(entry: CaptureEntry): string {
  const chips = entry.chipLabels.length > 0 ? entry.chipLabels.join(" ") : "#闪念";
  const textLines = entry.text.split(/\r?\n/);
  const renderedLines = [
    `<!-- nexus:capture-meta id=${entry.id || createCaptureId()} status=${entry.triageStatus} -->`,
    `> [!note] ${entry.timestamp}`,
    `> [${chips}] ${textLines[0] ?? ""}`,
    ...textLines.slice(1).map((line) => `> ${line}`)
  ];

  return renderedLines.join("\n");
}
