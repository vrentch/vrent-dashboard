import type { IncomingMessage, ServerResponse } from "node:http";
import { handleApi } from "../server/router";

/**
 * Catch-all serverless function (Vercel / Node runtime). Handles every
 * /api/* route via the shared router. Deploy this project to any host that
 * runs Node serverless functions and the phone app works with no keys.
 */
export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url || "/", "http://localhost");
  const { status, body } = await handleApi(url.pathname, url.searchParams);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
  res.end(JSON.stringify(body));
}
