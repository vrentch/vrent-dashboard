import { getNews } from "./news";
import { getQuotes, getHistory } from "./stocks";

export interface ApiResponse {
  status: number;
  body: unknown;
}

/**
 * Framework-agnostic API core. Both the Vite dev middleware and the Vercel
 * serverless function delegate here, so local dev and production behave
 * identically.
 */
export async function handleApi(pathname: string, search: URLSearchParams): Promise<ApiResponse> {
  try {
    const route = pathname.replace(/^\/api\/?/, "").replace(/\/$/, "");

    if (route === "news") {
      const countries = (search.get("countries") || "").split(",").filter(Boolean);
      const topics = (search.get("topics") || "").split(",").filter(Boolean);
      const query = search.get("q") || undefined;
      const data = await getNews({ countries, topics, query });
      return { status: 200, body: data };
    }

    if (route === "quote") {
      const symbols = (search.get("symbols") || "").split(",").filter(Boolean);
      if (!symbols.length) return { status: 400, body: { error: "symbols required" } };
      const data = await getQuotes(symbols);
      return { status: 200, body: data };
    }

    if (route === "history") {
      const symbol = search.get("symbol") || "";
      const range = search.get("range") || "1M";
      if (!symbol) return { status: 400, body: { error: "symbol required" } };
      const data = await getHistory(symbol, range);
      return { status: 200, body: data };
    }

    return { status: 404, body: { error: `unknown route: ${route}` } };
  } catch (err) {
    return { status: 502, body: { error: String(err instanceof Error ? err.message : err) } };
  }
}
