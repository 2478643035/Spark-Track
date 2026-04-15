import { access, copyFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const distDir = resolve(root, "dist");
const mainSource = resolve(distDir, "main.js");
const cssSource = resolve(distDir, "styles.css");
const mainTarget = resolve(root, "main.js");
const cssTarget = resolve(root, "styles.css");
const rootNoMediaTarget = resolve(root, ".nomedia");
const distNoMediaTarget = resolve(distDir, ".nomedia");

await copyFile(mainSource, mainTarget);
await writeFile(rootNoMediaTarget, "", "utf8");
await writeFile(distNoMediaTarget, "", "utf8");

try {
  await access(cssSource, constants.F_OK);
  await copyFile(cssSource, cssTarget);
} catch {
  await writeFile(cssTarget, "", "utf8");
}
