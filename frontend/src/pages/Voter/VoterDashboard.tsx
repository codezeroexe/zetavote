import React, { useEffect, useState } from "react";
import { Skeleton } from "../../components/common/Skeleton";
import { api } from "../../services/api";
import { useSession } from "../../auth/SessionContext";
import { describeCriteria } from "../../services/ageRule";
import type { MyElection } from "../../types/api";
import { Button } from "../../components/common/Button";
import { Alert } from "../../components/common/Alert";
import { CopyButton } from "../../components/common/CopyButton";
import {
  Tallies,
  WindowCountdown,
} from "../../components/common/ElectionFacts";
import { StateMark, type Tone } from "../../components/common/Hole";
import { Enrol } from "./Enrol";
import { CastVote } from "./CastVote";
import { ResultsPanel, type ResultsTab } from "./ResultsPanel";

type Action = "enrol" | "vote" | "receipt" | "results";

/**
 * The voter's home: every election, from their point of view.
 *
 * Rows are ordered by what they can still do about them. A voter opening this
 * has one question — "is there anything here I have to do before it closes?" —
 * and an unsorted list of three identically-styled cards makes them read all
 * three to answer it. So: a ballot waiting to be cast first, then an election
 * they can still join, then one they missed, then the ones already done.
 *
 * Every row is answered by one query scoped to the session, so this cannot be
 * used to learn whether anyone else enrolled or voted.
 */

/** Lower sorts first. See `rank` below. */
const RANK: Record<string, number> = {
  ready: 0,
  none: 1,
  missed: 2,
  voted: 3,
  closed: 4,
  ineligible: 5,
};

export const VoterDashboard: React.FC = () => {
  const { subject } = useSession();
  const [elections, setElections] = useState<MyElection[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<{
    kind: Action;
    id: string;
    name: string;
    /** Set by CastVote once the ballot is stored, so the heading stops
        describing a form that is no longer on screen. */
    recorded?: boolean;
    /** Which results view is on screen, so the heading names it. */
    tab?: ResultsTab;
  } | null>(null);

  const load = React.useCallback(async () => {
    setRefreshing(true);
    try {
      const { elections: rows } = await api.myElections();
      setElections(rows);
      setError(null);
    } catch {
      setError("Could not load your elections");
    } finally {
      setRefreshing(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const ordered = [...(elections ?? [])].sort((a, b) => {
    const byRank = (RANK[rank(a)] ?? 9) - (RANK[rank(b)] ?? 9);
    if (byRank !== 0) return byRank;
    // Within a group, whichever closes soonest comes first.
    return (a.ends_at ?? "9999").localeCompare(b.ends_at ?? "9999");
  });

  // The heading names what is on screen. It used to read "Your ballots" above
  // a ballot form and a receipt, which is the one heading a person cannot act on.
  const RESULTS_TITLES: Record<ResultsTab, [string, string]> = {
    summary: ["Published results", "The count, and the proof underneath it."],
    receipt: ["Your ballot receipt", "What this browser recorded when you voted."],
    proof: ["Prove your ballot was counted", "Recomputed here, against the published root."],
    reveal: ["Reveal your vote", "Searched in this browser. The server never learns it."],
  };

  const TITLES: Record<Action | "recorded", [string, string]> = {
    enrol: ["Join an election", "This adds you to its eligible list. It is one ballot, in this election only."],
    vote: [
      "Cast your ballot",
      "One ballot per enrolment. The server rejects a second, and your choice is encrypted before it leaves this page.",
    ],
    recorded: [
      "Your ballot is recorded",
      "The receipt below is the proof. Download it before you close this page.",
    ],
    receipt: ["Your ballot receipt", "What this browser recorded when you voted."],
    results: ["Published results", "The count, and the proof underneath it."],
  };
  const heading =
    action?.kind === "vote" && action.recorded ? "recorded" : action?.kind;
  // A results panel reports its own visible view upward, so the heading follows
  // the tab rather than the button that opened it.
  const [title, note] =
    action && (action.kind === "receipt" || action.kind === "results")
      ? RESULTS_TITLES[action.tab ?? (action.kind === "receipt" ? "receipt" : "summary")]
      : heading
        ? TITLES[heading]
        : ["Your ballots", ""];

  return (
    <div className="zv-page-container">
      <header className="zv-page-header">
        <h1 className="zv-page-title">{title}</h1>
        <p className="zv-page-subtitle">
          {action ? (
            note
          ) : (
            <>
              Signed in as <code className="zv-mono">{subject}</code>
            </>
          )}
        </p>
      </header>

      {action ? (
        <section className="zv-admin-sections">
          {action.kind === "enrol" && (
            <Enrol
              electionId={action.id}
              electionName={action.name}
              onDone={async () => {
                setAction(null);
                await load();
              }}
            />
          )}
          {action.kind === "vote" && (
            <CastVote
              electionId={action.id}
              electionName={action.name}
              onRecorded={() =>
                setAction((a) => (a === null ? null : { ...a, recorded: true }))
              }
              onDone={async () => {
                setAction(null);
                await load();
              }}
            />
          )}
          {(action.kind === "receipt" || action.kind === "results") && (
            <ResultsPanel
              electionId={action.id}
              electionName={action.name}
              openTab={action.kind === "receipt" ? "receipt" : "summary"}
              onTabChange={(tab) => setAction((a) => (a ? { ...a, tab } : a))}
              onClose={() => setAction(null)}
            />
          )}
        </section>
      ) : (
        <div className="zv-admin-sections">
          <section className="zv-admin-section">
            <header className="zv-admin-section-header">
              <h2 className="zv-admin-section-title">Elections</h2>
              <p className="zv-admin-section-desc">
                Vote counts appear once an election closes, so nobody can see
                whether you have already voted while the window is still open.
              </p>
            </header>

            {error && (
              <Alert type="error" title="Could not load" message={error} />
            )}

            {elections === null && !error && (
              <Skeleton label="Loading your elections" rows={3} />
            )}

            {elections !== null && elections.length === 0 && (
              <Alert
                type="info"
                title="No elections yet"
                message="An admin needs to create one before you can join it. There is nothing for you to do until then."
              />
            )}

            <div className="zv-election-list">
              {ordered.map((election) => (
                <ElectionRow
                  key={election.id}
                  election={election}
                  onAct={(kind) =>
                    setAction({ kind, id: election.id, name: election.name })
                  }
                />
              ))}
            </div>

            {elections !== null && elections.length > 0 && (
              <div className="zv-form-actions">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void load()}
                  isLoading={refreshing}
                >
                  Refresh
                </Button>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
};

/**
 * Which of six states this row is in. `eligible` is the server's answer,
 * computed against this account's own date of birth, which the browser never
 * sees — without it the row offered a Join button that could only ever fail
 * with a 403.
 */
function rank(election: MyElection): string {
  if (election.voted) return "voted";
  if (election.registered) {
    return election.accepting_votes ? "ready" : "missed";
  }
  if (!election.eligible) return "ineligible";
  return election.accepting_votes ? "none" : "closed";
}

const ElectionRow: React.FC<{
  election: MyElection;
  onAct: (kind: Action) => void;
}> = ({ election, onAct }) => {
  const state = rank(election);

  const labels: Record<string, { text: string; tone: Tone }> = {
    // A cast ballot is a card already punched, so it takes the struck slot and
    // not the punched one. It is the only row here whose work is finished and
    // cannot be resumed, and it must not look like the rows still waiting on
    // this person.
    voted: { text: "Ballot cast", tone: "spent" },
    ready: { text: "Joined — ready to vote", tone: "live" },
    // Needs a person, and nothing is destroyed: a part-made hole, not the
    // exception ink. That ink is spent on what is void.
    missed: { text: "Missed this one", tone: "warn" },
    none: { text: "Open — you can join", tone: "live" },
    ineligible: { text: "Not eligible for this one", tone: "muted" },
    closed: { text: "Closed to new voters", tone: "muted" },
  };
  const label = labels[state];

  // The candidate list and the age rule decide whether joining is worth anything.
  // Neither was on the card, so a voter joined before knowing what they were
  // voting for, or found out they were ineligible only after trying.
  const [detail, setDetail] = useState<{
    candidates: string[];
    criteria: { min_age: number | null; max_age: number | null } | null;
  } | null>(null);

  useEffect(() => {
    let current = true;
    void api
      .getElection(election.id)
      .then((full) => {
        if (!current) return;
        setDetail({
          candidates: full.candidates,
          criteria: full.criteria ?? null,
        });
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [election.id]);

  return (
    <article
      // A row is a card in the tray: warm stock, the keying gutter down its
      // leading edge, the election's own name printed in the card's ink. The two
      // rows that have something to do about them carry a ringed hole in the
      // gutter, so a voter scanning the list finds the ones that need a decision
      // without reading a word of them.
      className="zv-election-card zv-card-stock"
      data-state={
        state === "ready" ? "ready" : state === "missed" ? "urgent" : undefined
      }
    >
      <div className="zv-election-card-main">
        <div className="zv-election-card-head">
          <h3 className="zv-election-card-title">{election.name}</h3>
          <code className="zv-election-card-id zv-mono">{election.id}</code>
          <CopyButton value={election.id} label="Election id" />
        </div>
        {election.description && (
          <p className="zv-election-card-desc">{election.description}</p>
        )}

        {detail && detail.candidates.length > 0 && (
          <p className="zv-card-detail">
            <span className="zv-card-detail-label">Candidates</span>
            <span className="zv-card-detail-value">
              {detail.candidates.join(" · ")}
            </span>
          </p>
        )}

        {detail?.criteria && (
          <p className="zv-card-detail">
            <span className="zv-card-detail-label">Who can vote</span>
            <span className="zv-card-detail-value">
              {describeCriteria(detail.criteria)}
            </span>
          </p>
        )}

        <div className="zv-election-card-meta">
          <StateMark tone={label.tone}>{label.text}</StateMark>
          {election.accepting_votes && (
            <WindowCountdown
              startsAt={election.starts_at}
              endsAt={election.ends_at}
            />
          )}
        </div>

      </div>

      <div className="zv-election-card-foot">
        {election.counts ? (
          <Tallies
            ballots={election.counts.ballots}
            registered={election.counts.registered}
            turnout={election.counts.turnout}
          />
        ) : (
          <span className="zv-counts-note">
            Counts appear once this election closes.
          </span>
        )}
        <div className="zv-election-card-actions">
          {state === "none" && (
            <Button variant="primary" size="sm" onClick={() => onAct("enrol")}>
              Join
            </Button>
          )}
          {state === "ineligible" && (
            <span className="zv-vote-closed-note">
              {detail?.criteria
                ? `${describeCriteria(detail.criteria)} — this excludes you`
                : "This election's age rule excludes you"}
            </span>
          )}
          {state === "closed" && (
            <span className="zv-vote-closed-note">Closed to new voters</span>
          )}
          {/* The one action on this page that has a deadline behind it, so it
              is the one that gets the solid fill. */}
          {state === "ready" && (
            <Button variant="primary" size="sm" onClick={() => onAct("vote")}>
              Cast vote
            </Button>
          )}
          {/* Everything else here is looking back, so it is quiet. */}
          {state === "voted" && (
            <Button variant="outline" size="sm" onClick={() => onAct("receipt")}>
              My receipt
            </Button>
          )}
          {state === "missed" && (
            <Button variant="outline" size="sm" onClick={() => onAct("results")}>
              View results
            </Button>
          )}
        </div>
      </div>
    </article>
  );
};
