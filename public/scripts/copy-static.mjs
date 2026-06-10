import { cp, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";

const staticPaths = [
  "files",
  "supabase-config.js",
  "total-results/data.js",
  "total-results/maze-analyzer-data.js",
  "total-results/maze-dashboard.js",
];

await mkdir("dist", { recursive: true });

for (const path of staticPaths) {
  if (!existsSync(path)) continue;
  await cp(path, `dist/${path}`, { recursive: true });
}
