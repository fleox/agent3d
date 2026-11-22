import { defineConfig } from "vite";

// Builds ONE ES module, dist/bundle.js, that the AgentCMS admin imports
// at runtime. The admin provides React, react-dom, react-i18next and
// @agent-cms/runtime through an import-map: they MUST stay external
// (a bundled copy of React breaks every hook with "Invalid hook call").
// Anything else you import is bundled.
export default defineConfig({
  // JSX → react/jsx-runtime calls (external, provided by the admin).
  // jsxDev: false — when NODE_ENV is set to anything but "production"
  // in the shell, Vite would emit jsxDEV calls (react/jsx-dev-runtime),
  // which the admin does not provide.
  esbuild: { jsx: "automatic", jsxDev: false },
  // Library mode doesn't replace process.env.NODE_ENV; browsers have no
  // `process`, so bundled libraries that read it would crash.
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  publicDir: false,
  build: {
    lib: {
      entry: "src/manifest.tsx",
      formats: ["es"],
      fileName: () => "bundle.js",
    },
    outDir: "dist",
    emptyOutDir: true,
    minify: true,
    sourcemap: false,
    rollupOptions: {
      external: [
        "react",
        "react/jsx-runtime",
        "react-dom",
        "react-dom/client",
        "react-i18next",
        "@agent-cms/runtime",
      ],
      // The admin loads one file: keep dynamic imports inline.
      output: { inlineDynamicImports: true },
    },
  },
});
