import assert from "node:assert/strict";
import type { CaptureEntry, CaptureTriageStatus } from "../../src/types";
import { createCaptureInboxSections } from "../../src/utils/captures";

function capture(input: {
  id: string;
  timestamp: string;
  triageStatus?: CaptureTriageStatus;
}): CaptureEntry {
  return {
    id: input.id,
    timestamp: input.timestamp,
    triageStatus: input.triageStatus ?? "pending",
    chipLabels: [],
    text: input.id,
    sourcePath: "Daily/2026-04-30.md"
  };
}

export async function run(): Promise<void> {
  keepsOnlyLatestPendingCaptureVisibleByDefault();
  sortsPendingCapturesByLatestTimestamp();
  separatesProcessedCapturesFromPendingQueue();
}

function keepsOnlyLatestPendingCaptureVisibleByDefault(): void {
  const sections = createCaptureInboxSections([
    capture({ id: "old", timestamp: "2026-04-30 09:00" }),
    capture({ id: "latest", timestamp: "2026-04-30 11:00" }),
    capture({ id: "middle", timestamp: "2026-04-30 10:00" })
  ]);

  assert.deepEqual(
    sections.visiblePendingCaptures.map((entry) => entry.id),
    ["latest"]
  );
  assert.deepEqual(
    sections.hiddenPendingCaptures.map((entry) => entry.id),
    ["middle", "old"]
  );
  assert.equal(sections.pendingCount, 3);
}

function sortsPendingCapturesByLatestTimestamp(): void {
  const sections = createCaptureInboxSections(
    [
      capture({ id: "older", timestamp: "2026-04-29 23:59" }),
      capture({ id: "newer", timestamp: "2026-04-30 00:01" })
    ],
    { revealOlderPending: true }
  );

  assert.deepEqual(
    sections.visiblePendingCaptures.map((entry) => entry.id),
    ["newer", "older"]
  );
}

function separatesProcessedCapturesFromPendingQueue(): void {
  const sections = createCaptureInboxSections([
    capture({ id: "done", timestamp: "2026-04-30 11:00", triageStatus: "life-task" }),
    capture({ id: "pending", timestamp: "2026-04-30 10:00" })
  ]);

  assert.deepEqual(
    sections.visiblePendingCaptures.map((entry) => entry.id),
    ["pending"]
  );
  assert.deepEqual(
    sections.processedCaptures.map((entry) => entry.id),
    ["done"]
  );
}
