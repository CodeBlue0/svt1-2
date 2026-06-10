import { cp, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";

const staticPaths = [
  "files",
  "supabase-config.js",
  "total-results/data.js",
];

await mkdir("dist", { recursive: true });

for (const path of staticPaths) {
  const source = `public/${path}`;
  if (!existsSync(source)) continue;
  await cp(source, `dist/${path}`, { recursive: true });
}
