import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  build: {
    ssr: "scripts/start-worker.ts",
    outDir: "worker-build",
    emptyOutDir: true,
    sourcemap: true,
    target: "node22",
  },
});
