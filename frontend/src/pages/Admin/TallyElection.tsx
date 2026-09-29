import React, { useState } from "react";
import type { TallyResponse } from "../../types/api";
import { api, toMessage } from "../../services/api";
import { Card } from "../../components/common/Card";
import { Button } from "../../components/common/Button";
import { Alert } from "../../components/common/Alert";

export const TallyElection: React.FC = () => {
  const [electionId, setElectionId] = useState("");
  const [passphrase, setPassphrase] = useState("");

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TallyResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = electionId.trim() !== "" && passphrase.trim() !== "";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || loading) return;

    setLoading(true);
    setResult(null);
    setError(null);

    try {
      const res = await api.tallyElection(electionId.trim(), {
        master_passphrase: passphrase,
      });
      setResult(res);
      setPassphrase("");
    } catch (err: unknown) {
      setError(toMessage(err, "Failed to tally election"));
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setElectionId("");
    setPassphrase("");
    setResult(null);
    setError(null);
  };

  const sortedChoices = result
    ? Object.entries(result.choice_breakdown).sort(([, a], [, b]) => b - a)
    : [];

  return (
    <Card>
      {result ? (
        <div className="zv-admin-result">
          <Alert
            type="success"
            title="Tally Complete"
            message={`Election "${result.election_id}" has been tallied with ${result.total_votes} total vote${result.total_votes !== 1 ? "s" : ""}.`}
          />

          <div className="zv-result-details">
            <div className="zv-result-row">
              <span className="zv-result-label">Election ID</span>
              <code className="zv-result-value">{result.election_id}</code>
            </div>
            <div className="zv-result-row">
              <span className="zv-result-label">Status</span>
              <span className="zv-result-value">{result.status.toUpperCase()}</span>
            </div>
            <div className="zv-result-row">
              <span className="zv-result-label">Total Votes</span>
              <span className="zv-result-value zv-result-total">{result.total_votes}</span>
            </div>
          </div>

          {/* Choice Breakdown */}
          {sortedChoices.length > 0 && (
            <div className="zv-tally-breakdown">
              <h4 className="zv-tally-breakdown-title">Choice Breakdown</h4>
              <div className="zv-tally-bars">
                {sortedChoices.map(([choice, count]) => {
                  const pct = result.total_votes > 0
                    ? Math.round((count / result.total_votes) * 100)
                    : 0;
                  return (
                    <div key={choice} className="zv-tally-row">
                      <div className="zv-tally-row-header">
                        <span className="zv-tally-choice">{choice}</span>
                        <span className="zv-tally-count">
                          {count} vote{count !== 1 ? "s" : ""} ({pct}%)
                        </span>
                      </div>
                      <div className="zv-tally-bar-track">
                        <div
                          className="zv-tally-bar-fill"
                          style={{ width: `${pct}%` }}
                          role="progressbar"
                          aria-valuenow={pct}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-label={`${choice}: ${pct}%`}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {sortedChoices.length === 0 && (
            <Alert type="info" message="No votes were cast in this election." />
          )}

          {/* Merkle Root */}
          <div className="zv-merkle-root">
            <span className="zv-merkle-label">Merkle Root</span>
            <code className="zv-merkle-hash">{result.merkle_root}</code>
          </div>

          <Button variant="outline" size="sm" onClick={handleReset}>
            Tally Another Election
          </Button>
        </div>
      ) : (
        <form className="zv-form" onSubmit={(e) => void handleSubmit(e)}>
          {error && <Alert type="error" title="Tally Failed" message={error} />}

          <label className="zv-form-label">
            <span className="zv-label-text">
              Election ID <span className="zv-required">*</span>
            </span>
            <input
              type="text"
              className="zv-input"
              placeholder="ID of the election to tally"
              value={electionId}
              onChange={(e) => setElectionId(e.target.value)}
              required
              autoComplete="off"
              disabled={loading}
            />
          </label>

          <label className="zv-form-label">
            <span className="zv-label-text">
              Master Passphrase <span className="zv-required">*</span>
            </span>
            <input
              type="password"
              className="zv-input"
              placeholder="Election master passphrase"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              required
              autoComplete="off"
              disabled={loading}
            />
          </label>

          <div className="zv-form-actions">
            <Button
              type="submit"
              variant="primary"
              isLoading={loading}
              disabled={!canSubmit}
            >
              Calculate Tally
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
};
