import type { ControlledBlockSpec } from "../types";

function normalizeBlockBody(body: string): string {
  const trimmed = body.trim();
  return trimmed.length > 0 ? `${trimmed}\n` : "";
}

function findBlockRange(content: string, spec: ControlledBlockSpec) {
  const startIndex = content.indexOf(spec.startMarker);
  const endIndex = startIndex === -1 ? -1 : content.indexOf(spec.endMarker, startIndex);

  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    return null;
  }

  return {
    startIndex,
    endIndex,
    bodyStart: content.indexOf("\n", startIndex + spec.startMarker.length) + 1
  };
}

export function readBlock(content: string, spec: ControlledBlockSpec): string | null {
  const range = findBlockRange(content, spec);
  if (!range) {
    return null;
  }

  return content.slice(range.bodyStart, range.endIndex).trim();
}

export function replaceBlock(content: string, spec: ControlledBlockSpec, body: string): string {
  const normalizedBody = normalizeBlockBody(body);
  const blockText = `${spec.startMarker}\n${normalizedBody}${spec.endMarker}`;
  const range = findBlockRange(content, spec);

  if (!range) {
    const parts = [content.trimEnd()];

    if (spec.heading) {
      parts.push(spec.heading);
    }

    if (spec.leadIn?.length) {
      parts.push(spec.leadIn.join("\n"));
    }

    parts.push(blockText);

    return `${parts.filter(Boolean).join("\n\n").trim()}\n`;
  }

  return `${content.slice(0, range.startIndex)}${blockText}${content.slice(
    range.endIndex + spec.endMarker.length
  )}`.replace(/\n{3,}/g, "\n\n");
}

export function appendToBlock(content: string, spec: ControlledBlockSpec, lines: string[]): string {
  const currentBody = readBlock(content, spec);
  const nextBody = [currentBody ?? "", ...lines].filter(Boolean).join("\n").trim();
  return replaceBlock(content, spec, nextBody);
}
