import React from "react";
import { CreateElection } from "./CreateElection";
import { CloseElection } from "./CloseElection";
import { TallyElection } from "./TallyElection";

export const AdminPage: React.FC = () => {
  return (
    <div className="zv-page-container">
      <header className="zv-page-header">
        <div className="zv-page-badge">ADMIN CONTROL</div>
        <h1 className="zv-page-title">Election Administration</h1>
        <p className="zv-page-subtitle">
          Election management and secure tally operations.
        </p>
      </header>

      <div className="zv-admin-sections">
        <section className="zv-admin-section" aria-labelledby="create-election-heading">
          <header className="zv-admin-section-header">
            <h2 id="create-election-heading" className="zv-admin-section-title">Create Election</h2>
            <p className="zv-admin-section-desc">
              Initialize a new election with cryptographic infrastructure.
            </p>
          </header>
          <CreateElection />
        </section>

        <div className="zv-admin-row">
          <section className="zv-admin-section" aria-labelledby="close-election-heading">
            <header className="zv-admin-section-header">
              <span className="zv-admin-section-eyebrow zv-admin-section-eyebrow--danger">
                Danger Zone
              </span>
              <h2 id="close-election-heading" className="zv-admin-section-title">Close Election</h2>
              <p className="zv-admin-section-desc">
                Permanently close voting for an active election.
              </p>
            </header>
            <CloseElection />
          </section>

          <section className="zv-admin-section" aria-labelledby="tally-election-heading">
            <header className="zv-admin-section-header">
              <h2 id="tally-election-heading" className="zv-admin-section-title">Tally Election</h2>
              <p className="zv-admin-section-desc">
                Decrypt ballots and compute verifiable vote totals.
              </p>
            </header>
            <TallyElection />
          </section>
        </div>
      </div>
    </div>
  );
};
