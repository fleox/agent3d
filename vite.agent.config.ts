import { defineConfig } from "vite";

// Builds the `agent3d` CLI (agent/bin.ts) into ONE self-contained Node
// entry, dist/agent/agent3d.mjs (+ lazy chunks) — every dependency is
// inlined so the npm package needs no runtime dependencies (mirror of
// agentcrm's vite.agent.config.ts).
const CJS_SHIM = [
  'import { createRequire as __a3dRequire } from "node:module";',
  'import { fileURLToPath as __a3dPath } from "node:url";',
  'import { dirname as __a3dDirname } from "node:path";',
  "const require = __a3dRequire(import.meta.url);",
  "const __filename = __a3dPath(import.meta.url);",
  "const __dirname = __a3dDirname(__filename);",
].join("\n");

export default defineConfig({
  // public/ belongs to the Studio build — keep it out of dist/agent/.
  publicDir: false,
  define: {
    __AGENT3D_BUNDLED__: "true",
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  ssr: {
    noExternal: true,
  },
  build: {
    ssr: "agent/bin.ts",
    target: "node20",
    outDir: "dist/agent",
    emptyOutDir: true,
    minify: false,
    sourcemap: false,
    rollupOptions: {
      output: {
        format: "es",
        entryFileNames: "agent3d.mjs",
        // Commands load the engine's modules on demand, so `help` /
        // `version` start instantly.
        chunkFileNames: "chunks/[name]-[hash].mjs",
        banner: (chunk) => (chunk.isEntry ? "#!/usr/bin/env node\n" : "") + CJS_SHIM,
      },
    },
  },
});
