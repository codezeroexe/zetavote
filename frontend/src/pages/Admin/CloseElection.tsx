import React, { useState } from "react";
import type { CloseElectionResponse } from "../../types/api";
import { api, toMessage } from "../../services/api";
import { Card } from "../../components/common/Card";
import { Button } from "../../components/common/Button";
import { Alert } from "../../components/common/Alert";

export const CloseElection: React.FC = () => {
  const [electionId, setElectionId] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [showConfirm, setShowConfirm] = useState(false);

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CloseElectionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = electionId.trim() !== "" && passphrase.trim() !== "";

  const handleRequestClose = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setShowConfirm(true);
  };

  const handleConfirmClose = async () => {
    setLoading(true);
    setResult(null);
    setError(null);
    setShowConfirm(false);

    try {
      const res = await api.closeElection(electionId.trim(), {
        master_passphrase: passphrase,
      });
      setResult(res);
      setPassphrase("");
    } catch (err: unknown) {
      setError(toMessage(err, "Failed to close election"));
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setElectionId("");
    setPassphrase("");
    setShowConfirm(false);
    setResult(null);
    setError(null);
  };

  return (
    <Card className="zv-card-danger">
      {result ? (
        <div className="zv-admin-result">
          <Alert
            type="success"
            title="Election Closed"
            message={`Election "${result.election_id}" has been permanently closed. No further votes will be accepted.`}
          />
          <div className="zv-result-details">
            <div className="zv-result-row">
              <span className="zv-result-label">Election ID</span>
              <code className="zv-result-value">{result.election_id}</code>
            </div>
            <div className="zv-result-row">
              <span className="zv-result-label">Status</span>
              <span className="zv-result-value zv-result-status-closed">
                {result.status.toUpperCase()}
              </span>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={handleReset}>
            Close Another Election
          </Button>
        </div>
      ) : (
        <form className="zv-form" onSubmit={handleRequestClose}>
          {error && <Alert type="error" title="Close Failed" message={error} />}

          {showConfirm && (
            <div className="zv-confirm-box" role="alert">
              <div className="zv-confirm-header">
                <svg className="zv-confirm-icon" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                <span className="zv-confirm-title">Confirm Irreversible Action</span>
              </div>
              <p className="zv-confirm-text">
                Closing election <code>{electionId.trim()}</code> is permanent.
                No further votes will be accepted. This action cannot be undone.
              </p>
              <div className="zv-confirm-actions">
                <Button
                  type="button"
                  variant="danger"
                  isLoading={loading}
                  onClick={() => void handleConfirmClose()}
                >
                  Confirm Close
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setShowConfirm(false)}
                  disabled={loading}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}

          <label className="zv-form-label">
            <span className="zv-label-text">
              Election ID <span className="zv-required">*</span>
            </span>
            <input
              type="text"
              className="zv-input"
              placeholder="ID of the election to close"
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

          {!showConfirm && (
            <div className="zv-form-actions">
              <Button
                type="submit"
                variant="danger"
                isLoading={loading}
                disabled={!canSubmit}
              >
                Close Election
              </Button>
            </div>
          )}
        </form>
      )}
    </Card>
  );
};
