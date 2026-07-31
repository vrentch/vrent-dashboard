import { useEffect, useRef } from "react";

// Runs `fn` on an interval, but only while the tab is visible (no wasted work
// or battery in the background), and immediately whenever the app is brought
// back to the foreground. Used to keep news & markets ~1 minute fresh.
export function usePoll(fn: () => void, ms: number) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const tick = () => { if (document.visibilityState === "visible") ref.current(); };
    const id = window.setInterval(tick, ms);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [ms]);
}
