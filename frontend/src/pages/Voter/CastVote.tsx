import React, { useEffect, useState } from "react";
import { Stepper } from "../../components/common/Stepper";
import { api } from "../../services/api";
import { useSubmit } from "../../hooks/useSubmit";
import { useSession } from "../../auth/SessionContext";
import {
  buildVote,
  loadBallotSeal,
  openPrivateKey,
  saveBallotSeal,
} from "../../services/crypto";
import { useToast } from "../../components/common/Toast";
import { downloadJson } from "../../services/download";
import { Card } from "../../components/common/Card";
import { Stub } from "../../components/common/Stub";
import { useSubmitShortcut } from "../../hooks/useSubmitShortcut";
import { Field } from "../../components/common/Field";
import { Button } from "../../components/common/Button";
import { Alert } from "../../components/common/Alert";
import { HashBlock } from "../../components/common/CopyButton";
import {
  PipelineLedger,
  initialStages,
  type Stage,
  type StageState,
} from "../../components/common/PipelineLedger";

type VoteResult = {
  election_id: string;
  ballot_commitment: string;
  signature_valid: boolean;
  receipt: {
    ballot_commitment: string;
    vote_signature: string;
    timestamp: string;
  };
  revealSalt: string;
};

/**
 * Cast a ballot.
 *
 * The choice is a radio group rather than a text box, because the candidate list
 * is fixed at election creation — so a typo cannot split one candidate's votes
 * across two buckets. The plaintext ballot is encrypted to the election's public
 * key here in the browser and never sent in the clear.
 */
export const CastVote: React.FC<{
  electionId: string;
  electionName?: string;
  onDone: () => void | Promise<void>;
  /**
   * Fired once, when the ballot is recorded. The page heading lives in the
   * dashboard, and "Cast your ballot" is the wrong heading over a receipt.
   */
  onRecorded?: () => void;
  /**
   * The "I saved both codes" gate. Owned by the dashboard because the Back
   * button lives in its toolbar; the codes are not recoverable once this
   * screen closes.
   */
  saved?: boolean;
  saveError?: boolean;
  onSavedChange?: (saved: boolean) => void;
}> = ({ electionId, electionName, onDone, onRecorded, saved = false, saveError = false, onSavedChange }) => {
  const { subject } = useSession();
  const { show } = useToast();
  const [choice, setChoice] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [candidates, setCandidates] = useState<string[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);
  const formRef = React.useRef<HTMLFormElement>(null);
  useSubmitShortcut(formRef);

  /**
   * The record being written. `stages` is only populated once a submit starts,
   * so the form does not show a ledger of things that have not happened.
   */
  const [stages, setStages] = useState<Stage[] | null>(null);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);

  const { loading, result, error, run } = useSubmit<VoteResult>();

  /**
   * Move one row of the ledger, and only ever forward.
   *
   * A row turning to `done` is a claim that real work finished, so it is driven
   * from the same `await` that finished it. Nothing here adds a delay, and
   * nothing here waits on a timer to make a fast step look like a slow one.
   */
  const mark = React.useCallback(
    (id: string, state: StageState) => {
      setStages((prev) =>
        prev === null
          ? prev
          : prev.map((s) => (s.id === id ? { ...s, state } : s)),
      );
    },
    [],
  );

  useEffect(() => {
    void api
      .getElection(electionId)
      .then((election) => {
        setCandidates(election.candidates);
        if (!election.accepting_votes) {
          setLoadError("This election is not currently accepting votes.");
        }
      })
      .catch(() => setLoadError("Could not load this election."));
  }, [electionId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    // Validated here rather than by disabling the button, so each problem is named.
    setAttempted(true);
    if (choice === "" || passphrase === "" || loadError !== null) return;

    const startedAt = performance.now();
    setStages(initialStages());
    setElapsedMs(null);

    const recorded = await run(async () => {
      mark("fetch", "active");
      const election = await api.getElection(electionId);
      if (!election.accepting_votes) {
        mark("fetch", "failed");
        throw new Error("This election is not currently accepting votes");
      }
      mark("fetch", "done");

      // The ballot key for *this* enrolment, unsealed here with the passphrase
      // that sealed it. Not the account key: an account may be enrolled in
      // several elections, each with its own unrelated key.
      const seal = loadBallotSeal(electionId, subject ?? "");
      if (!seal) {
        throw new Error(
          "This device has no record of that enrolment. Join the election again from your dashboard.",
        );
      }

      // The only genuinely slow step in the whole app. scrypt is expensive on
      // purpose, and this is the one wait worth showing rather than hiding.
      mark("derive", "active");
      const privateKey = await openPrivateKey(seal.sealedKey, passphrase);
      mark("derive", "done");

      // Synchronous, and fast: the salt, the nonce, the canonical JSON, the
      // AES-GCM seal, the ballot id, the commitment and the Ed25519 signature
      // all happen in one turn. It gets one row because it is one row's worth
      // of work, not seven.
      mark("seal", "active");
      const built = buildVote({
        electionId,
        electionPublicKey: election.public_key,
        accountId: seal.username,
        ballotKeys: { privateKey, publicKey: seal.publicKey },
        choice,
      });
      mark("seal", "done");

      mark("submit", "active");
      const res = await api.castVote(electionId, built.payload);
      mark("submit", "done");

      // The server validated, stored and appended the chain inside that one
      // request, so these two are true the moment the response lands. They are
      // marked together rather than staged apart, because staging them would be
      // showing work as happening when it already had.
      mark("chain", "done");
      mark("receipt", "done");

      // Recorded alongside the enrolment so the receipt, the inclusion proof and
      // the reveal can all be filled in on this device rather than pasted from a
      // file the voter may not still have.
      saveBallotSeal({
        electionId,
        username: seal.username,
        publicKey: seal.publicKey,
        sealedKey: seal.sealedKey,
        commitment: res.ballot_commitment,
        revealSalt: built.revealSalt,
      });
      setElapsedMs(performance.now() - startedAt);
      // Every row settles, because a ledger entry keeps its record. The ledger
      // used to vanish the instant the receipt replaced it, which left the whole
      // thing on screen for about the length of one scrypt call — long enough to
      // flash, far too short to read. It stays, so what the record says about
      // how it was made is as checkable as what it says about the ballot.
      setStages((prev) =>
        prev === null ? prev : prev.map((s) => ({ ...s, state: "done" })),
      );
      return { ...res, revealSalt: built.revealSalt };
    });

    // Only on success: a failed submit leaves the form exactly as it was, and
    // the heading must not claim the ballot is recorded.
    if (recorded) onRecorded?.();
  };

  if (result) {
    const when = new Date(result.receipt.timestamp);
    const stamp = Number.isNaN(when.getTime())
      ? ""
      : ` · ${when.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`;
    return (
      <div className="zv-cast">
        <Stub id={`${result.election_id.slice(0, 8)}${stamp}`.toUpperCase()}>
          <h2 className="zv-stub-title">Your receipt</h2>
          <p className="zv-hint-text">
            Save both codes. You need them to prove your vote was counted.
            {electionName ? ` Election: ${electionName}.` : ""}
          </p>

          <HashBlock
            label="Receipt code"
            value={result.ballot_commitment}
            tone="live"
            hint="Safe to share. Anyone can check it was counted."
          />
          <HashBlock
            label="Private key for this receipt"
            value={result.revealSalt}
            tone="secret"
            hint="Keep this to yourself. It shows how you voted."
          />

          <div className="zv-receipt-actions">
            <Button
              variant="primary"
              onClick={() => {
                downloadJson(
                  {
                    election_id: result.election_id,
                    election_name: electionName ?? null,
                    ballot_commitment: result.ballot_commitment,
                    reveal_salt: result.revealSalt,
                    signature_valid: result.signature_valid,
                    timestamp: result.receipt.timestamp,
                  },
                  `vote_receipt_${result.ballot_commitment.slice(0, 8)}.json`,
                );
                show("Receipt downloaded", "ok");
              }}
            >
              Download receipt
            </Button>
            <label className="zv-ack">
              <input
                type="checkbox"
                checked={saved}
                onChange={(e) => onSavedChange?.(e.target.checked)}
              />
              <span>I saved both codes</span>
            </label>
          </div>
          {saveError && !saved && (
            <span className="zv-form-error-hint" role="alert">
              Save both codes, then tick the box to continue.
            </span>
          )}

          <details className="zv-tech">
            <summary>Technical details</summary>
            <p>
              The receipt code is the ballot commitment (SHA-256). The private
              key is the reveal salt. The signature on this vote is{" "}
              {result.signature_valid ? "valid" : "not valid"}. Neither code
              contains your choice.
            </p>
            {stages && (
              <PipelineLedger
                stages={stages}
                elapsedMs={elapsedMs}
                note="How this vote was made, and how long it took."
              />
            )}
          </details>
        </Stub>
        {/* No way back to the form from here: a second submit could only fail
            with "already voted". */}
      </div>
    );
  }

  const accepting = loadError === null && candidates !== null;

  return (
    <>
      <Stepper steps={["Account", "Join", "Vote", "Receipt"]} current={2} />
      <form
        ref={formRef}
        className="zv-voter-grid zv-cast-form"
        onSubmit={(e) => void handleSubmit(e)}
        noValidate
      >
        <Card>
          <h2 className="zv-stub-title">{electionName ?? electionId}</h2>
          <p className="zv-hint-text">Pick one.</p>
          {loadError && (
            <Alert type="warning" title="Not available" message={loadError} />
          )}
          <fieldset
            className="zv-choice-set"
            disabled={loading || !accepting}
          >
            <legend className="zv-sr-only">Your choice</legend>
            {candidates === null && !loadError && (
              <div className="zv-loading-block">
                <span className="zv-spinner" /> Loading choices…
              </div>
            )}
            {candidates?.map((candidate) => (
              <label
                key={candidate}
                className={`zv-choice-option ${choice === candidate ? "selected" : ""}`}
              >
                <input
                  type="radio"
                  name="candidate"
                  value={candidate}
                  checked={choice === candidate}
                  onChange={() => setChoice(candidate)}
                />
                <span className="zv-choice-hole" aria-hidden="true" />
                <span className="zv-choice-label">{candidate}</span>
              </label>
            ))}
          </fieldset>
          {attempted && choice === "" && (
            <span className="zv-form-error-hint" role="alert">
              Pick one option to continue.
            </span>
          )}
        </Card>

        <Card>
          {error && <Alert type="error" title="Vote failed" message={error} />}
          <div className="zv-confirm-summary">
            <span className="zv-hint-text">
              {choice === "" ? "Pick one" : "You are voting for"}
            </span>
            {choice !== "" && <strong className="zv-confirm-choice">{choice}</strong>}
          </div>

          {loading && stages ? (
            <PipelineLedger
              stages={stages}
              elapsedMs={elapsedMs}
              note="Unlocking your key is deliberately slow. Everything after it takes milliseconds."
            />
          ) : (
            <>
              <Field
                label="Passphrase for this election"
                required
                type="password"
                revealable
                placeholder="The one you chose when joining"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                autoComplete="current-password"
                disabled={loading}
                error={
                  attempted && passphrase === ""
                    ? "Enter the passphrase you chose when you joined"
                    : undefined
                }
              />
              <p className="zv-hint-text">You can't change your vote after this.</p>
              <div className="zv-form-actions">
                <Button
                  type="submit"
                  variant="primary"
                  shortcut="submit"
                  isLoading={loading}
                >
                  Cast vote
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void onDone()}
                  disabled={loading}
                >
                  Cancel
                </Button>
              </div>
            </>
          )}
        </Card>
      </form>
    </>
  );
};
