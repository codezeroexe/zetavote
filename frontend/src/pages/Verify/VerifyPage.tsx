import React, { useState } from "react";
import type { VerifyVoteResponse } from "../../types/api";
import { api, toMessage } from "../../services/api";
import { Card } from "../../components/common/Card";
import { Button } from "../../components/common/Button";
import { Alert } from "../../components/common/Alert";

export const VerifyPage: React.FC = () => {
  const [electionId, setElectionId] = useState("");
  const [commitment, setCommitment] = useState("");

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<VerifyVoteResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = electionId.trim() !== "" && commitment.trim() !== "";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || loading) return;

    setLoading(true);
    setResult(null);
    setError(null);

    try {
      const res = await api.verifyVote(electionId.trim(), commitment.trim());
      setResult(res);
    } catch (err: unknown) {
      setError(toMessage(err, "Ballot verification failed"));
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setElectionId("");
    setCommitment("");
    setResult(null);
    setError(null);
  };

  return (
    <div className="zv-page-container">
      <header className="zv-page-header">
        <div className="zv-page-badge">VERIFICATION SUITE</div>
        <h1 className="zv-page-title">Ballot &amp; Commitment Verification</h1>
        <p className="zv-page-subtitle">
          Verify vote inclusion and cryptographic record integrity without compromising ballot secrecy.
        </p>
      </header>

      <div className="zv-admin-sections">
        <section className="zv-admin-section" aria-labelledby="verify-ballot-heading">
          <header className="zv-admin-section-header">
            <h2 id="verify-ballot-heading" className="zv-admin-section-title">Verify Ballot Inclusion</h2>
            <p className="zv-admin-section-desc">
              Query the public ledger using your unique ballot commitment hash.
            </p>
          </header>
          <Card>
            {result ? (
              <div className="zv-admin-result zv-verify-success">
                <Alert
                  type="success"
                  title="✓ Ballot Valid"
                  message="This ballot commitment is authentic and officially recorded in the election database."
                />

                <div className="zv-result-details">
                  <div className="zv-result-row">
                    <span className="zv-result-label">Status</span>
                    <span className="zv-result-value zv-result-valid">
                      {result.valid ? "✓ RECORDED & VALID" : "INVALID"}
                    </span>
                  </div>
                  <div className="zv-result-row">
                    <span className="zv-result-label">Election ID</span>
                    <code className="zv-result-value">{result.election_id}</code>
                  </div>
                  <div className="zv-result-row">
                    <span className="zv-result-label">Voter ID</span>
                    <code className="zv-result-value zv-mono">{result.voter_id}</code>
                  </div>
                  <div className="zv-result-row">
                    <span className="zv-result-label">Timestamp</span>
                    <span className="zv-result-value">
                      {new Date(result.timestamp).toLocaleString()}
                    </span>
                  </div>
                </div>

                <div className="zv-merkle-root">
                  <span className="zv-merkle-label">Verified Commitment Hash</span>
                  <code className="zv-merkle-hash">{result.commitment}</code>
                </div>

                <Alert
                  type="info"
                  title="Ballot Secrecy Maintained"
                  message="The verification result does not reveal the selected vote."
                />

                <div className="zv-form-actions">
                  <Button variant="outline" size="sm" onClick={handleReset}>
                    Verify Another Ballot
                  </Button>
                </div>
              </div>
            ) : (
              <form className="zv-form zv-verify-form" onSubmit={(e) => void handleSubmit(e)}>
                {error && (
                  <div className="zv-verify-failure">
                    <Alert
                      type="error"
                      title="Verification Failed"
                      message={error}
                    />
                  </div>
                )}

              <label className="zv-form-label">
                <span className="zv-label-text">
                  Election ID <span className="zv-required">*</span>
                </span>
                <input
                  type="text"
                  className="zv-input"
                  placeholder="e.g. election_2026"
                  value={electionId}
                  onChange={(e) => setElectionId(e.target.value)}
                  required
                  autoComplete="off"
                  disabled={loading}
                />
              </label>

              <label className="zv-form-label">
                <span className="zv-label-text">
                  Ballot Commitment <span className="zv-required">*</span>
                </span>
                <input
                  type="text"
                  className="zv-input zv-mono"
                  placeholder="Enter 64-character SHA-256 commitment hash"
                  value={commitment}
                  onChange={(e) => setCommitment(e.target.value)}
                  required
                  autoComplete="off"
                  disabled={loading}
                />
                <span className="zv-form-hint">
                  Provided in your vote receipt after ballot submission.
                </span>
              </label>

              <div className="zv-form-actions">
                <Button
                  type="submit"
                  variant="primary"
                  isLoading={loading}
                  disabled={!canSubmit}
                >
                  Verify Ballot
                </Button>
              </div>
            </form>
          )}
        </Card>
      </section>
    </div>
  </div>
  );
};
