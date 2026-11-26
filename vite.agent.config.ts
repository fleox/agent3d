import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
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

// `assets depth` runs Depth Anything V2 with onnxruntime-web in headless
// Chrome: ship its WASM build next to the CLI (dist/agent/ort/, served by
// agent/render/depth.ts; resolved by ortDir() in agent/paths.ts).
const ORT_FILES = ["ort.wasm.bundle.min.mjs", "ort-wasm-simd-threaded.wasm"];
const copyOrt = {
  name: "agent3d-copy-ort",
  apply: "build" as const,
  writeBundle(options: { dir?: string }) {
    const src = resolve("node_modules/onnxruntime-web/dist");
    const out = join(options.dir ?? "dist/agent", "ort");
    if (!ORT_FILES.every((f) => existsSync(join(src, f)))) throw new Error(`onnxruntime-web is missing in ${src}: run npm install.`);
    mkdirSync(out, { recursive: true });
    for (const f of ORT_FILES) copyFileSync(join(src, f), join(out, f));
    const version = (JSON.parse(readFileSync(resolve("node_modules/onnxruntime-web/package.json"), "utf8")) as { version: string }).version;
    writeFileSync(
      join(out, "LICENSE.txt"),
      `onnxruntime-web ${version} (https://github.com/microsoft/onnxruntime), MIT License\n\nCopyright (c) Microsoft Corporation\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.\n`,
    );
  },
};

export default defineConfig({
  plugins: [escapeLineSeparators, copyOrt],
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
