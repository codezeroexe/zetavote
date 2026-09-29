import React, { useState } from "react";
import type { VoteCastResponse } from "../../types/api";
import { api, toMessage } from "../../services/api";
import { downloadJson } from "../../services/download";
import { Card } from "../../components/common/Card";
import { Button } from "../../components/common/Button";
import { Alert } from "../../components/common/Alert";

export const CastVote: React.FC = () => {
  const [electionId, setElectionId] = useState("");
  const [voterId, setVoterId] = useState("");
  const [choice, setChoice] = useState("");
  const [passphrase, setPassphrase] = useState("");

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<VoteCastResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canSubmit =
    electionId.trim() !== "" &&
    voterId.trim() !== "" &&
    choice.trim() !== "" &&
    passphrase.trim() !== "";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || loading) return;

    setLoading(true);
    setResult(null);
    setError(null);

    const voteNonce = crypto.randomUUID();

    try {
      const res = await api.castVote(electionId.trim(), {
        voter_id: voterId.trim(),
        choice: choice.trim(),
        vote_nonce: voteNonce,
        passphrase,
      });
      setResult(res);
      setPassphrase("");
    } catch (err: unknown) {
      setError(toMessage(err, "Vote submission failed"));
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadReceipt = () => {
    if (!result) return;
    downloadJson(
      {
        election_id: result.election_id,
        ballot_commitment: result.ballot_commitment,
        signature_valid: result.signature_valid,
        timestamp: result.receipt.timestamp,
      },
      `vote_receipt_${result.ballot_commitment.slice(0, 8)}.json`
    );
  };

  const handleReset = () => {
    setElectionId("");
    setVoterId("");
    setChoice("");
    setPassphrase("");
    setResult(null);
    setError(null);
  };

  return (
    <Card>
      {result ? (
        <div className="zv-admin-result zv-vote-success">
          <Alert
            type="success"
            title="Vote Submitted"
            message={`Your ballot has been cryptographically signed, encrypted, and recorded for election "${result.election_id}".`}
          />

          <div className="zv-result-details">
            <div className="zv-result-row">
              <span className="zv-result-label">Election ID</span>
              <code className="zv-result-value">{result.election_id}</code>
            </div>
            <div className="zv-result-row">
              <span className="zv-result-label">Signature Valid</span>
              <span className={`zv-result-value ${result.signature_valid ? "zv-result-valid" : "zv-result-invalid"}`}>
                {result.signature_valid ? "✓ VERIFIED" : "✗ INVALID"}
              </span>
            </div>
            <div className="zv-result-row">
              <span className="zv-result-label">Timestamp</span>
              <span className="zv-result-value">
                {new Date(result.receipt.timestamp).toLocaleString()}
              </span>
            </div>
          </div>

          {/* Ballot commitment in its own prominent block */}
          <div className="zv-merkle-root">
            <span className="zv-merkle-label">Ballot Commitment</span>
            <code className="zv-merkle-hash">{result.ballot_commitment}</code>
          </div>

          <Alert
            type="info"
            message="Save your ballot commitment. You can use it to verify your vote was included in the final tally."
          />

          <div className="zv-form-actions">
            <Button variant="primary" size="sm" onClick={handleDownloadReceipt}>
              Download Vote Receipt
            </Button>
            <Button variant="outline" size="sm" onClick={handleReset}>
              Cast Another Vote
            </Button>
          </div>
        </div>
      ) : (
        <form className="zv-form zv-cast-form" onSubmit={(e) => void handleSubmit(e)}>
          {error && <Alert type="error" title="Vote Failed" message={error} />}

          <label className="zv-form-label">
            <span className="zv-label-text">
              Election ID <span className="zv-required">*</span>
            </span>
            <input
              type="text"
              className="zv-input zv-mono"
              placeholder="ID of the active election"
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
              className="zv-input zv-mono"
              placeholder="Your registered voter ID"
              value={voterId}
              onChange={(e) => setVoterId(e.target.value)}
              required
              autoComplete="off"
              disabled={loading}
            />
          </label>

          <label className="zv-form-label zv-choice-field">
            <span className="zv-label-text">
              Choice <span className="zv-required">*</span>
            </span>
            <input
              type="text"
              className="zv-input zv-choice-input"
              placeholder="Your vote choice (e.g. candidate name)"
              value={choice}
              onChange={(e) => setChoice(e.target.value)}
              required
              autoComplete="off"
              disabled={loading}
            />
            <span className="zv-form-hint">
              Enter the exact choice identifier. A unique nonce will be generated automatically.
            </span>
          </label>

          <label className="zv-form-label">
            <span className="zv-label-text">
              Passphrase <span className="zv-required">*</span>
            </span>
            <input
              type="password"
              className="zv-input"
              placeholder="Your registration passphrase"
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
              Submit Ballot
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
};
