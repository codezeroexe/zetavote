import React, { useState } from "react";
import { Skeleton } from "../../components/common/Skeleton";
import { api } from "../../services/api";
import { useSubmit } from "../../hooks/useSubmit";
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
import { BinaryColumn, Hole } from "../../components/common/Hole";
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
  onClose: () => void;
}> = ({ electionId, electionName, openTab = "summary", onTabChange, onClose }) => {
  const [tab, setTab] = useState<ResultsTab>(openTab);

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

  const tabs: [ResultsTab, string][] = [
    ["summary", "Published results"],
    ["receipt", "My receipt"],
    ["proof", "Prove my ballot"],
    ["reveal", "Reveal my vote"],
  ];

  return (
    <section className="zv-admin-section">
      <header className="zv-admin-section-header">
        <h2 className="zv-admin-section-title">{electionName}</h2>
        <p className="zv-admin-section-desc">
          <code className="zv-mono">{electionId}</code>
        </p>
      </header>


      <div className="zv-tabs" role="group" aria-label="Results view">
        {tabs.map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={tab === value}
            className="zv-tab"
            onClick={() => setTab(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "summary" && <ResultsSummary electionId={electionId} />}
      {tab === "receipt" && <ReceiptPanel seal={seal} />}
      {tab === "proof" && (
        <InclusionProofPanel electionId={electionId} storedCommitment={seal?.commitment} />
      )}
      {tab === "reveal" && <RevealPanel electionId={electionId} seal={seal} />}

      <div className="zv-form-actions">
        <Button variant="outline" size="sm" onClick={onClose}>
          Back to my ballots
        </Button>
      </div>
    </section>
  );
};

const ResultsSummary: React.FC<{ electionId: string }> = ({ electionId }) => {
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

  if (error) return <Alert type="info" title="Not Published" message={error} />;
  if (data === null) {
    return (
      <Skeleton label="Loading results" rows={2} />
    );
  }

  const sorted = Object.entries(data.choice_breakdown).sort(
    ([, a], [, b]) => b - a,
  );

  return (
    <CardStock title="Total card" id={electionId}>
      <div className="zv-tally zv-tally--card">
        <div className="zv-tally-total">
          <span className="zv-tally-total-value">{data.total_votes}</span>
          <span className="zv-tally-total-label">
            {data.total_votes === 1 ? "vote" : "votes"} counted
          </span>
        </div>

        <div className="zv-result-details">
          <div className="zv-result-row">
            <span className="zv-result-label">Published</span>
            <span className="zv-result-value">
              {formatTimestamp(data.published_at)}
            </span>
          </div>
        </div>

        {/* The rule and the hash of it, on one ruled line.

            These were a row in a table and a separate hash block below, which
            split the claim from the thing that proves it across a scroll. Keep
            them together: the operative words on the left are what a person
            reads, the figure in the margin is what they can recompute. Delete
            either one and the other stops meaning much. */}
        <div className="zv-clause" data-certified="true">
          <div className="zv-clause-body">
            <p className="zv-clause-words">
              Only people who met this rule could vote:{" "}
              {describeCriteria(data.criteria)}.
            </p>
            <span className="zv-clause-caption">
              <span className="zv-certify">Certified</span>
            </span>
          </div>
          <div className="zv-clause-aside">
            <span className="zv-clause-figure">{data.criteria_hash}</span>
            <span className="zv-clause-caption">rule hash</span>
          </div>
        </div>

        {sorted.length === 0 && (
          <p className="zv-card-print">No votes were counted.</p>
        )}

        {/* The signature move. Each candidate's count is printed as the bit
            pattern it is, with the powers of two down the margin — because a
            count is a pattern before it is a number, and a pattern is what this
            product hashes. */}
        <div>
          {sorted.map(([candidate, count]) => {
            const pct =
              data.total_votes > 0
                ? Math.round((count / data.total_votes) * 100)
                : 0;
            return (
              <div key={candidate} className="zv-tally-row">
                <BinaryColumn value={count} />
                <div className="zv-tally-row-header">
                  <span className="zv-tally-choice">{candidate}</span>
                  <span className="zv-tally-count">
                    {count} {count === 1 ? "vote" : "votes"}
                  </span>
                  <span className="zv-tally-share">{pct}% of total</span>
                </div>
              </div>
            );
          })}
          <p className="zv-bits-caption">
            binary column · most significant place at the top
          </p>
        </div>
      </div>

      <HashBlock
        label="Merkle root"
        value={data.merkle_root}
        tone="live"
        hint="Recomputed from every commitment in this tally. Anyone can check a ballot against it."
      />
    </CardStock>
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
        message="This browser did not record the enrolment for this election — you may have joined on another one. The commitment and reveal salt from your download are accepted on the other two tabs."
      />
    );
  }

  return (
    <CardStock title="Ballot receipt" id={seal.electionId ?? ""} sealed sealedSub="KEPT BY YOU">
      <div className="zv-card-print">
        Recorded by this browser when you voted. Nothing here identifies your
        choice to the server — the reveal salt is what unlocks it, and it stays
        here.
      </div>

      {seal.commitment && (
        <div className="zv-card-field">
          <span className="zv-label-text">Ballot commitment</span>
          <code className="zv-card-hash">{seal.commitment}</code>
          <span className="zv-form-hint">
            Safe to share. This is what an observer checks with Verify.
          </span>
        </div>
      )}
      {seal.revealSalt && (
        <div className="zv-card-field zv-card-field--secret">
          <span className="zv-label-text">
            <Hole tone="risk" />
            {" "}
            Reveal salt — keep secret
          </span>
          <code className="zv-card-hash">{seal.revealSalt}</code>
          <span className="zv-form-hint">
            Whoever holds this can read your choice. Do not share it.
          </span>
        </div>
      )}

      {!seal.commitment && !seal.revealSalt && (
        <p className="zv-card-print">
          This browser stored the enrolment but not the receipt — the ballot was
          cast somewhere else, or in a session that has since been cleared.
        </p>
      )}
    </CardStock>
  );
};

const InclusionProofPanel: React.FC<{
  electionId: string;
  storedCommitment?: string;
}> = ({ electionId, storedCommitment }) => {
  const [commitment, setCommitment] = useState(storedCommitment ?? "");
  const { loading, result, error, run, clear } = useSubmit<{
    included: boolean;
    merkle_root?: string;
    siblings?: { hash: string; side: "left" | "right" }[];
  }>();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading || commitment.trim() === "") return;
    // Compared as the server will compare it. A pasted commitment that differs in
    // casing must not read as "not in this tally".
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
            "The proof does not reproduce the published root. This ballot was not in that tally.",
          );
        }
      }
      return proof;
    });
  };

  const malformed = commitment.trim() !== "" && !looksLikeHash(commitment);

  return (
    <Card>
      <form className="zv-form" onSubmit={handleSubmit} noValidate>
        {error && <Alert type="error" title="Not Proven" message={error} />}

        {result && (
          <Alert
            type={result.included ? "success" : "warning"}
            title={result.included ? "Ballot proven" : "Not in this tally"}
            message={
              result.included
                ? `Recomputed the Merkle path from your commitment to the published root, in this browser. The path matches, so your ballot was counted.`
                : "No proof was returned, so this commitment was not part of the published tally."
            }
          />
        )}

        <Field
          label="Ballot Commitment"
          required
          placeholder="From your vote receipt"
          value={commitment}
          onChange={(e) => setCommitment(e.target.value)}
          controlClassName="zv-mono"
          autoComplete="off"
          disabled={loading}
          error={malformed ? "That is not a 64-character SHA-256 hash" : undefined}
          hint={
            storedCommitment
              ? "Filled in from this device's own record. Paste another to check someone else's."
              : "The 64-character hash printed when you voted."
          }
        />

        <div className="zv-form-actions">
          <Button
            type="submit"
            variant="primary"
            isLoading={loading}
            disabled={commitment.trim() === "" || malformed}
          >
            Check proof
          </Button>
          {result && (
            <Button variant="ghost" size="sm" onClick={clear}>
              Clear
            </Button>
          )}
        </div>
      </form>
    </Card>
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
      setError("Both the commitment and the reveal salt are needed.");
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
        "No ballot key on this device for this election. Revealing needs the key the commitment was made against, which only the browser that enrolled here has.",
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
              ? "No candidate on the list matches that commitment and salt. Check both values for typos."
              : "Found by searching the fixed candidate list in this browser. The server and the admin never learn this."
          }
        />
      )}
      {error && <Alert type="error" title="Cannot Reveal" message={error} />}

      <div className="zv-form">
        <Field
          label="Ballot commitment"
          placeholder="From your vote receipt"
          value={commitment}
          onChange={(e) => setCommitment(e.target.value)}
          controlClassName="zv-mono"
          autoComplete="off"
        />
        <Field
          label="Reveal salt"
          placeholder="Also from your vote receipt"
          value={salt}
          onChange={(e) => setSalt(e.target.value)}
          controlClassName="zv-mono"
          autoComplete="off"
          hint="This stays in this page. It is never sent to the server, which is what makes the reveal private."
        />
        <div className="zv-form-actions">
          <Button
            variant="primary"
            onClick={handleReveal}
            disabled={commitment.trim() === "" || salt.trim() === ""}
          >
            Reveal
          </Button>
        </div>
      </div>
    </Card>
  );
};
