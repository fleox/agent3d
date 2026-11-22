import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The Studio SPA (src/studio/) → dist/studio/, served by `agent3d studio`
// (relative base so it also works from any static folder).
// `npm run dev` runs it without the CLI (in-browser projects); set
// AGENT3D_STUDIO_API=http://127.0.0.1:4320 to proxy a running `agent3d studio`.
const api = process.env.AGENT3D_STUDIO_API;

export default defineConfig({
  base: "./",
  plugins: [react()],
  publicDir: false,
  server: api
    ? { proxy: Object.fromEntries(["/api", "/__runtime", "/__library", "/project"].map((p) => [p, { target: api, changeOrigin: true }])) }
    : undefined,
  build: {
    outDir: "dist/studio",
    emptyOutDir: true,
    target: "es2022",
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
  },
  // Scratch projects (.agent3d-tmp/) may contain stray test files.
  test: { exclude: ["**/node_modules/**", "**/dist/**", ".agent3d-tmp/**"] },
});
