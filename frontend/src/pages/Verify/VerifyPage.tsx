import React, { useEffect, useState } from "react";
import type { VerifyVoteResponse } from "../../types/api";
import { api } from "../../services/api";
import { useSubmit } from "../../hooks/useSubmit";
import { looksLikeHash, normaliseHash } from "../../services/format";
import { Card } from "../../components/common/Card";
import { Button } from "../../components/common/Button";
import { Alert } from "../../components/common/Alert";
import { Field } from "../../components/common/Field";
import { HashBlock } from "../../components/common/CopyButton";

/** A commitment checked on this machine, so the same receipt is one click away. */
const LAST_VERIFIED_KEY = "zetavote-last-verified";

function rememberLast(electionId: string, commitment: string): void {
  try {
    localStorage.setItem(
      LAST_VERIFIED_KEY,
      JSON.stringify({ electionId, commitment }),
    );
  } catch {
    // Not being able to remember is not worth reporting.
  }
}

function recallLast(): { electionId: string; commitment: string } | null {
  try {
    const raw = localStorage.getItem(LAST_VERIFIED_KEY);
    return raw ? (JSON.parse(raw) as { electionId: string; commitment: string }) : null;
  } catch {
    return null;
  }
}

export const VerifyPage: React.FC = () => {
  const [electionId, setElectionId] = useState("");
  const [commitment, setCommitment] = useState("");
  const [recalled, setRecalled] = useState<{ electionId: string; commitment: string } | null>(null);

  const { loading, result, error, run, clear } =
    useSubmit<VerifyVoteResponse>();

  // The commonest case by far is checking the same receipt twice, or checking one
  // this browser produced. Both values are still on the machine.
  useEffect(() => {
    const last = recallLast();
    if (last === null) return;
    setRecalled(last);
    setElectionId(last.electionId);
    setCommitment(last.commitment);
  }, []);

  const malformed = commitment.trim() !== "" && !looksLikeHash(commitment);
  const canSubmit =
    electionId.trim() !== "" && commitment.trim() !== "" && !malformed;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || loading) return;

    // Compared as the server compares it. A commitment read out of a JSON file
    // can carry different casing or a wrapped newline, and treating that as
    // "not recorded" is the one answer this page must never give about a valid
    // ballot.
    const value = normaliseHash(commitment);
    const id = electionId.trim();

    const answer = await run(() => api.verifyVote(id, value), {
      fallbackMessage: "Ballot verification failed",
    });
    // Remembered only once the server has answered, so the field never pre-fills
    // with something that was never actually checked.
    if (answer !== null) rememberLast(id, value);
  };

  const handleReset = () => {
    setElectionId("");
    setCommitment("");
    clear();
  };

  // The banner is driven by the answer. It used to read "✓ Ballot Valid" the
  // moment a response arrived, thirteen lines above a row reading "INVALID".
  const verdict = result
    ? result.valid && result.checks.audit_chain_valid && result.checks.in_audit_chain
      ? { type: "success" as const, title: "Ballot valid", message: "This ballot commitment is authentic and recorded. The signature, the ballot id and the audit chain all check out." }
      : { type: "error" as const, title: "Not a valid ballot", message: "One or more checks failed. The details below say which — do not treat this ballot as counted." }
    : null;

  return (
    <div className="zv-page-container">
      <header className="zv-page-header">
        <h1 className="zv-page-title">Check a ballot</h1>
        <p className="zv-page-subtitle">
          Open to anyone — no account needed. Confirms that a ballot commitment
          was recorded, without revealing how that person voted.
        </p>
      </header>

      <div className="zv-admin-sections">
        <section className="zv-admin-section" aria-labelledby="verify-ballot-heading">
          <header className="zv-admin-section-header">
            <h2 id="verify-ballot-heading" className="zv-admin-section-title">
              Verify a ballot was counted
            </h2>
            <p className="zv-admin-section-desc">
              Paste the election id and the ballot commitment from a vote receipt.
            </p>
          </header>
          <Card>
            {result && verdict ? (
              <div className="zv-receipt">
                <Alert
                  type={verdict.type}
                  title={verdict.title}
                  message={verdict.message}
                />

                <div className="zv-result-details">
                  <div className="zv-result-row">
                    <span className="zv-result-label">Status</span>
                    <span
                      className={`zv-result-value ${
                        result.valid
                          ? "zv-result-valid"
                          : "zv-result-invalid"
                      }`}
                    >
                      {result.valid ? "RECORDED & VALID" : "INVALID"}
                    </span>
                  </div>
                  <div className="zv-result-row">
                    <span className="zv-result-label">Election id</span>
                    <code className="zv-result-value zv-mono">
                      {result.election_id}
                    </code>
                  </div>
                  <div className="zv-result-row">
                    <span className="zv-result-label">Signature</span>
                    <span
                      className={`zv-result-value ${
                        result.checks.signature_valid
                          ? "zv-result-valid"
                          : "zv-result-invalid"
                      }`}
                    >
                      {result.checks.signature_valid ? "VALID" : "INVALID"}
                    </span>
                  </div>
                  <div className="zv-result-row">
                    <span className="zv-result-label">Ballot ID Consistent</span>
                    <span
                      className={`zv-result-value ${
                        result.checks.ballot_id_consistent
                          ? "zv-result-valid"
                          : "zv-result-invalid"
                      }`}
                    >
                      {result.checks.ballot_id_consistent
                        ? "MATCHES"
                        : "MISMATCH"}
                    </span>
                  </div>
                  <div className="zv-result-row">
                    <span className="zv-result-label">In Audit Chain</span>
                    <span
                      className={`zv-result-value ${
                        result.checks.in_audit_chain
                          ? "zv-result-valid"
                          : "zv-result-invalid"
                      }`}
                    >
                      {result.checks.in_audit_chain ? "PRESENT" : "ABSENT"}
                    </span>
                  </div>
                  <div className="zv-result-row">
                    <span className="zv-result-label">Audit Chain</span>
                    <span
                      className={`zv-result-value ${
                        result.checks.audit_chain_valid
                          ? "zv-result-valid"
                          : "zv-result-invalid"
                      }`}
                    >
                      {result.checks.audit_chain_valid ? "INTACT" : "BROKEN"}
                    </span>
                  </div>
                  <div className="zv-result-row">
                    <span className="zv-result-label">Recorded At</span>
                    <span className="zv-result-value">
                      {new Date(result.recorded_at).toLocaleString()}
                    </span>
                  </div>
                </div>

                <HashBlock
                  label="Verified commitment hash"
                  value={result.commitment}
                  tone="live"
                />

                <Alert
                  type="info"
                  title="Ballot secrecy maintained"
                  message="This says a ballot was recorded. It does not say, and cannot say, who it was for."
                />

                <div className="zv-form-actions">
                  <Button variant="outline" size="sm" onClick={handleReset}>
                    Verify another ballot
                  </Button>
                </div>
              </div>
            ) : (
              <form
                className="zv-form"
                onSubmit={(e) => void handleSubmit(e)}
                noValidate
              >
                {error && (
                  <Alert type="error" title="Verification failed" message={error} />
                )}

                {recalled && recalled.commitment === commitment && (
                  <span className="zv-form-hint">
                    Filled in from the last receipt checked in this browser.
                  </span>
                )}

                <Field
                  label="Election id"
                  required
                  placeholder="e.g. election_2026"
                  value={electionId}
                  onChange={(e) => setElectionId(e.target.value)}
                  controlClassName="zv-mono"
                  autoComplete="off"
                  disabled={loading}
                />

                <Field
                  label="Ballot commitment"
                  required
                  placeholder="64-character SHA-256 hash"
                  value={commitment}
                  onChange={(e) => setCommitment(e.target.value)}
                  controlClassName="zv-mono"
                  autoComplete="off"
                  disabled={loading}
                  error={malformed ? "That is not a 64-character SHA-256 hash" : undefined}
                  hint="From the receipt shown after voting, or the downloaded JSON file."
                />

                <div className="zv-form-actions">
                  <Button
                    type="submit"
                    variant="primary"
                    isLoading={loading}
                    disabled={!canSubmit}
                  >
                    Verify ballot
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
