export class TFile {
  readonly path: string;
  readonly basename: string;
  readonly extension: string;

  constructor(path: string) {
    this.path = normalizePath(path);
    const name = this.path.split("/").pop() ?? this.path;
    const extensionIndex = name.lastIndexOf(".");
    this.basename = extensionIndex === -1 ? name : name.slice(0, extensionIndex);
    this.extension = extensionIndex === -1 ? "" : name.slice(extensionIndex + 1);
  }
}

export class TFolder {
  readonly path: string;

  constructor(path: string) {
    this.path = normalizePath(path);
  }
}

export function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/\/+/g, "/").replace(/^\/+/, "").replace(/\/$/, "");
}
