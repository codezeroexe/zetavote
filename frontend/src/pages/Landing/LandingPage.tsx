import React from "react";
import type { NavSection } from "../../components/Navigation/Navbar";
import { Button } from "../../components/common/Button";
import { Card } from "../../components/common/Card";

interface LandingPageProps {
  onNavigate: (section: NavSection) => void;
}

export const LandingPage: React.FC<LandingPageProps> = ({ onNavigate }) => {
  return (
    <div className="zv-landing-container">
      {/* Hero Section */}
      <section className="zv-hero">
        <div className="zv-hero-badge">
          <span className="zv-pulse-dot" aria-hidden="true" />
          SYSTEM OPERATIONAL — LOCAL NODE
        </div>
        {/* Decorative: the <h1> below is the accessible name for the brand. */}
        <img
          src="/zv-logo-light.png"
          alt=""
          className="zv-hero-logo zv-hero-logo-light"
          width={520}
          height={105}
        />
        <img
          src="/zv-logo-dark.png"
          alt=""
          className="zv-hero-logo zv-hero-logo-dark"
          width={520}
          height={143}
        />
        <h1 className="zv-hero-title">ZetaVote</h1>
        <p className="zv-hero-subtitle">
          Secure local voting infrastructure.
        </p>
        <p className="zv-hero-description">
          ZetaVote operates strictly on-device, processing encrypted voting operations
          and digital signature verifications locally via a lightweight FastAPI backend.
        </p>

        {/* Quick Action Navigation Buttons */}
        <div className="zv-hero-actions">
          <Button
            variant="primary"
            size="lg"
            onClick={() => onNavigate("admin")}
            icon={
              <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="zv-btn-icon-svg">
                <path fillRule="evenodd" d="M10 2a1 1 0 00-1 1v1a1 1 0 002 0V3a1 1 0 00-1-1zM4 9a1 1 0 011-1h10a1 1 0 110 2H5a1 1 0 01-1-1zm0 4a1 1 0 011-1h10a1 1 0 110 2H5a1 1 0 01-1-1z" clipRule="evenodd" />
              </svg>
            }
          >
            Admin Panel
          </Button>
          <Button
            variant="secondary"
            size="lg"
            onClick={() => onNavigate("voter")}
            icon={
              <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="zv-btn-icon-svg">
                <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" />
                <path fillRule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z" clipRule="evenodd" />
              </svg>
            }
          >
            Voter Portal
          </Button>
          <Button
            variant="outline"
            size="lg"
            onClick={() => onNavigate("verify")}
            icon={
              <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="zv-btn-icon-svg">
                <path fillRule="evenodd" d="M2.166 11.388a.75.75 0 011.07.155A7.5 7.5 0 0010 15.5a7.5 7.5 0 006.764-3.957.75.75 0 111.342.671A9 9 0 0110 17a9 9 0 01-8.115-4.542.75.75 0 01.281-1.07z" clipRule="evenodd" />
                <path fillRule="evenodd" d="M10 3a7.5 7.5 0 00-6.764 3.957.75.75 0 11-1.342-.671A9 9 0 0110 1.5a9 9 0 018.115 4.542.75.75 0 01-1.35.659A7.5 7.5 0 0010 3z" clipRule="evenodd" />
                <path fillRule="evenodd" d="M10 6a4 4 0 100 8 4 4 0 000-8zm-2 4a2 2 0 114 0 2 2 0 01-4 0z" clipRule="evenodd" />
              </svg>
            }
          >
            Verify Ballot
          </Button>
        </div>
      </section>

      {/* Security Features Section */}
      <section className="zv-section">
        <h2 className="zv-section-title">Security Capabilities</h2>
        <div className="zv-grid-3 zv-feature-grid">
          <Card className="zv-feature-card">
            <div className="zv-feature-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
              </svg>
            </div>
            <h3 className="zv-feature-title">Ed25519 Signatures</h3>
            <p className="zv-feature-desc">
              Every registered voter receives a uniquely derived Ed25519 cryptographic keypair
              to authenticate ballot submission and ensure non-repudiation.
            </p>
          </Card>

          <Card className="zv-feature-card">
            <div className="zv-feature-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <h3 className="zv-feature-title">AES-GCM Encryption</h3>
            <p className="zv-feature-desc">
              Votes are encrypted with AES-GCM before storage, using unique per-vote nonces
              and election-level keys derived from a master passphrase.
            </p>
          </Card>

          <Card className="zv-feature-card">
            <div className="zv-feature-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
              </svg>
            </div>
            <h3 className="zv-feature-title">Tamper-Evident Audit</h3>
            <p className="zv-feature-desc">
              All transactions generate SHA-256 commitment hashes recorded in an
              append-only hash-linked audit log, enabling universal verification.
            </p>
          </Card>

          <Card className="zv-feature-card">
            <div className="zv-feature-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </div>
            <h3 className="zv-feature-title">Receipt Verification</h3>
            <p className="zv-feature-desc">
              Voters receive cryptographic receipts proving their ballot was accepted
              without revealing their choice — commitment-based, privacy-preserving.
            </p>
          </Card>

          <Card className="zv-feature-card">
            <div className="zv-feature-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
            </div>
            <h3 className="zv-feature-title">Verifiable Tally & Merkle Root</h3>
            <p className="zv-feature-desc">
              Decrypted tallies produce choice breakdowns with a published Merkle root,
              allowing anyone to verify results match accepted ballots.
            </p>
          </Card>
        </div>
      </section>

      {/* Scope Disclaimer */}
      <section className="zv-disclaimer-box">
        <div className="zv-disclaimer-header">
          <svg className="zv-disclaimer-icon" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
          </svg>
          <span className="zv-disclaimer-title">System Notice & Prototype Scope</span>
        </div>
        <p className="zv-disclaimer-text">
          ZetaVote is an academic proof-of-concept for secure, local cryptographic voting.
          This system is designed strictly for local demonstration and research purposes and is
          not intended for binding, real-world governmental or commercial elections.
        </p>
      </section>
    </div>
  );
};
