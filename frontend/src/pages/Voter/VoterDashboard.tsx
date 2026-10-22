import React, { useMemo, useState } from "react";
import { Skeleton } from "../../components/common/Skeleton";
import { api } from "../../services/api";
import { useSession } from "../../auth/SessionContext";
import type { MyElection } from "../../types/api";
import { Button } from "../../components/common/Button";
import { Card } from "../../components/common/Card";
import { Alert } from "../../components/common/Alert";
import { StatusPill, type PillTone } from "../../components/common/StatusPill";
import { Stub } from "../../components/common/Stub";
import { PageToolbar } from "../../components/common/PageToolbar";
import { useToast } from "../../components/common/Toast";
import { loadBallotSeal } from "../../services/crypto";
import { downloadJson } from "../../services/download";
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
    /** "I saved both codes" ticked on the receipt. Lives here because the
        Back button is in the toolbar, outside CastVote. */
    saved?: boolean;
    saveError?: boolean;
  } | null>(null);
  const [query, setQuery] = useState("");

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

  const q = query.trim().toLowerCase();
  const shown = q ? ordered.filter((e) => e.name.toLowerCase().includes(q)) : ordered;

  // The heading names what is on screen. It used to read "Your ballots" above
  // a ballot form and a receipt, which is the one heading a person cannot act on.

  const TITLES: Record<Action | "recorded", [string, string]> = {
    enrol: ["Join election", "This adds you to its eligible list. It is one ballot, in this election only."],
    vote: [
      "Cast vote",
      "One vote per person. Your choice is encrypted before it leaves this page.",
    ],
    recorded: [
      "Vote recorded",
      "The receipt below is the proof. Download it before you close this page.",
    ],
    receipt: ["Results", "Counted results, and a way to check your own vote."],
    results: ["Results", "Counted results, and a way to check your own vote."],
  };
  const heading =
    action?.kind === "vote" && action.recorded ? "recorded" : action?.kind;
  // A results panel reports its own visible view upward, so the heading follows
  // the tab rather than the button that opened it.
  const [title, note] =
    action && (action.kind === "receipt" || action.kind === "results")
      ? [`${action.name}: results`, TITLES.results[1]]
      : heading
        ? TITLES[heading]
        : ["Your ballots", ""];

  const backToBallots = (
    <Button
      variant="secondary"
      size="sm"
      onClick={() => {
        // Same gate as before: the receipt is gone once this screen closes.
        if (heading === "recorded" && !action?.saved) {
          setAction((a) => (a ? { ...a, saveError: true } : a));
          return;
        }
        setAction(null);
        void load();
      }}
    >
      Back to my ballots
    </Button>
  );

  return (
    <div className="zv-page-container">
      <PageToolbar
        title={title}
        crumb={action ? `Your ballots › ${action.name}` : undefined}
      >
        {!action && (
          <>
            <input
              type="search"
              className="zv-toolbar-search"
              aria-label="Search elections by name"
              placeholder="Search elections"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void load()}
              isLoading={refreshing}
            >
              Refresh
            </Button>
          </>
        )}
        {(heading === "recorded" || action?.kind === "receipt" || action?.kind === "results") &&
          backToBallots}
      </PageToolbar>
      {!action || note ? (
        <p className="zv-page-subtitle">
          {action ? (
            note
          ) : (
            <>
              Signed in as <code className="zv-mono">{subject}</code>
            </>
          )}
        </p>
      ) : null}

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
              saved={!!action.saved}
              saveError={!!action.saveError}
              onSavedChange={(saved) =>
                setAction((a) => (a ? { ...a, saved, saveError: false } : a))
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

            {ordered.length > 0 && shown.length === 0 && (
              <p className="zv-hint-text">No elections match “{query}”.</p>
            )}

            {shown.length > 0 && (
              <div className="zv-voter-grid">
                <Card>
                  <table className="zv-table">
                    <thead>
                      <tr>
                        <th scope="col">Election</th>
                        <th scope="col">Status</th>
                        <th scope="col">Closes</th>
                        <th scope="col">
                          <span className="zv-sr-only">Action</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map((election) => (
                        <ElectionRow
                          key={election.id}
                          election={election}
                          onAct={(kind) =>
                            setAction({ kind, id: election.id, name: election.name })
                          }
                        />
                      ))}
                    </tbody>
                  </table>
                </Card>
                <SavedReceipts elections={ordered} subject={subject ?? ""} />
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

/** Closes date for the table, or a dash once voting is over. */
function closes(election: MyElection): string {
  if (!election.accepting_votes || !election.ends_at) return "—";
  const d = new Date(election.ends_at);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

const ElectionRow: React.FC<{
  election: MyElection;
  onAct: (kind: Action) => void;
}> = ({ election, onAct }) => {
  const state = rank(election);
  // Counts only exist once the election has closed and been counted.
  const resultsOut = election.counts !== undefined;

  const status: { text: string; tone: PillTone } =
    state === "none"
      ? { text: "Open", tone: "open" }
      : state === "ready"
        ? { text: "Joined", tone: "open" }
        : state === "voted"
          ? { text: "Voted", tone: "done" }
          : state === "ineligible"
            ? { text: "Not eligible", tone: "closed" }
            : resultsOut
              ? { text: "Results out", tone: "done" }
              : { text: "Counting", tone: "closed" };

  let action: React.ReactNode;
  if (state === "none") {
    action = (
      <Button variant="primary" size="sm" onClick={() => onAct("enrol")}>
        Join
      </Button>
    );
  } else if (state === "ready") {
    action = (
      <Button variant="primary" size="sm" onClick={() => onAct("vote")}>
        Vote
      </Button>
    );
  } else if (state === "voted" && !resultsOut) {
    action = (
      <Button variant="secondary" size="sm" onClick={() => onAct("receipt")}>
        My receipt
      </Button>
    );
  } else if (resultsOut) {
    action = (
      <Button variant="secondary" size="sm" onClick={() => onAct("results")}>
        See results
      </Button>
    );
  } else {
    action = (
      <span className="zv-hint-text">
        {state === "ineligible" ? "Age rule excludes you" : "Results soon"}
      </span>
    );
  }

  return (
    <tr>
      <td>
        <strong>{election.name}</strong>
      </td>
      <td>
        <StatusPill tone={status.tone}>{status.text}</StatusPill>
      </td>
      <td>{closes(election)}</td>
      <td className="zv-table-action">{action}</td>
    </tr>
  );
};

/** Receipts kept in this browser. Read-only: nothing here leaves the device. */
const SavedReceipts: React.FC<{ elections: MyElection[]; subject: string }> = ({
  elections,
  subject,
}) => {
  const rows = useMemo(
    () =>
      elections
        .filter((e) => e.registered || e.voted)
        .map((e) => ({ e, seal: loadBallotSeal(e.id, subject) })),
    [elections, subject],
  );
  const saved = rows.filter((r) => r.seal?.commitment);
  const { show } = useToast();

  return (
    <Stub id={`${saved.length} ${saved.length === 1 ? "stub" : "stubs"}`}>
      <h3 className="zv-stub-title">Saved receipts</h3>
      <p className="zv-hint-text">On this computer</p>
      {rows.length === 0 ? (
        <p className="zv-hint-text">Nothing yet. Join an election to start.</p>
      ) : (
        <dl className="zv-receipt-list">
          {rows.map(({ e, seal }) => (
            <React.Fragment key={e.id}>
              <dt>{e.name}</dt>
              <dd>
                {seal?.commitment ? (
                  <code className="zv-mono">
                    {seal.commitment.slice(0, 4)}…{seal.commitment.slice(-4)}
                  </code>
                ) : (
                  <span className="zv-hint-text">
                    {e.voted ? "Not on this computer" : "Not voted yet"}
                  </span>
                )}
              </dd>
            </React.Fragment>
          ))}
        </dl>
      )}
      {saved.length > 0 && (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            downloadJson(
              saved.map(({ e, seal }) => ({
                election_id: e.id,
                election_name: e.name,
                receipt_code: seal?.commitment,
                private_key_for_this_receipt: seal?.revealSalt,
              })),
              "zetavote_receipts.json",
            );
            show("Receipts downloaded", "ok");
          }}
        >
          Download all
        </Button>
      )}
    </Stub>
  );
};
