import React, { useState } from "react";
import type { VoterRegistrationResponse } from "../../types/api";
import { api, toMessage } from "../../services/api";
import { downloadJson } from "../../services/download";
import { Card } from "../../components/common/Card";
import { Button } from "../../components/common/Button";
import { Alert } from "../../components/common/Alert";

export const RegisterVoter: React.FC = () => {
  const [electionId, setElectionId] = useState("");
  const [voterId, setVoterId] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [confirmPassphrase, setConfirmPassphrase] = useState("");

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<VoterRegistrationResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mismatch = confirmPassphrase !== "" && passphrase !== confirmPassphrase;
  const canSubmit =
    electionId.trim() !== "" &&
    voterId.trim() !== "" &&
    passphrase.trim() !== "" &&
    confirmPassphrase.trim() !== "" &&
    !mismatch;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || loading) return;

    setLoading(true);
    setResult(null);
    setError(null);

    try {
      const res = await api.registerVoter(electionId.trim(), {
        voter_id: voterId.trim(),
        passphrase,
      });
      setResult(res);
      setPassphrase("");
      setConfirmPassphrase("");
    } catch (err: unknown) {
      setError(toMessage(err, "Registration failed"));
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadReceipt = () => {
    if (!result) return;
    downloadJson(result.receipt, `registration_receipt_${result.receipt.voter_id_hash}.json`);
  };

  const handleReset = () => {
    setElectionId("");
    setVoterId("");
    setPassphrase("");
    setConfirmPassphrase("");
    setResult(null);
    setError(null);
  };

  return (
    <Card>
      {result ? (
        <div className="zv-admin-result zv-register-success">
          <Alert
            type="success"
            title="Registration Successful"
            message={`Voter "${result.voter_id}" is now registered for election "${result.election_id}".`}
          />

          <div className="zv-result-details">
            <div className="zv-result-row">
              <span className="zv-result-label">Election ID</span>
              <code className="zv-result-value">{result.receipt.election_id}</code>
            </div>
            <div className="zv-result-row">
              <span className="zv-result-label">Voter ID Hash</span>
              <code className="zv-result-value zv-mono">{result.receipt.voter_id_hash}</code>
            </div>
            <div className="zv-result-row">
              <span className="zv-result-label">Timestamp</span>
              <span className="zv-result-value">
                {new Date(result.receipt.timestamp).toLocaleString()}
              </span>
            </div>
            <div className="zv-result-row">
              <span className="zv-result-label">Commitment</span>
              <code className="zv-result-value zv-mono zv-hash-truncate">
                {result.receipt.registration_commitment}
              </code>
            </div>
          </div>

          <Alert
            type="warning"
            title="Security Notice"
            message="Your private key has been encrypted and stored locally by the backend. Remember your passphrase — it cannot be recovered."
          />

          <div className="zv-form-actions">
            <Button variant="primary" size="sm" onClick={handleDownloadReceipt}>
              Download Receipt
            </Button>
            <Button variant="outline" size="sm" onClick={handleReset}>
              Register Another Voter
            </Button>
          </div>
        </div>
      ) : (
        <form className="zv-form" onSubmit={(e) => void handleSubmit(e)}>
          {error && <Alert type="error" title="Registration Failed" message={error} />}

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
              Voter ID <span className="zv-required">*</span>
            </span>
            <input
              type="text"
              className="zv-input"
              placeholder="e.g. voter_001"
              value={voterId}
              onChange={(e) => setVoterId(e.target.value)}
              required
              autoComplete="off"
              disabled={loading}
            />
          </label>

          <label className="zv-form-label">
            <span className="zv-label-text">
              Passphrase <span className="zv-required">*</span>
            </span>
            <input
              type="password"
              className="zv-input"
              placeholder="Used to encrypt your private key"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              required
              autoComplete="new-password"
              disabled={loading}
            />
          </label>

          <label className="zv-form-label">
            <span className="zv-label-text">
              Confirm Passphrase <span className="zv-required">*</span>
            </span>
            <input
              type="password"
              className={`zv-input ${mismatch ? "zv-input-error" : ""}`}
              placeholder="Re-enter your passphrase"
              value={confirmPassphrase}
              onChange={(e) => setConfirmPassphrase(e.target.value)}
              required
              autoComplete="new-password"
              disabled={loading}
            />
            {mismatch && (
              <span className="zv-form-error-hint">Passphrases do not match</span>
            )}
          </label>

          <div className="zv-form-actions">
            <Button
              type="submit"
              variant="primary"
              isLoading={loading}
              disabled={!canSubmit}
            >
              Register Voter
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
};
