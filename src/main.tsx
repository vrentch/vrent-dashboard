import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import "./index.css";

// Register the service worker (needed for push notifications + offline shell).
// Check for a new version every minute while the app is open so deploys land
// automatically (autoUpdate reloads the page once the new worker activates).
registerSW({
  immediate: true,
  onRegisteredSW(_url, reg) {
    if (reg) setInterval(() => { reg.update().catch(() => {}); }, 60_000);
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
