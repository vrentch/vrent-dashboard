import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// Builds the whole game into one self-contained .html so it can be hosted
// anywhere that serves a single file. Panoramas stay external and fall back
// to the procedural scenes, which are the showcase anyway.
export default defineConfig({
  plugins: [viteSingleFile({ removeViteModuleLoader: true })],
  define: { "import.meta.env.VITE_EDITION": JSON.stringify("pro") },
  build: {
    target: "es2022",
    outDir: "dist-single",
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
