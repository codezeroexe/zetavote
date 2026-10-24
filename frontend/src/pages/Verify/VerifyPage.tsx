import React, { useEffect, useRef, useState } from "react";
import type { MyBallot, VerifyVoteResponse } from "../../types/api";
import { api } from "../../services/api";
import { useSubmit } from "../../hooks/useSubmit";
import { useSubmitShortcut } from "../../hooks/useSubmitShortcut";
import { PageToolbar } from "../../components/common/PageToolbar";
import { Stub } from "../../components/common/Stub";
import { looksLikeHash, normaliseHash } from "../../services/format";
import { Card } from "../../components/common/Card";
import { Button } from "../../components/common/Button";
import { Alert } from "../../components/common/Alert";
import { Field } from "../../components/common/Field";
import { HashBlock } from "../../components/common/CopyButton";

/** A receipt code checked on this machine, so the same receipt is one click away. */
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
  // The account's own ballots, so checking one is a choice rather than typing a
  // 64-character value. `null` while loading; typing stays available as a fallback.
  const [ballots, setBallots] = useState<MyBallot[] | null>(null);
  const [typing, setTyping] = useState(false);

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

  useEffect(() => {
    let current = true;
    void api
      .myBallots()
      .then((answer) => current && setBallots(answer.ballots))
      .catch(() => current && setBallots([]));
    return () => {
      current = false;
    };
  }, []);

  const pickedIndex =
    ballots?.findIndex(
      (b) => b.election_id === electionId && b.commitment === commitment,
    ) ?? -1;

  const [fieldError, setFieldError] = useState<string | undefined>();
  const formRef = useRef<HTMLFormElement>(null);
  useSubmitShortcut(formRef);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    if (electionId.trim() === "") {
      setFieldError("Choose or enter the election first.");
      return;
    }
    if (!looksLikeHash(commitment)) {
      setFieldError(
        `Receipt codes are 64 letters and numbers. This one has ${commitment.trim().length}. Paste it again.`,
      );
      return;
    }
    setFieldError(undefined);

    // Compared as the server compares it. A receipt code read out of a JSON file
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
    setFieldError(undefined);
    clear();
  };

  // The banner is driven by the answer, never assumed from the response arriving.
  const recorded = !!result && result.valid && result.checks.audit_chain_valid && result.checks.in_audit_chain;
  const yesNo = (ok: boolean) => (ok ? "Yes" : "No");

  return (
    <div className="zv-page-container">
      <PageToolbar title="Verify a ballot" />
      <p className="zv-page-subtitle">
        Open to anyone — no account needed. Confirms that a ballot
        was recorded, without revealing how that person voted.
      </p>

      <div className="zv-admin-sections">
        <section className="zv-admin-section" aria-labelledby="verify-ballot-heading">
          <header className="zv-admin-section-header">
            <h2 id="verify-ballot-heading" className="zv-admin-section-title">
              Check that a ballot was counted
            </h2>
            <p className="zv-admin-section-desc">
              Paste the election id and the receipt code from a vote receipt.
            </p>
          </header>
          {result ? (
              <ResultShell recorded={recorded}>
                <Alert
                  type={recorded ? "success" : "error"}
                  title={recorded ? "Your ballot is recorded" : "This ballot could not be confirmed"}
                  message={
                    recorded
                      ? "The receipt matches the record, and the record has not been changed."
                      : "One or more checks failed. The rows below say which. Do not treat this ballot as counted."
                  }
                />

                <dl className="zv-verify-rows">
                  <dt>In the record</dt>
                  <dd>{yesNo(result.checks.in_audit_chain)}</dd>
                  <dt>Record intact</dt>
                  <dd>{yesNo(result.checks.audit_chain_valid)}</dd>
                  {!recorded && (
                    <>
                      <dt>Signature</dt>
                      <dd>{result.checks.signature_valid ? "Valid" : "Invalid"}</dd>
                      <dt>Ballot id</dt>
                      <dd>{result.checks.ballot_id_consistent ? "Matches" : "Does not match"}</dd>
                    </>
                  )}
                  <dt>Recorded at</dt>
                  <dd>{new Date(result.recorded_at).toLocaleString()}</dd>
                  <dt>Election id</dt>
                  <dd><code className="zv-mono">{result.election_id}</code></dd>
                </dl>

                <HashBlock label="Your receipt" value={result.commitment} tone="live" />

                <Alert
                  type="info"
                  title="Your choice stays private"
                  message="This says a ballot was recorded. It does not say, and cannot say, who it was for."
                />

                <div className="zv-form-actions">
                  <Button variant="outline" size="sm" onClick={handleReset}>
                    Verify another ballot
                  </Button>
                </div>
              </ResultShell>
          ) : (
            <Card>
              <form
                ref={formRef}
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

                {ballots && ballots.length > 0 && !typing ? (
                  <div className="zv-form-label">
                    <label className="zv-label-text" htmlFor="zv-ballot-pick">
                      Your ballot
                    </label>
                    <select
                      id="zv-ballot-pick"
                      className="zv-select"
                      value={pickedIndex >= 0 ? String(pickedIndex) : ""}
                      disabled={loading}
                      onChange={(e) => {
                        const picked = ballots[Number(e.target.value)];
                        if (!picked) return;
                        setElectionId(picked.election_id);
                        setCommitment(picked.commitment);
                        setFieldError(undefined);
                      }}
                    >
                      <option value="" disabled>
                        Choose a ballot you cast
                      </option>
                      {ballots.map((b, i) => (
                        <option key={`${b.election_id}-${b.commitment}`} value={i}>
                          {b.election_name} · {new Date(b.ballot_timestamp).toLocaleString()}
                        </option>
                      ))}
                    </select>
                    <span className="zv-form-hint">
                      Every ballot cast from this account.
                    </span>
                    {fieldError && (
                      <span className="zv-form-error-hint" role="alert">{fieldError}</span>
                    )}
                    <button
                      type="button"
                      className="zv-btn-link"
                      onClick={() => setTyping(true)}
                    >
                      Enter an election id and receipt code instead
                    </button>
                  </div>
                ) : (
                  <>
                    {ballots && ballots.length === 0 && (
                      <span className="zv-form-hint">
                        This account has not cast a ballot yet. Enter the details from a receipt.
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
                      label="Receipt code"
                      required
                      placeholder="64 letters and numbers"
                      value={commitment}
                      onChange={(e) => {
                        setCommitment(e.target.value);
                        setFieldError(undefined);
                      }}
                      controlClassName="zv-mono"
                      autoComplete="off"
                      disabled={loading}
                      error={fieldError}
                      hint="From the receipt shown after voting, or the downloaded JSON file."
                    />
                  </>
                )}

                <div className="zv-form-actions">
                  <Button
                    type="submit"
                    variant="primary"
                    isLoading={loading}
                    shortcut="submit"
                  >
                    Verify ballot
                  </Button>
                </div>
              </form>
            </Card>
          )}
        </section>
      </div>
    </div>
  );
};

/** Only a confirmed match is the voter's receipt, so only it gets the stub. */
const ResultShell: React.FC<{ recorded: boolean; children: React.ReactNode }> = ({ recorded, children }) =>
  recorded ? <Stub id="MATCHED">{children}</Stub> : <Card><div className="zv-receipt">{children}</div></Card>;
