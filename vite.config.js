import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(fileURLToPath(import.meta.url));
const publicRoot = resolve(projectRoot, "public");

export default defineConfig({
  root: publicRoot,
  publicDir: false,
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
  },
  build: {
    outDir: resolve(projectRoot, "dist"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(publicRoot, "index.html"),
        totalResults: resolve(publicRoot, "total-results/index.html"),
        totalResultsItems: resolve(publicRoot, "total-results/items.html"),
        totalResultsInsights: resolve(publicRoot, "total-results/insights.html"),
      },
    },
  },
});
