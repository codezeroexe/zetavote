import React, { useCallback, useEffect, useState } from "react";
import { api } from "../../services/api";

type StatusState = "checking" | "online" | "offline";

export const BackendStatus: React.FC = () => {
  const [status, setStatus] = useState<StatusState>("checking");
  const [isRetrying, setIsRetrying] = useState(false);

  const checkStatus = useCallback(async () => {
    setIsRetrying(true);
    try {
      const res = await api.checkHealth();
      setStatus(res && res.status === "ok" ? "online" : "offline");
    } catch {
      setStatus("offline");
    } finally {
      setIsRetrying(false);
    }
  }, []);

  useEffect(() => {
    void checkStatus();
  }, [checkStatus]);

  return (
    <div className={`zv-status-indicator status-${status}`} role="status" aria-live="polite">
      <span className="zv-status-dot" aria-hidden="true" />
      <span className="zv-status-text">
        {status === "checking" && "Checking Backend..."}
        {status === "online" && "Backend Online"}
        {status === "offline" && "Backend Offline"}
      </span>
      {status === "offline" && (
        <button
          type="button"
          className="zv-status-retry-btn"
          onClick={() => void checkStatus()}
          disabled={isRetrying}
          aria-label="Retry connection to backend"
          title="Retry connecting to FastAPI backend"
        >
          {isRetrying ? "..." : "Retry"}
        </button>
      )}
    </div>
  );
};
