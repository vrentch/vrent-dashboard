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
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "icon.svg"],
      manifest: {
        name: "Vrent — News & Markets",
        short_name: "Vrent",
        description: "Live world news by country & topic, plus stock markets and analytics.",
        theme_color: "#0b1120",
        background_color: "#0b1120",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        icons: [
          { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
          { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
        ],
      },
      workbox: {
        // Never cache API responses — always fetch fresh live data.
        navigateFallbackDenylist: [/^\/api/],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/[^/]*\/api\//,
            handler: "NetworkOnly",
          },
        ],
      },
    }),
  ],
});
