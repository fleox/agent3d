import { defineConfig } from "vite";

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
          ...(single ? { codeSplitting: false } : {}),
        },
      },
    },
  };
});
