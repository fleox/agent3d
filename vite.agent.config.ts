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

// Raw U+2028 / U+2029 characters are line terminators inside a regex
// literal (a syntax error for the bundler's parser). Escaping them as
// \u2028 / \u2029 means the same thing in regexes, strings, templates and
// comments, so do it for every source module before transforming.
const escapeLineSeparators = {
  name: "agent3d-escape-line-separators",
  enforce: "pre" as const,
  transform(code: string) {
    if (!/[\u2028\u2029]/.test(code)) return null;
    return { code: code.replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029"), map: null };
  },
};

export default defineConfig({
  plugins: [escapeLineSeparators],
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
    target: "node22",
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
