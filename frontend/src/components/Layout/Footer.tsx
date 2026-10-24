import React from "react";

export const Footer: React.FC = () => {
  return (
    <footer className="zv-footer">
      <div className="zv-footer-container">
        <div className="zv-footer-info">
          <p className="zv-footer-title">ZetaVote</p>
          <p className="zv-footer-desc">
            On-device cryptographic voting prototype. Not intended for binding
            elections.
          </p>
        </div>
        <div className="zv-footer-meta">
          <span className="zv-footer-badge">Local-Only Mode</span>
          <span className="zv-footer-badge">Ed25519 Signed</span>
          <span className="zv-footer-badge">AES-GCM Encrypted</span>
        </div>
      </div>
    </footer>
  );
};
