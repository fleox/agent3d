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

// GLSL in template literals ships as text: drop its comments and indentation
// (photo build: the lite runtime is size-critical). Only literals marked
// \`/* glsl */ \`…\`\` without nested template literals are touched.
function minifyGlsl(files: RegExp): Plugin {
  return {
    name: "agent3d-minify-glsl",
    enforce: "pre",
    transform(code, id) {
      if (!files.test(id)) return null;
      const out = code.replace(/\/\* glsl \*\/ `([^`]*)`/g, (_whole, body: string) => {
        const lines = body
          .split("\n")
          .map((l) => l.replace(/\/\/(?![^\n]*\$\{).*$/, "").trim())
          .filter((l) => l.length)
          // spaces around punctuation (not inside ${…} slots); "a - -b" never occurs in our GLSL
          .map((l) => (l.startsWith("#") || l.includes("${") ? l : l.replace(/\s*([=+\-*/<>(),;{}?:!&|])\s*/g, "$1")));
        // preprocessor lines and ${…} slots keep their own line
        return "`" + lines.map((l) => (l.startsWith("#") || l.includes("${") ? `\n${l}\n` : l)).join("").replace(/^\n/, "") + "\n`";
      });
      return { code: out, map: null };
    },
  };
}

// Builds the runtime shipped to websites (src/runtime/index.ts):
//   default        → dist/runtime/agent3d-runtime.js + lazy chunks/ (postfx,
//                    generators, shaders, game/physics/HUD, loaders, audio)
//   --mode single  → dist/runtime/agent3d-runtime.single.js: one file, every
//                    dynamic import inlined (single-html exports).
//   --mode photo   → dist/runtime/agent3d-photo.js: the photo-only lite runtime
//                    (src/runtime/lite/index.ts, one file, no Three.js) that
//                    exports ship for single-3D-photo scenes (src/ops/liteRuntime.ts).
// Vite 8 (rolldown): `output.codeSplitting: false` replaces inlineDynamicImports.
export default defineConfig(({ mode }) => {
  const single = mode === "single";
  const photo = mode === "photo";
  return {
    publicDir: false,
    plugins: [stripCatalogProse(), ...(photo ? [minifyGlsl(/src[\\/]runtime[\\/](build[\\/](?:photoCore|photoFx)|lite[\\/]player)\.ts$/)] : [])],
    define: {
      "process.env.NODE_ENV": JSON.stringify("production"),
    },
    build: {
      outDir: "dist/runtime",
      emptyOutDir: !single && !photo,
      target: "es2022",
      minify: true,
      sourcemap: false,
      reportCompressedSize: true,
      chunkSizeWarningLimit: 1200,
      modulePreload: false,
      lib: {
        entry: photo ? "src/runtime/lite/index.ts" : "src/runtime/index.ts",
        formats: ["es"],
        fileName: () => (photo ? "agent3d-photo.js" : single ? "agent3d-runtime.single.js" : "agent3d-runtime.js"),
      },
      rolldownOptions: {
        output: {
          format: "es",
          chunkFileNames: "chunks/[name]-[hash].js",
          // Lib mode keeps whitespace in ES output (to preserve pure annotations for
          // downstream bundlers); the runtime ships as-is to websites, so minify fully.
          minify: true,
          ...(single || photo ? { codeSplitting: false } : {}),
        },
      },
    },
  };
});
