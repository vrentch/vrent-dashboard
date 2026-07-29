import { useCallback, useEffect, useState } from "react";
import { fetchAiStatus, aiUnlock, getAiCode, setAiCode, clearAiCode } from "./api";

export type AiState = "loading" | "off" | "locked" | "ready";

// Single source of truth for whether the paid AI features are usable on this
// device: not configured ("off"), gated behind an access code we don't yet
// hold ("locked"), or good to go ("ready").
export function useAiAccess() {
  const [status, setStatus] = useState<AiState>("loading");
  const [model, setModel] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const s = await fetchAiStatus();
      setModel(s.model);
      if (!s.configured) return setStatus("off");
      if (!s.locked) return setStatus("ready");
      const code = getAiCode();
      if (code) {
        const u = await aiUnlock(code);
        if (u.ok) return setStatus("ready");
        clearAiCode(); // stored code no longer valid (owner changed it)
      }
      setStatus("locked");
    } catch {
      setStatus("off");
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const unlock = useCallback(async (code: string): Promise<boolean> => {
    const c = code.trim();
    if (!c) return false;
    const u = await aiUnlock(c);
    if (u.ok) {
      setAiCode(c);
      setStatus("ready");
      return true;
    }
    return false;
  }, []);

  return { status, model, unlock, refresh };
}
