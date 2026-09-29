import React from "react";
import { RegisterVoter } from "./RegisterVoter";
import { CastVote } from "./CastVote";

export const VoterPage: React.FC = () => {
  return (
    <div className="zv-page-container">
      <header className="zv-page-header">
        <div className="zv-page-badge">VOTER PORTAL</div>
        <h1 className="zv-page-title">Voter Registration &amp; Voting</h1>
        <p className="zv-page-subtitle">
          Register your cryptographic identity, then cast a signed and encrypted ballot.
        </p>
      </header>

      <div className="zv-admin-sections">
        <div className="zv-admin-row">
          <section className="zv-admin-section" aria-labelledby="register-identity-heading">
            <header className="zv-admin-section-header">
              <h2 id="register-identity-heading" className="zv-admin-section-title">Register Identity</h2>
              <p className="zv-admin-section-desc">
                Generate an Ed25519 keypair and register for an election.
              </p>
            </header>
            <RegisterVoter />
          </section>
          <section className="zv-admin-section" aria-labelledby="cast-vote-heading">
            <header className="zv-admin-section-header">
              <h2 id="cast-vote-heading" className="zv-admin-section-title">Cast Vote</h2>
              <p className="zv-admin-section-desc">
                Submit a signed, encrypted ballot to an active election.
              </p>
            </header>
            <CastVote />
          </section>
        </div>
      </div>
    </div>
  );
};
