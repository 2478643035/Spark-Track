import { parseYaml, stringifyYaml } from "obsidian";

const FRONTMATTER_PATTERN = /^---\n([\s\S]*?)\n---\n?/;

export function parseFrontmatter<T>(content: string): { data: T | null; body: string } {
  const match = content.match(FRONTMATTER_PATTERN);

  if (!match) {
    return {
      data: null,
      body: content
    };
  }

  return {
    data: parseYaml(match[1]) as T,
    body: content.slice(match[0].length)
  };
}

export function replaceFrontmatter(content: string, data: unknown): string {
  const body = parseFrontmatter(content).body.replace(/^\n+/, "");
  const yaml = stringifyYaml(data).trim();
  return `---\n${yaml}\n---\n${body}`;
}
