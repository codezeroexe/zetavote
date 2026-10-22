import React, { useEffect, useState } from "react";
import type { ElectionSummary, TallyResponse } from "../../types/api";
import { api } from "../../services/api";
import { Button } from "../../components/common/Button";
import { Alert } from "../../components/common/Alert";
import { Stepper } from "../../components/common/Stepper";
import { HashBlock } from "../../components/common/CopyButton";
import { CloseElection } from "./CloseElection";
import { TallyElection } from "./TallyElection";

const STEPS = ["Close voting", "Count votes", "Publish"];

interface Outcome {
  total_votes: number;
  choice_breakdown: Record<string, number>;
  merkle_root: string;
  rejected?: number;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** One sentence naming the winner, or the tie, or the empty count. */
function winnerSentence(o: Outcome): string {
  const rows = Object.entries(o.choice_breakdown).sort(([, a], [, b]) => b - a);
  if (rows.length === 0 || o.total_votes === 0) return "No votes were cast.";
  const top = rows[0][1];
  const leaders = rows.filter(([, n]) => n === top).map(([name]) => name);
  if (leaders.length > 1)
    return `${leaders.join(" and ")} tied with ${top} ${plural(top, "vote", "votes")}.`;
  return `${leaders[0]} won with ${top} ${plural(top, "vote", "votes")}.`;
}

/**
 * Close voting, count votes, publish: one flow with a stepper. The step is
 * derived from the election's state, so a reload or a half-finished election
 * lands on the right step.
 */
export const FinishElection: React.FC<{
  election: ElectionSummary;
  tallied: boolean;
  onChanged: () => void | Promise<void>;
  onExit: () => void;
}> = ({ election, tallied, onChanged, onExit }) => {
  const [counted, setCounted] = useState<TallyResponse | null>(null);
  const [fetched, setFetched] = useState<Outcome | null>(null);
  const [showBreakdown, setShowBreakdown] = useState(false);

  const done = counted !== null || tallied;
  const step = election.active ? 0 : done ? 2 : 1;

  // Already counted earlier: read the published figures instead of counting.
  useEffect(() => {
    if (!tallied || counted) return;
    let live = true;
    api
      .getResults(election.id)
      .then((r) => live && setFetched(r))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [tallied, counted, election.id]);

  const outcome: Outcome | null = counted
    ? { ...counted, rejected: counted.rejected_ballots }
    : fetched;
  const pct = election.turnout === null ? "" : ` (${Math.round(election.turnout * 100)}%)`;
  const turnout = `${election.ballots} of ${election.registered}${pct}`;

  return (
    <div className="zv-a-flow">
      <Stepper steps={STEPS} current={step} />

      <div className="zv-a-grid">
        {step === 0 && (
          <>
            <div className="zv-card">
              <CloseElection election={election} onCancel={onExit} onDone={onChanged} />
            </div>
            <aside className="zv-card zv-a-side">
              <h2 className="zv-a-side-title">What closing does</h2>
              <dl className="zv-a-kv">
                <dt>Turnout now</dt>
                <dd>{turnout}</dd>
                <dt>After closing</dt>
                <dd>No one can vote. This can't be undone.</dd>
                <dt>Next</dt>
                <dd>Count votes</dd>
              </dl>
            </aside>
          </>
        )}

        {step === 1 && (
          <>
            <div className="zv-card">
              <p className="zv-a-lede">
                Voting is closed. Count the votes to publish the results.
              </p>
              <TallyElection
                election={election}
                onCounted={(r) => {
                  setCounted(r);
                  void onChanged();
                }}
              />
            </div>
            <aside className="zv-card zv-a-side">
              <h2 className="zv-a-side-title">What counting does</h2>
              <dl className="zv-a-kv">
                <dt>Ballots to count</dt>
                <dd>{turnout}</dd>
                <dt>After counting</dt>
                <dd>Results become visible to voters.</dd>
              </dl>
            </aside>
          </>
        )}

        {step === 2 && (
          <>
            <div className="zv-card">
              {outcome ? (
                <>
                  <Alert
                    type="success"
                    title={`${outcome.total_votes} ${plural(outcome.total_votes, "vote", "votes")} counted`}
                    message={`${winnerSentence(outcome)} Results are now visible to voters.`}
                  />
                  {!!outcome.rejected && (
                    <Alert
                      type="warning"
                      title={`${outcome.rejected} ${plural(outcome.rejected, "ballot was", "ballots were")} left out`}
                      message="They failed a check or named someone not on the list. They are recorded in the activity record."
                    />
                  )}
                  {showBreakdown && (
                    <ul className="zv-a-results" aria-label="Results">
                      {Object.entries(outcome.choice_breakdown)
                        .sort(([, a], [, b]) => b - a)
                        .map(([name, n]) => (
                          <li key={name}>
                            <span>{name}</span>
                            <span>
                              {n} {plural(n, "vote", "votes")}
                              {outcome.total_votes > 0 &&
                                ` · ${Math.round((n / outcome.total_votes) * 100)}%`}
                            </span>
                          </li>
                        ))}
                    </ul>
                  )}
                </>
              ) : (
                <p className="zv-a-lede">Loading results…</p>
              )}
              <div className="zv-form-actions">
                <Button
                  variant="primary"
                  onClick={() => setShowBreakdown((v) => !v)}
                  aria-expanded={showBreakdown}
                  disabled={!outcome}
                >
                  {showBreakdown ? "Hide results" : "View results"}
                </Button>
                <Button variant="outline" onClick={onExit}>
                  Back to elections
                </Button>
              </div>
            </div>
            <aside className="zv-card zv-a-side">
              <h2 className="zv-a-side-title">Proof for observers</h2>
              <p className="zv-a-lede">Share this so anyone can check the count.</p>
              {outcome && (
                <HashBlock label="Results fingerprint" value={outcome.merkle_root} tone="live" />
              )}
              <details className="zv-a-tech">
                <summary>Technical details</summary>
                The results fingerprint is the Merkle root over all receipt codes.
              </details>
            </aside>
          </>
        )}
      </div>
    </div>
  );
};
