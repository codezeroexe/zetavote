import React, { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { api } from "../../services/api";
import { isOnline, setOnline, subscribeOnline } from "../../services/online";

type StatusState = "checking" | "online" | "offline";

export const BackendStatus: React.FC = () => {
  const [status, setStatus] = useState<StatusState>("checking");
  // Not derivable from `status`: the retry button stays mounted while the check
  // is in flight, so flipping to "checking" would make it vanish mid-click.
  const [retrying, setRetrying] = useState(false);

  const checkStatus = useCallback(async () => {
    setRetrying(true);
    try {
      const res = await api.checkHealth();
      const up = Boolean(res) && res.status === "ok";
      setStatus(up ? "online" : "offline");
      setOnline(up);
    } catch {
      setStatus("offline");
      setOnline(false);
    } finally {
      setRetrying(false);
    }
  }, []);

  useEffect(() => {
    void checkStatus();
  }, [checkStatus]);

  // Re-check on the way back to the tab. A local server is often restarted by
  // hand, and without this the pill stays on "Offline" through a working app
  // until the page is reloaded.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void checkStatus();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);
    window.addEventListener("offline", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
      window.removeEventListener("offline", onVisible);
    };
  }, [checkStatus]);

  return (
    <div className={`zv-status-indicator status-${status}`}>
      {/* The live region is on the text, not on the wrapper. A live region that
          contains the Retry button re-announces a focusable control whenever the
          state changes, and below 560px the text is visually hidden — so the
          region has to be the label, not the whole pill. */}
      <span className="zv-status-dot" aria-hidden="true" />
      <span className="zv-status-text" role="status" aria-live="polite">
        {status === "checking" && "Checking server…"}
        {status === "online" && "Server online"}
        {status === "offline" && "Server offline"}
      </span>
      {status === "offline" && (
        <button
          type="button"
          className="zv-status-retry-btn"
          onClick={() => void checkStatus()}
          disabled={retrying}
          aria-label="Retry connection to the server"
          title="Retry connecting to the server"
        >
          {retrying ? "…" : "Retry"}
        </button>
      )}
    </div>
  );
};

/**
 * The banner, once, above the page — with the command that fixes it. It reads the
 * same observable the pill writes to, so there is no second source of truth.
 */
export const OfflineBanner: React.FC = () => {
  const offline = !useSyncExternalStore(subscribeOnline, isOnline, isOnline);
  if (!offline) return null;

  return (
    <div className="zv-offline-banner" role="alert">
      <div className="zv-offline-inner">
        <strong>The ZetaVote server is not responding.</strong>{" "}
        <span>
          Nothing will be saved until it is back. Start it from the project
          folder with <code>python run.py</code>, then this clears itself.
        </span>
      </div>
    </div>
  );
};
