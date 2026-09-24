import { useEffect, useState } from "react";
import "./App.css";

const API_BASE = "http://localhost:8080";

type Status = "connecting" | "ok" | "error";

function App() {
  const [status, setStatus] = useState<Status>("connecting");

  useEffect(() => {
    const checkHealth = async () => {
      try {
        const response = await fetch(`${API_BASE}/health`);
        setStatus(response.ok ? "ok" : "error");
      } catch {
        setStatus("error");
      }
    };

    void checkHealth();
  }, []);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Local secure voting</p>
          <h1>ZetaVote</h1>
        </div>

        <div className={`status-pill status-${status}`}>
          {status === "connecting" && "Checking backend…"}
          {status === "ok" && "Backend online"}
          {status === "error" && "Backend offline"}
        </div>
      </header>

      <main className="dashboard">
        <section className="panel hero-panel">
          <p className="eyebrow">Frontend handoff</p>
          <h2>Clean starter shell</h2>
          <p>
            This frontend is intentionally stripped back to a minimal starting
            point for a teammate to build the actual user interface.
          </p>
        </section>

        <section className="metrics">
          <article className="metric-card">
            <span className="label">Status</span>
            <strong>
              {status === "ok"
                ? "Healthy"
                : status === "error"
                  ? "Down"
                  : "Checking"}
            </strong>
          </article>
          <article className="metric-card">
            <span className="label">Mode</span>
            <strong>Local-only</strong>
          </article>
          <article className="metric-card">
            <span className="label">Stack</span>
            <strong>React + Vite</strong>
          </article>
        </section>
      </main>
    </div>
  );
}

export default App;
