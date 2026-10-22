import React, { useRef, useState } from "react";
import { Skeleton } from "../../components/common/Skeleton";
import { api } from "../../services/api";
import { useSubmit } from "../../hooks/useSubmit";
import { useSubmitShortcut } from "../../hooks/useSubmitShortcut";
import { Stub } from "../../components/common/Stub";
import { StatusPill } from "../../components/common/StatusPill";
import { useSession } from "../../auth/SessionContext";
import {
  loadBallotSeal,
  revealChoice,
  verifyInclusion,
} from "../../services/crypto";
import {
  formatTimestamp,
  looksLikeHash,
  normaliseHash,
} from "../../services/format";
import type { PublishedResults } from "../../types/api";
import { describeCriteria } from "../../services/ageRule";
import { Card } from "../../components/common/Card";
import { CardStock } from "../../components/common/CardStock";
import { Hole } from "../../components/common/Hole";
import { Button } from "../../components/common/Button";
import { Alert } from "../../components/common/Alert";
import { Field } from "../../components/common/Field";
import { HashBlock } from "../../components/common/CopyButton";

export type ResultsTab = "summary" | "receipt" | "proof" | "reveal";

/**
 * Two things a voter can do once results exist, and both are checked locally
 * rather than taken on trust:
 *
 *  - inclusion: recompute the Merkle path from their own commitment up to the
 *    published root. If it does not reproduce the root, their ballot was not in
 *    that tally.
 *  - reveal: search the fixed candidate list for the one matching their
 *    commitment and salt. The salt never leaves this browser, so neither the
 *    server nor the admin learns the choice from this.
 */
export const ResultsPanel: React.FC<{
  electionId: string;
  electionName: string;
  /** Which view to open on. "receipt" is what "My Receipt" has to mean. */
  openTab?: ResultsTab;
  /**
   * Reports the visible view upward, so the page heading names what is actually
   * on screen. Without it the heading froze at whatever opened the panel and
   * said "Your ballot receipt" above the published tally — the one heading a
   * person cannot act on.
   */
  onTabChange?: (tab: ResultsTab) => void;
}> = ({ electionId, openTab = "summary", onTabChange }) => {
  const tab: ResultsTab = "summary";

  // Reported through a ref rather than called straight from an effect: the parent
  // passes a fresh arrow every render, so listing it as a dependency re-fires the
  // effect, which sets the parent's state, which re-renders, forever.
  const report = React.useRef(onTabChange);
  report.current = onTabChange;
  React.useEffect(() => {
    report.current?.(tab);
  }, [tab]);
  const { subject } = useSession();
  // This browser's own record of the enrolment. Everything the voter needs is
  // already here, so nothing below should have to be typed or pasted.
  const seal = loadBallotSeal(electionId, subject ?? "");

  return (
    <section className="zv-admin-section">
      <p className="zv-hint-text">
        Election <code className="zv-mono">{electionId}</code>
      </p>

      <div className="zv-res-stack">
        <ResultsSummary electionId={electionId} seal={seal} />

        {/* Kept reachable, but off the main path: totals and the check come first. */}
        <details className="zv-res-details" open={openTab === "receipt"}>
          <summary>Your saved receipt</summary>
          <ReceiptPanel seal={seal} />
        </details>
        <details className="zv-res-details">
          <summary>Reveal my vote (private, on this device)</summary>
          <RevealPanel electionId={electionId} seal={seal} />
        </details>
      </div>
    </section>
  );
};

function outcomeSentence(sorted: [string, number][], total: number): string {
  if (total === 0 || sorted.length === 0) return "No votes were counted";
  const top = sorted[0][1];
  const leaders = sorted.filter(([, n]) => n === top).map(([name]) => name);
  if (leaders.length === 1) return `${leaders[0]} won with ${top} of ${total} votes`;
  return `${leaders.join(" and ")} tied with ${top} of ${total} votes each`;
}

const ResultsSummary: React.FC<{
  electionId: string;
  seal: ReturnType<typeof loadBallotSeal>;
}> = ({ electionId, seal }) => {
  const [data, setData] = useState<PublishedResults | null>(null);
  const [error, setError] = useState<string | null>(null);

  React.useEffect(() => {
    void api
      .getResults(electionId)
      .then((results) => setData(results))
      .catch(() =>
        setError("Results have not been published for this election yet."),
      );
  }, [electionId]);

  if (error) return <Alert type="info" title="Not published" message={error} />;
  if (data === null) {
    return (
      <Skeleton label="Loading results" rows={2} />
    );
  }

  const sorted = Object.entries(data.choice_breakdown).sort(
    ([, a], [, b]) => b - a,
  );
  const max = sorted.length > 0 ? sorted[0][1] : 0;

  return (
    <>
      <Card>
        <div className="zv-res-head">
          <div>
            <h3 className="zv-res-outcome">{outcomeSentence(sorted, data.total_votes)}</h3>
            <p className="zv-res-sub">Counted {formatTimestamp(data.published_at)}.</p>
          </div>
          <StatusPill tone="done">Final</StatusPill>
        </div>
        <div className="zv-res-bars">
          {sorted.map(([candidate, count]) => (
            <div key={candidate} className="zv-res-bar">
              <span>{candidate}</span>
              <span className="zv-res-bar-track" aria-hidden="true">
                <span
                  className="zv-res-bar-fill"
                  style={{ width: `${max > 0 ? (count / max) * 100 : 0}%` }}
                />
              </span>
              <span className="zv-res-bar-count">{count}</span>
            </div>
          ))}
        </div>
      </Card>

      <Stub id="YOUR STUB">
        <CheckPanel
          electionId={electionId}
          storedCommitment={seal?.commitment}
          technical={
            <details className="zv-res-details">
              <summary>Technical details</summary>
              <p>
                Only people who met this rule could vote:{" "}
                {describeCriteria(data.criteria)}.
              </p>
              <HashBlock label="Rule fingerprint" value={data.criteria_hash} tone="live" />
              <HashBlock
                label="Results fingerprint (Merkle root)"
                value={data.merkle_root}
                tone="live"
                hint="Recomputed from every receipt code in this count. Anyone can check a ballot against it."
              />
            </details>
          }
        />
      </Stub>
    </>
  );
};

/**
 * What this browser recorded at the moment of voting.
 *
 * This is what "My Receipt" has to open. It used to open the published tally,
 * which is a different thing and none of the voter's own.
 */
const ReceiptPanel: React.FC<{
  seal: ReturnType<typeof loadBallotSeal>;
}> = ({ seal }) => {
  if (!seal) {
    return (
      <Alert
        type="info"
        title="No receipt on this device"
        message="This browser did not record that you joined this election. You may have joined on another device. You can still paste the receipt code and private key from your download."
      />
    );
  }

  return (
    <CardStock title="Ballot receipt" id={seal.electionId ?? ""} sealed sealedSub="KEPT BY YOU">
      <div className="zv-card-print">
        Recorded by this browser when you voted. Nothing here identifies your
        choice to the server — the private key for this receipt is what unlocks it, and it stays
        here.
      </div>

      {seal.commitment && (
        <div className="zv-card-field">
          <span className="zv-label-text">Receipt code</span>
          <code className="zv-card-hash">{seal.commitment}</code>
          <span className="zv-form-hint">
            Safe to share. Anyone can check it on the Verify page.
          </span>
        </div>
      )}
      {seal.revealSalt && (
        <div className="zv-card-field zv-card-field--secret">
          <span className="zv-label-text">
            <Hole tone="risk" />
            {" "}
            Private key for this receipt: keep secret
          </span>
          <code className="zv-card-hash">{seal.revealSalt}</code>
          <span className="zv-form-hint">
            Whoever holds this can read your choice. Do not share it.
          </span>
        </div>
      )}

      {!seal.commitment && !seal.revealSalt && (
        <p className="zv-card-print">
          This browser recorded that you joined, but not the receipt — the ballot was
          cast somewhere else, or in a session that has since been cleared.
        </p>
      )}
    </CardStock>
  );
};

const CheckPanel: React.FC<{
  electionId: string;
  storedCommitment?: string;
  technical: React.ReactNode;
}> = ({ electionId, storedCommitment, technical }) => {
  const [commitment, setCommitment] = useState(storedCommitment ?? "");
  const [fieldError, setFieldError] = useState<string | undefined>();
  const formRef = useRef<HTMLFormElement>(null);
  useSubmitShortcut(formRef);
  const { loading, result, error, run, clear } = useSubmit<{
    included: boolean;
    merkle_root?: string;
    siblings?: { hash: string; side: "left" | "right" }[];
  }>();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    if (!looksLikeHash(commitment)) {
      setFieldError(
        `Receipt codes are 64 letters and numbers. This one has ${commitment.trim().length}. Paste it again.`,
      );
      return;
    }
    setFieldError(undefined);
    // Compared as the server will compare it. A pasted code that differs in
    // casing must not read as "not in this count".
    const value = normaliseHash(commitment);
    await run(async () => {
      const proof = await api.inclusionProof(electionId, value);
      // Recompute the path here rather than trusting an `included: true` flag.
      if (proof.included && proof.siblings && proof.merkle_root) {
        const valid = verifyInclusion(
          proof.commitment,
          proof.siblings,
          proof.merkle_root,
        );
        if (!valid) {
          throw new Error(
            "The proof does not reproduce the published results fingerprint. This ballot was not in that count.",
          );
        }
      }
      return proof;
    });
  };

  return (
    <form ref={formRef} className="zv-form" onSubmit={handleSubmit} noValidate>
      <div>
        <h3 className="zv-res-outcome">Check your vote was counted</h3>
        <p className="zv-res-sub">Uses your saved receipt. Your choice is never shown.</p>
      </div>

      {error && <Alert type="error" title="Could not confirm" message={error} />}

      {result && (
        <Alert
          type={result.included ? "success" : "warning"}
          title={result.included ? "Your vote was counted" : "Not in this count"}
          message={
            result.included
              ? "Checked in this browser: your receipt code leads to the published results fingerprint, so your ballot is part of the count."
              : "No proof was returned, so this receipt code was not part of the published count."
          }
        />
      )}

      <div className="zv-res-check">
        <Field
          label="Receipt code"
          placeholder="From your vote receipt"
          value={commitment}
          onChange={(e) => {
            setCommitment(e.target.value);
            setFieldError(undefined);
          }}
          controlClassName="zv-mono"
          autoComplete="off"
          disabled={loading}
          error={fieldError}
          hint={
            storedCommitment
              ? "Filled in from the receipt saved on this device. Paste another to check a different one."
              : "The 64 letters and numbers printed when you voted."
          }
        />
        <Button type="submit" variant="primary" isLoading={loading} shortcut="submit">
          Check my receipt
        </Button>
        {result && (
          <Button variant="ghost" size="sm" onClick={clear}>
            Clear
          </Button>
        )}
      </div>
      {technical}
    </form>
  );
};

const RevealPanel: React.FC<{
  electionId: string;
  seal: ReturnType<typeof loadBallotSeal>;
}> = ({ electionId, seal }) => {
  const [commitment, setCommitment] = useState(seal?.commitment ?? "");
  const [salt, setSalt] = useState(seal?.revealSalt ?? "");
  const [revealed, setRevealed] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<string[] | null>(null);

  React.useEffect(() => {
    void api
      .getElection(electionId)
      .then((election) => setCandidates(election.candidates))
      .catch(() => setCandidates([]));
  }, [electionId]);

  const handleReveal = () => {
    setError(null);
    setRevealed(null);
    if (commitment.trim() === "" || salt.trim() === "") {
      setError("Both the receipt code and the private key for this receipt are needed.");
      return;
    }
    if (candidates === null || candidates.length === 0) {
      setError(
        "The candidate list could not be loaded, so there is nothing to search.",
      );
      return;
    }
    // The commitment was made against this enrolment's ballot key, so that is
    // the key to search with — never the account key.
    const publicKey = seal?.publicKey;
    if (!publicKey) {
      setError(
        "No ballot key on this device for this election. Revealing needs the key the receipt code was made against, which only the browser that enrolled here has.",
      );
      return;
    }
    // Entirely local: the salt is never sent anywhere.
    const match = revealChoice(
      electionId,
      publicKey,
      salt.trim(),
      normaliseHash(commitment),
      candidates,
    );
    setRevealed(match ?? "");
  };

  return (
    <Card>
      {revealed !== null && (
        <Alert
          type={revealed === "" ? "warning" : "success"}
          title={revealed === "" ? "No match" : `You voted for ${revealed}`}
          message={
            revealed === ""
              ? "No candidate on the list matches that receipt code and private key. Check both values for typos."
              : "Found by searching the fixed candidate list in this browser. The server and the admin never learn this."
          }
        />
      )}
      {error && <Alert type="error" title="Cannot reveal" message={error} />}

      <div className="zv-form">
        <Field
          label="Receipt code"
          placeholder="From your vote receipt"
          value={commitment}
          onChange={(e) => setCommitment(e.target.value)}
          controlClassName="zv-mono"
          autoComplete="off"
        />
        <Field
          label="Private key for this receipt"
          placeholder="Also from your vote receipt"
          value={salt}
          onChange={(e) => setSalt(e.target.value)}
          controlClassName="zv-mono"
          autoComplete="off"
          hint="This stays in this page. It is never sent to the server, which is what makes the reveal private."
        />
        <div className="zv-form-actions">
          <Button variant="primary" onClick={handleReveal}>
            Reveal
          </Button>
        </div>
      </div>
    </Card>
  );
};
