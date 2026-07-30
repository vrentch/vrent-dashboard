import type { Connect } from "vite";
import { handleApi } from "../api/[...path].ts";

async function readBody(req: Connect.IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : undefined);
      } catch {
        resolve(undefined);
      }
    });
    req.on("error", () => resolve(undefined));
  });
}

/**
 * Vite dev-server middleware that serves the same /api/* routes as the
 * production serverless function (they share the exact same handleApi), so
 * `npm run dev` has real live data.
 */
export function apiDevMiddleware(): Connect.NextHandleFunction {
  return async (req, res, next) => {
    if (!req.url || !req.url.startsWith("/api/")) return next();
    const url = new URL(req.url, "http://localhost");
    const body = req.method === "POST" ? await readBody(req) : undefined;
    const { status, body: out, location } = await handleApi(url.pathname, url.searchParams, { method: req.method, body });
    if (location) {
      res.statusCode = status;
      res.setHeader("Location", location);
      res.end();
      return;
    }
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify(out));
  };
}
