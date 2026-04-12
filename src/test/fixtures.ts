import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export async function loadMockHtml(relativePath: string) {
  return readFile(resolve(process.cwd(), relativePath), "utf8");
}
