import { defineConfig, type Plugin } from "vite";

// The catalog (src/core/catalog.ts) is shared with validation, docs and AI tools;
// websites only need its ids, types and defaults. Drop the prose (descriptions,
// examples' text stays) from the runtime bundle: ~10 KB gzipped off the core.
function stripCatalogProse(): Plugin {
  const STR = String.raw`"(?:[^"\\]|\\.)*"`;
  return {
    name: "agent3d-strip-catalog-prose",
    enforce: "pre",
    transform(code, id) {
      if (!/src[\\/]core[\\/]catalog\.ts$/.test(id)) return null;
      const out = code
        .replace(new RegExp(String.raw`\bdescription: ${STR}`, "g"), 'description: ""')
        .replace(new RegExp(String.raw`\b(n|i|b|c|cs|v3|e)\((${STR}), ${STR}`, "g"), '$1($2, ""');
      return { code: out, map: null };
    },
  };
}

// Builds the runtime shipped to websites (src/runtime/index.ts):
//   default        → dist/runtime/agent3d-runtime.js + lazy chunks/ (postfx,
//                    generators, shaders, game/physics/HUD, loaders, audio)
//   --mode single  → dist/runtime/agent3d-runtime.single.js: one file, every
//                    dynamic import inlined (single-html exports).
// Vite 8 (rolldown): `output.codeSplitting: false` replaces inlineDynamicImports.
export default defineConfig(({ mode }) => {
  const single = mode === "single";
  return {
    publicDir: false,
    plugins: [stripCatalogProse()],
    define: {
      "process.env.NODE_ENV": JSON.stringify("production"),
    },
    build: {
      outDir: "dist/runtime",
      emptyOutDir: !single,
      target: "es2022",
      minify: true,
      sourcemap: false,
      reportCompressedSize: true,
      chunkSizeWarningLimit: 1200,
      modulePreload: false,
      lib: {
        entry: "src/runtime/index.ts",
        formats: ["es"],
        fileName: () => (single ? "agent3d-runtime.single.js" : "agent3d-runtime.js"),
      },
      rolldownOptions: {
        output: {
          format: "es",
          chunkFileNames: "chunks/[name]-[hash].js",
          // Lib mode keeps whitespace in ES output (to preserve pure annotations for
          // downstream bundlers); the runtime ships as-is to websites, so minify fully.
          minify: true,
          ...(single ? { codeSplitting: false } : {}),
        },
      },
    },
  };
});
