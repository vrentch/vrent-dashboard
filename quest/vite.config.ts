import { defineConfig } from "vite";

// The Quest TWA loads the app from a public HTTPS origin, and the same build is
// embedded on vrent.ch. Relative asset URLs keep both working regardless of the
// path the bundle ends up served from.
export default defineConfig({
  base: "./",
  build: {
    target: "es2022",
    // Quest 3's browser is Chromium — no legacy transpile needed, and the
    // headset benefits far more from fewer, larger chunks than from many
    // round-trips over conference wifi.
    assetsInlineLimit: 8192,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks: (id) => (id.includes("node_modules/three") ? "three" : undefined),
      },
    },
  },
  server: {
    host: true,
    port: 5180,
  },
  preview: {
    host: true,
    port: 5180,
  },
});
