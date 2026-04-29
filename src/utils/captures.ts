import type { CaptureEntry, CaptureTriageStatus } from "../types";
import { createCaptureId } from "./date";

const CAPTURE_META_PATTERN =
  /^<!--\s*nexus:capture-meta\s+id=([A-Za-z0-9-]+)\s+status=([A-Za-z0-9-]+)\s*-->$/;
const CAPTURE_HEADER_PATTERN = /^\[!note\]\s+(.+?)(?:\s+\^([A-Za-z0-9-]+))?$/;

export interface CaptureInboxSections {
  visiblePendingCaptures: CaptureEntry[];
  hiddenPendingCaptures: CaptureEntry[];
  processedCaptures: CaptureEntry[];
  pendingCount: number;
  processedCount: number;
}

export function createCaptureInboxSections(
  captures: CaptureEntry[],
  options: { revealOlderPending?: boolean } = {}
): CaptureInboxSections {
  const sortedCaptures = [...captures].sort((left, right) => right.timestamp.localeCompare(left.timestamp));
  const pendingCaptures = sortedCaptures.filter((capture) => capture.triageStatus === "pending");
  const processedCaptures = sortedCaptures.filter((capture) => capture.triageStatus !== "pending");

  return {
    visiblePendingCaptures: options.revealOlderPending ? pendingCaptures : pendingCaptures.slice(0, 1),
    hiddenPendingCaptures: options.revealOlderPending ? [] : pendingCaptures.slice(1),
    processedCaptures,
    pendingCount: pendingCaptures.length,
    processedCount: processedCaptures.length
  };
}

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
  const sourceToken = sourcePath.replace(/[^A-Za-z0-9]/g, "").slice(-8) || "legacy";
  const timeToken = timestamp.replace(/[^0-9]/g, "").slice(-8) || `${index}`;
  return `c-${sourceToken}${timeToken}`;
}

function finalizeEntry(
  entries: CaptureEntry[],
  working:
    | {
        id: string;
        triageStatus: CaptureTriageStatus;
        timestamp: string;
        lines: string[];
      }
    | null,
  sourcePath: string,
  index: number
): void {
  if (!working || !working.timestamp || working.lines.length === 0) {
    return;
  }

  const firstContentLine = working.lines[0] ?? "";
  const chipMatch = firstContentLine.match(/^\[(.*?)\]\s*(.*)$/);
  const chipLabels = chipMatch?.[1]?.split(/\s+/).filter(Boolean) ?? [];
  const textLines = chipMatch ? [chipMatch[2], ...working.lines.slice(1)] : working.lines;

  entries.push({
    id: working.id || createLegacyCaptureId(sourcePath, working.timestamp, index),
    timestamp: working.timestamp,
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
        timestamp: string;
        lines: string[];
      }
    | null = null;
  let entryIndex = 0;
  let pendingMeta: { id: string; triageStatus: CaptureTriageStatus } | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    const metaMatch = line.match(CAPTURE_META_PATTERN);
    if (metaMatch) {
      pendingMeta = {
        id: metaMatch[1],
        triageStatus: normalizeStatus(metaMatch[2])
      };
      continue;
    }

    if (!line.startsWith(">")) {
      continue;
    }

    const quoteLine = line.replace(/^>\s?/, "");
    const headerMatch = quoteLine.match(CAPTURE_HEADER_PATTERN);

    if (headerMatch) {
      finalizeEntry(entries, working, sourcePath, entryIndex);
      entryIndex += 1;
      working = {
        id: headerMatch[2] ?? pendingMeta?.id ?? createLegacyCaptureId(sourcePath, headerMatch[1], entryIndex),
        triageStatus: pendingMeta?.triageStatus ?? "pending",
        timestamp: headerMatch[1].trim(),
        lines: []
      };
      pendingMeta = null;
      continue;
    }

    if (!working) {
      continue;
    }

    working.lines.push(quoteLine);
  }

  finalizeEntry(entries, working, sourcePath, entryIndex);

  return entries.filter((entry) => entry.timestamp && entry.text);
}

export function renderCaptureEntry(entry: CaptureEntry): string {
  const textLines = entry.text.split(/\r?\n/);
  const firstLine = textLines[0] ?? "";
  const chipPrefix = entry.chipLabels.length > 0 ? `[${entry.chipLabels.join(" ")}] ` : "";
  const renderedLines = [
    `> [!note] ${entry.timestamp} ^${entry.id || createCaptureId()}`,
    `> ${chipPrefix}${firstLine}`,
    ...textLines.slice(1).map((line) => `> ${line}`)
  ];

  return renderedLines.join("\n");
}
