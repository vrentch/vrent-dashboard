import type { Connect } from "vite";
import { handleApi } from "./router";

/**
 * Vite dev-server middleware that serves the same /api/* routes as the
 * production serverless function, so `npm run dev` has real live data.
 */
export function apiDevMiddleware(): Connect.NextHandleFunction {
  return async (req, res, next) => {
    if (!req.url || !req.url.startsWith("/api/")) return next();
    const url = new URL(req.url, "http://localhost");
    const { status, body } = await handleApi(url.pathname, url.searchParams);
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify(body));
  };
}
