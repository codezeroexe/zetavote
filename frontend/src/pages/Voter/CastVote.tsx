import React, { useEffect, useState } from "react";
import { api } from "../../services/api";
import { useSubmit } from "../../hooks/useSubmit";
import { useSession } from "../../auth/SessionContext";
import {
  buildVote,
  loadBallotSeal,
  openPrivateKey,
  saveBallotSeal,
} from "../../services/crypto";
import { downloadJson } from "../../services/download";
import { CardStock } from "../../components/common/CardStock";
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

const MIN_BALLOT_PASSPHRASE = 8;

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
}> = ({ electionId, electionName, onDone, onRecorded }) => {
  const { subject } = useSession();
  const [choice, setChoice] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [candidates, setCandidates] = useState<string[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);

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
    if (loading || choice === "" || passphrase === "") return;

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
    return (
      <div className="zv-cast">
        <Alert
          type="success"
          title="Ballot recorded"
          message="Signed with your ballot key and encrypted to the election's public key. The server stored only ciphertext, and nothing on this card reveals how you voted."
        />

        {/* The card the machine prints back. It is sealed, because the choice has
            been made and nothing on it can be punched again. */}
        <CardStock
          title="Ballot receipt"
          id={result.election_id}
          sealed
          sealedSub={result.election_id}
        >
          <div className="zv-card-print">
            The receipt is proof that a ballot was recorded. It does not record
            what you chose, and it never will — the reveal salt below is what
            unlocks that, and it stays on this device.
          </div>

          <div className="zv-result-details">
            <div className="zv-result-row">
              <span className="zv-result-label">Election</span>
              <span className="zv-result-value">
                {electionName ?? result.election_id}
              </span>
            </div>
            <div className="zv-result-row">
              <span className="zv-result-label">You voted for</span>
              <span className="zv-result-value">{choice}</span>
            </div>
            <div className="zv-result-row">
              <span className="zv-result-label">Signature</span>
              <span
                className={`zv-result-value ${
                  result.signature_valid
                    ? "zv-result-valid"
                    : "zv-result-invalid"
                }`}
              >
                {result.signature_valid ? "VERIFIED" : "INVALID"}
              </span>
            </div>
          </div>
        </CardStock>

        {/* The same ledger that was on screen during the submit, kept. Key
            derivation is the only step here that takes real time, and the figure
            beside it is what that actually cost. */}
        {stages && (
          <PipelineLedger
            stages={stages}
            elapsedMs={elapsedMs}
            note="How this entry was made, and how long it took. Every step above happened on this device or was checked by the server before it was accepted."
          />
        )}

        {/* Both values are on screen and one click from the clipboard. */}
        <HashBlock
          label="Ballot commitment"
          value={result.ballot_commitment}
          tone="live"
          hint="Proves your ballot was counted. Safe to share."
        />
        <HashBlock
          label="Reveal salt — keep secret"
          value={result.revealSalt}
          tone="secret"
          hint="Reveals which candidate you chose. Whoever holds it can read your vote, so do not share it."
        />

        <Alert
          type="warning"
          title="Save both values now"
          message="There is no way to get these back afterwards. The commitment proves your ballot was counted; the reveal salt is what lets you prove which candidate you chose, locally and offline, once results are published."
        />

        <div className="zv-form-actions">
          <Button
            variant="primary"
            size="sm"
            onClick={() =>
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
              )
            }
          >
            Download receipt
          </Button>
          <Button variant="primary" size="sm" onClick={() => void onDone()}>
            Back to my ballots
          </Button>
        </div>
        {/* There is deliberately no way back to the form from here. It used to
            offer "Back", which re-opened a ballot for an election this person
            had already voted in — a second submit could only come back as "You
            have already voted in this election". */}
      </div>
    );
  }

  // Whether this card will take a punch at all. A closed election's card is
  // stamped and its candidate field is dead, and the stamp says why.
  const accepting = loadError === null && candidates !== null;

  return (
    <form
      className="zv-form zv-cast-form"
      onSubmit={(e) => void handleSubmit(e)}
      noValidate
    >
      {error && <Alert type="error" title="Vote Failed" message={error} />}
      {loadError && (
        <Alert type="warning" title="Not Available" message={loadError} />
      )}

      {/* The card. This is the first viewport of the most important screen in
          the product, so the world's whole argument is spent here: a warm card,
          a gutter of slots down its edge, and one open slot per candidate. */}
      <CardStock
        title={electionName ?? electionId}
        id={electionName ? electionId : undefined}
        sealed={!accepting}
        sealedSub={electionId}
        bandExtra={
          electionName ? (
            <span className="zv-card-band-id">as {subject}</span>
          ) : null
        }
      >
        {/* Stated on the card, before the field and not after the fact: one
            ballot per enrolment, and the server rejects the second. */}
        <p className="zv-card-print">
          One ballot per enrolment. Once it is punched this card is sealed, and
          it cannot be changed, withdrawn or voted again.
        </p>

        <fieldset
          className="zv-choice-set"
          disabled={loading || loadError !== null}
        >
          <legend className="zv-label-text">
            Your vote <span className="zv-required">*</span>
          </legend>
          {candidates === null && (
            <div className="zv-loading-block">
              <span className="zv-spinner" /> Reading the candidate field…
            </div>
          )}
          {candidates?.map((candidate, i) => (
            <label
              key={candidate}
              className={`zv-choice-option ${choice === candidate ? "selected" : ""}`}
            >
              {/* The native radio stays in the DOM and stays focusable — it is the
                  control, its accessible name and its keyboard behaviour. It is
                  only made invisible, because the hole beside it is what a person
                  reads as the state they have set. */}
              <input
                type="radio"
                name="candidate"
                value={candidate}
                checked={choice === candidate}
                onChange={() => setChoice(candidate)}
              />
              <span className="zv-choice-hole" aria-hidden="true" />
              <span className="zv-choice-label">{candidate}</span>
              <span className="zv-choice-ordinal" aria-hidden="true">
                {String(i + 1).padStart(2, "0")}
              </span>
            </label>
          ))}
        </fieldset>
      </CardStock>

      {/* The tray: the recess the card sits in, and everything the card does not
          carry — the key that opens it, and the one action that punches it. */}
      <div className="zv-tray">
        {/* The review step. A ballot cannot be changed once punched, and the
            confirm button used to be one stray click away from a mis-cast vote.
            Punch ink and a warning mark rather than the exception ink: this needs
            checking, but nothing is being destroyed.

            Once the submit starts, the confirmation is replaced by the ledger
            rather than sitting above it. The question has been answered; what is
            on screen now is the record of the answer being made. */}
        {loading && stages ? (
          <PipelineLedger
            stages={stages}
            elapsedMs={elapsedMs}
            note="Key derivation is deliberately slow — it is what makes your ballot key impractical to guess from this device. Everything after it takes milliseconds."
          />
        ) : reviewing ? (
          <div className="zv-confirm-box zv-confirm-box--check" role="alert">
            <div className="zv-confirm-header">
              <span className="zv-confirm-title">Punch this card?</span>
            </div>
            <p className="zv-confirm-text">
              You are voting for <strong>{choice}</strong> in{" "}
              {electionName ?? electionId}. Once submitted it cannot be changed,
              withdrawn, or voted again.
            </p>
            <div className="zv-confirm-actions">
              <Button
                type="submit"
                variant="primary"
                isLoading={loading}
              >
                Submit ballot
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setReviewing(false)}
                disabled={loading}
              >
                Go back
              </Button>
            </div>
          </div>
        ) : (
          <>
            <Field
              label="Ballot Passphrase"
              required
              type="password"
              revealable
              placeholder="The one you chose when joining"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              autoComplete="current-password"
              disabled={loading}
              error={
                passphrase !== "" && passphrase.length < MIN_BALLOT_PASSPHRASE
                  ? "This looks too short to be the one you set when joining"
                  : undefined
              }
              hint="Opens this election's ballot key here. The key was never saved to this device, so this is asked for every time you vote."
            />

            <span className="zv-form-hint">
              Encrypted to the election key before it leaves this page. Your
              selection is never sent to the server in the clear.
            </span>

            <div className="zv-form-actions">
              <Button
                type="button"
                variant="primary"
                onClick={() => setReviewing(true)}
                disabled={choice === "" || passphrase === "" || loadError !== null}
              >
                Review ballot
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
      </div>
    </form>
  );
}
