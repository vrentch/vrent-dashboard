import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** Bump this (e.g. the active tab) to auto-clear the error on navigation. */
  resetKey?: string | number;
}
interface State {
  error: Error | null;
}

/**
 * Catches any render error so a single glitchy screen never white-screens the
 * whole app. Shows a friendly fallback with a retry; navigating (resetKey
 * change) clears it automatically.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-[60vh] grid place-items-center px-6">
          <div className="max-w-sm w-full rounded-3xl glass p-6 text-center">
            <div className="text-3xl mb-2">😕</div>
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Something went wrong on this screen</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">The rest of the app is fine — try again.</p>
            <button
              onClick={() => this.setState({ error: null })}
              className="mt-4 w-full py-2.5 rounded-xl bg-slate-900 dark:bg-slate-700 text-white text-sm font-semibold active:scale-[0.98]"
            >
              Try again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
