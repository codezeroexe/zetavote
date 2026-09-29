import React from "react";

export const Footer: React.FC = () => {
  return (
    <footer className="zv-footer">
      <div className="zv-footer-container">
        <div className="zv-footer-info">
          <p className="zv-footer-title">ZetaVote Local Security Infrastructure</p>
          <p className="zv-footer-desc">
            On-device cryptographic voting prototype running locally with FastAPI backend.
          </p>
        </div>
        <div className="zv-footer-meta">
          <span className="zv-footer-badge">Local-Only Mode</span>
          <span className="zv-footer-badge">Ed25519 Signed</span>
          <span className="zv-footer-badge">FastAPI v0.1.0</span>
        </div>
      </div>
    </footer>
  );
};
