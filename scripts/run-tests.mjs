import { readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = process.cwd();
const testsRoot = join(root, "tests");
const obsidianMockPath = fileURLToPath(new URL("../tests/mocks/obsidian.ts", import.meta.url));

async function findTestFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        return findTestFiles(entryPath);
      }

      return entry.name.endsWith(".test.ts") ? [entryPath] : [];
    })
  );

  return files.flat();
}

const server = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "error",
  root,
  resolve: {
    alias: {
      obsidian: obsidianMockPath
    }
  },
  server: {
    middlewareMode: true
  }
});

try {
  const testFiles = await findTestFiles(testsRoot);

  for (const testFile of testFiles) {
    const modulePath = `/${relative(root, resolve(testFile)).replaceAll("\\", "/")}`;
    const testModule = await server.ssrLoadModule(`${modulePath}?t=${Date.now()}`);
    if (typeof testModule.run !== "function") {
      throw new Error(`Test module ${modulePath} must export run().`);
    }

    await testModule.run();
    console.log(`ok ${relative(root, testFile)}`);
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await server.close();
}
