import type { ControlledBlockSpec } from "../types";

type BlockRange = {
  startIndex: number;
  endIndex: number;
  bodyStart: number;
  kind: "marker" | "heading";
};

function normalizeBlockBody(body: string): string {
  return body.trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function skipLineBreak(content: string, index: number): number {
  if (content.slice(index, index + 2) === "\r\n") {
    return index + 2;
  }

  if (content[index] === "\n") {
    return index + 1;
  }

  return index;
}

function skipBlankLine(content: string, index: number): number {
  if (content.slice(index, index + 2) === "\r\n") {
    return index + 2;
  }

  if (content[index] === "\n") {
    return index + 1;
  }

  return index;
}

function findMarkerRange(content: string, spec: ControlledBlockSpec): BlockRange | null {
  const startIndex = content.indexOf(spec.startMarker);
  const endIndex = startIndex === -1 ? -1 : content.indexOf(spec.endMarker, startIndex);

  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    return null;
  }

  return {
    startIndex,
    endIndex: endIndex + spec.endMarker.length,
    bodyStart: content.indexOf("\n", startIndex + spec.startMarker.length) + 1,
    kind: "marker"
  };
}

function findHeadingRange(content: string, spec: ControlledBlockSpec): BlockRange | null {
  if (!spec.heading) {
    return null;
  }

  const headingPattern = new RegExp(`^${escapeRegExp(spec.heading)}\\s*$`, "m");
  const headingMatch = headingPattern.exec(content);
  if (!headingMatch) {
    return null;
  }

  let bodyStart = headingMatch.index + headingMatch[0].length;
  bodyStart = skipLineBreak(content, bodyStart);
  bodyStart = skipBlankLine(content, bodyStart);

  if (spec.leadIn?.length) {
    const leadInText = spec.leadIn.join("\n");
    if (content.slice(bodyStart, bodyStart + leadInText.length) === leadInText) {
      bodyStart += leadInText.length;
      bodyStart = skipLineBreak(content, bodyStart);
      bodyStart = skipBlankLine(content, bodyStart);
    }
  }

  const nextHeadingPattern = /^##\s+/gm;
  nextHeadingPattern.lastIndex = bodyStart;
  const nextHeadingMatch = nextHeadingPattern.exec(content);
  const endIndex = nextHeadingMatch ? nextHeadingMatch.index : content.length;

  return {
    startIndex: headingMatch.index,
    endIndex,
    bodyStart,
    kind: "heading"
  };
}

function findBlockRange(content: string, spec: ControlledBlockSpec): BlockRange | null {
  return findMarkerRange(content, spec) ?? findHeadingRange(content, spec);
}

function renderSection(spec: ControlledBlockSpec, body: string): string {
  const parts: string[] = [];
  const normalizedBody = normalizeBlockBody(body);

  if (spec.heading) {
    parts.push(spec.heading);
  }

  if (spec.leadIn?.length) {
    parts.push(spec.leadIn.join("\n"));
  }

  if (normalizedBody) {
    parts.push(normalizedBody);
  }

  return `${parts.filter(Boolean).join("\n\n").trim()}\n`;
}

export function readBlock(content: string, spec: ControlledBlockSpec): string | null {
  const range = findBlockRange(content, spec);
  if (!range) {
    return null;
  }

  const bodyEnd = range.kind === "marker" ? range.endIndex - spec.endMarker.length : range.endIndex;
  return content.slice(range.bodyStart, bodyEnd).trim();
}

export function replaceBlock(content: string, spec: ControlledBlockSpec, body: string): string {
  const sectionText = renderSection(spec, body);
  const range = findBlockRange(content, spec);

  if (!range) {
    const base = content.trimEnd();
    const joined = [base, sectionText.trim()].filter(Boolean).join("\n\n");
    return `${joined.trim()}\n`;
  }

  return `${content.slice(0, range.startIndex)}${sectionText}${content.slice(range.endIndex)}`.replace(/\n{3,}/g, "\n\n");
}

export function appendToBlock(content: string, spec: ControlledBlockSpec, lines: string[]): string {
  const currentBody = readBlock(content, spec);
  const nextBody = [currentBody ?? "", ...lines].filter(Boolean).join("\n").trim();
  return replaceBlock(content, spec, nextBody);
}
