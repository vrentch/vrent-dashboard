import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { apiDevMiddleware } from "./server/devMiddleware";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Serve /api/* with live data during `npm run dev`.
    {
      name: "vrent-api-dev",
      configureServer(server) {
        server.middlewares.use(apiDevMiddleware());
      },
    },
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      registerType: "autoUpdate",
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,svg,png}"],
      },
      includeAssets: ["favicon.svg", "icon.svg", "apple-touch-icon.png", "icon-192.png", "icon-512.png"],
      manifest: {
        name: "AC App",
        short_name: "AC App",
        description: "World news, markets, sports, health & an AI scanner.",
        theme_color: "#f4f4f5",
        background_color: "#f4f4f5",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
        ],
      },
    }),
  ],
});
