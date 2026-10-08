import React, { useEffect, useState } from "react";
import { Skeleton } from "../../components/common/Skeleton";
import { api } from "../../services/api";
import { useSession } from "../../auth/SessionContext";
import {
  formatTimestamp,
  formatTimestampCompact,
} from "../../services/format";
import type {
  ElectionSummary,
  AuditEntry,
  AuditVerifyResponse,
} from "../../types/api";
import { Button } from "../../components/common/Button";
import { Alert } from "../../components/common/Alert";
import { Field } from "../../components/common/Field";
import {
  Tallies,
  WindowCountdown,
} from "../../components/common/ElectionFacts";
import { StateMark } from "../../components/common/Hole";
import { CreateElection } from "./CreateElection";
import { CloseElection } from "./CloseElection";
import { TallyElection } from "./TallyElection";
import { BlockList } from "./BlockList";

type Tab = "elections" | "audit" | "create";

/** How many audit entries one page holds. Stated in the UI, never implied. */
const AUDIT_PAGE = 100;

/** Which panel a row has open. One at a time: two open at once is two forms
 *  asking for the same master passphrase. */
type Panel = { kind: "close" | "tally" | "blocks"; id: string } | null;

const bySoonestEnd = (a: ElectionSummary, b: ElectionSummary) =>
  (a.ends_at ?? "9999").localeCompare(b.ends_at ?? "9999");

/**
 * Admin home. The elections tab is the landing view because "what is running
 * right now, and how long is left" is the question an admin opens this to answer.
 */
export const AdminPage: React.FC = () => {
  const { subject } = useSession();
  const [tab, setTab] = useState<Tab>("elections");

  const tabs: [Tab, string][] = [
    ["elections", "Elections"],
    ["audit", "Audit chain"],
    ["create", "New election"],
  ];

  return (
    <div className="zv-page-container">
      <header className="zv-page-header">
        <h1 className="zv-page-title">Election administration</h1>
        <p className="zv-page-subtitle">
          Signed in as <code className="zv-mono">{subject}</code>
        </p>
      </header>

      <div className="zv-tabs" role="group" aria-label="Admin view">
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

      {/* Kept mounted and hidden rather than unmounted. Clicking "Audit chain"
          with half a Create Election form filled used to throw the whole form
          away, including the master passphrase, with no warning. */}
      <div hidden={tab !== "elections"}>
        <ElectionsPanel />
      </div>
      <div hidden={tab !== "audit"}>
        <AuditPanel />
      </div>
      <div hidden={tab !== "create"}>
        <CreateElection />
      </div>
    </div>
  );
};

const ElectionsPanel: React.FC = () => {
  const [elections, setElections] = useState<ElectionSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>(null);

  const load = React.useCallback(async () => {
    try {
      const { elections: rows } = await api.listElections();
      setElections(rows);
      setError(null);
    } catch {
      setError(
        "Could not load the election list. Your session may have expired.",
      );
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  // Opening one panel closes any other, and a panel for an election that is no
  // longer in the list — after a refresh that removed it — closes itself.
  React.useEffect(() => {
    if (panel === null || elections === null) return;
    if (!elections.some((e) => e.id === panel.id)) setPanel(null);
  }, [panel, elections]);

  const toggle = (kind: NonNullable<Panel>["kind"], id: string) =>
    setPanel((open) => (open?.kind === kind && open.id === id ? null : { kind, id }));

  const rows = elections ?? [];
  const open = rows.filter((e) => e.active).sort(bySoonestEnd);
  const closed = rows.filter((e) => !e.active).sort((a, b) => bySoonestEnd(b, a));

  return (
    <div className="zv-admin-sections">
      <section className="zv-admin-section">
        <header className="zv-admin-section-header">
          <h2 className="zv-admin-section-title">Elections</h2>
          <p className="zv-admin-section-desc">
            {elections === null
              ? "Every election on this machine, with live turnout."
              : elections.length === 0
                ? "Every election on this machine, with live turnout."
                : `${open.length} open · ${closed.length} closed. Open elections are listed by the time left on them.`}
          </p>
        </header>

        {error && <Alert type="error" title="Could not load" message={error} />}
        {elections === null && !error && (
          <Skeleton label="Loading elections" rows={3} />
        )}
        {elections !== null && elections.length === 0 && <FirstRunChecklist />}

        <div className="zv-election-list">
          {open.map((election) => (
            <ElectionGroup
              key={election.id}
              election={election}
              panel={panel}
              onToggle={toggle}
              onRefresh={load}
            />
          ))}
        </div>

        {closed.length > 0 && (
          <>
            <h3 className="zv-subsection-title">Closed</h3>
            <div className="zv-election-list">
              {closed.map((election) => (
                <ElectionGroup
                  key={election.id}
                  election={election}
                  panel={panel}
                  onToggle={toggle}
                  onRefresh={load}
                />
              ))}
            </div>
          </>
        )}

        {elections !== null && elections.length > 0 && (
          <div className="zv-form-actions">
            <Button variant="outline" size="sm" onClick={() => void load()}>
              Refresh
            </Button>
          </div>
        )}
      </section>
    </div>
  );
};

/**
 * One election, and whichever of its panels is open.
 *
 * The panels live here rather than in a strip at the foot of the page because
 * the two used to be separate routes to the same irreversible action: a row's
 * "Close election" button and a "Close an Election" button further down, the
 * second with an empty election field. An admin with four open elections had to
 * work out which of the two they were meant to use, and the wrong one was a
 * free-text field.
 */
const ElectionGroup: React.FC<{
  election: ElectionSummary;
  panel: Panel;
  onToggle: (kind: NonNullable<Panel>["kind"], id: string) => void;
  onRefresh: () => void | Promise<void>;
}> = ({ election, panel, onToggle, onRefresh }) => {
  const isOpen = panel !== null && panel.id === election.id;
  const showing = (kind: NonNullable<Panel>["kind"]) =>
    isOpen && panel!.kind === kind;

  return (
    <div className="zv-election-group">
      <article
        className="zv-election-card zv-card-stock"
        data-state={election.active ? "ready" : undefined}
      >
        <div className="zv-election-card-main">
          <div className="zv-election-card-head">
            <h3 className="zv-election-card-title">{election.name}</h3>
            <code className="zv-election-card-id zv-mono">{election.id}</code>
          </div>
          {election.description && (
            <p className="zv-election-card-desc">{election.description}</p>
          )}
          <div className="zv-election-card-meta">
            <StateMark tone={election.active ? "live" : "muted"}>
              {election.active ? "Open" : "Closed — sealed"}
            </StateMark>
            {election.active && (
              <WindowCountdown
                startsAt={election.starts_at}
                endsAt={election.ends_at}
              />
            )}
          </div>
        </div>

        {/* The tallies and the actions share a row, so the numbers an action
            would change and the action itself are read together. */}
        <div className="zv-election-card-foot">
          <Tallies
            ballots={election.ballots}
            registered={election.registered}
            turnout={election.turnout}
          />
          <div className="zv-election-card-actions">
            {/* Outline, not the destructive fill. An admin with four open
                elections used to be looking at four identical red buttons; the
                red belongs to the submit inside the panel it opens, at the
                moment the decision is actually made. */}
            {election.active ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onToggle("close", election.id)}
                aria-expanded={showing("close")}
              >
                Close election
              </Button>
            ) : (
              <Button
                variant="primary"
                size="sm"
                onClick={() => onToggle("tally", election.id)}
                aria-expanded={showing("tally")}
              >
                Tally and publish
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onToggle("blocks", election.id)}
              aria-expanded={showing("blocks")}
            >
              {showing("blocks") ? "Hide blocked accounts" : "Blocked accounts"}
            </Button>
          </div>
        </div>
      </article>

      {showing("close") && (
        <div className="zv-disclosure zv-disclosure-danger">
          <div className="zv-disclosure-head">
            <h3 className="zv-disclosure-title">Close {election.name}</h3>
          </div>
          <p className="zv-disclosure-note">
            Permanent. No further ballots are accepted afterwards, and it cannot
            be undone.
          </p>
          <CloseElection election={election} onDone={onRefresh} />
        </div>
      )}

      {showing("tally") && (
        <div className="zv-disclosure">
          <div className="zv-disclosure-head">
            <h3 className="zv-disclosure-title">
              Tally {election.name}
            </h3>
          </div>
          <p className="zv-disclosure-note">
            Decrypts every ballot and publishes the result. Needs the master
            passphrase even though you are already signed in.
          </p>
          <TallyElection election={election} onDone={onRefresh} />
        </div>
      )}

      {showing("blocks") && (
        <div className="zv-disclosure">
          <div className="zv-disclosure-head">
            <h3 className="zv-disclosure-title">
              Blocked accounts in {election.name}
            </h3>
          </div>
          <BlockList electionId={election.id} onDone={() => void onRefresh()} />
        </div>
      )}
    </div>
  );
};

/** The order an admin actually runs an election in, spelled out. */
const FirstRunChecklist: React.FC = () => (
  <div className="zv-checklist">
    <h3 className="zv-checklist-title">No elections yet</h3>
    <ol className="zv-checklist-steps">
      <li>
        Create one in the <strong>New election</strong> tab. The master
        passphrase it asks for is the only way to close and tally it later —
        write it down, because it cannot be recovered.
      </li>
      <li>Share the election id with the people who should vote.</li>
      <li>Each voter creates an account, then joins the election.</li>
      <li>
        When the window closes, use <strong>Close election</strong> on the row
        — that is permanent.
      </li>
      <li>
        Then <strong>Tally and publish</strong> on the same row, with the same
        master passphrase. Results publish at that point.
      </li>
    </ol>
  </div>
);

const AuditPanel: React.FC = () => {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [chain, setChain] = useState<AuditVerifyResponse | null>(null);
  const [filter, setFilter] = useState("");
  const [electionFilter, setElectionFilter] = useState("");
  const [shown, setShown] = useState(AUDIT_PAGE);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const [audit, verify] = await Promise.all([
        api.getAudit(electionFilter || undefined, AUDIT_PAGE),
        api.verifyAudit(),
      ]);
      setEntries(audit.entries);
      setChain(verify);
      setError(null);
    } catch {
      setError("Could not read the audit log.");
    } finally {
      setLoading(false);
    }
  }, [electionFilter]);

  useEffect(() => {
    void load();
    setShown(AUDIT_PAGE);
  }, [load]);

  const needle = filter.trim().toLowerCase();
  const visible = (entries ?? []).filter(
    (entry) =>
      needle === "" ||
      entry.election_id.toLowerCase().includes(needle) ||
      entry.action.toLowerCase().includes(needle) ||
      entry.actor.toLowerCase().includes(needle),
  );
  const rows = visible.slice(0, shown);
  const elections = [
    ...new Set((entries ?? []).map((entry) => entry.election_id)),
  ].sort();

  return (
    <section className="zv-admin-section">
      <header className="zv-admin-section-header">
        <h2 className="zv-admin-section-title">Audit chain</h2>
        <p className="zv-admin-section-desc">
          Append-only and hash-linked. Editing any line breaks every hash after
          it, and the log is a plain text file a reviewer can recompute by hand.
        </p>
      </header>

      {error && <Alert type="error" title="Could not read" message={error} />}

      {/* The app's central claim, so it is the one alert on the page that is a
          success and not an aside. */}
      {chain && (
        <Alert
          type={chain.valid ? "success" : "error"}
          title={
            chain.valid
              ? `Chain intact — ${chain.entries} entries`
              : `Chain broken at entry ${chain.broken_at}`
          }
          message={
            chain.valid
              ? `Genesis ${chain.genesis.slice(0, 16)}… Every entry hash was recomputed and matches.`
              : "An entry has been altered or removed. Treat the results as untrustworthy."
          }
        />
      )}

      <div className="zv-form">
        <div className="zv-form-row">
          <Field
            label="Search"
            placeholder="Election id, action, or actor"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            autoComplete="off"
            hint="Case does not matter."
          />
          <Field
            as="input"
            label="Election"
            placeholder="All elections"
            value={electionFilter}
            onChange={(e) => setElectionFilter(e.target.value.trim())}
            list="zv-audit-elections"
            autoComplete="off"
          />
          <datalist id="zv-audit-elections">
            {elections.map((id) => (
              <option key={id} value={id} />
            ))}
          </datalist>
        </div>
        <div className="zv-form-actions">
          <Button variant="outline" size="sm" onClick={() => void load()} isLoading={loading}>
            Refresh
          </Button>
          {needle !== "" && (
            <Button variant="ghost" size="sm" onClick={() => setFilter("")}>
              Clear search
            </Button>
          )}
        </div>
      </div>

      {/* The scope of the table stated above it. It used to silently show the
          newest hundred entries with no indication that anything else existed —
          on a page whose whole claim is that the log is complete. */}
      {entries !== null && (
        <p className="zv-audit-scope">
          Showing {rows.length} of {visible.length} matching
          {visible.length !== entries.length ? ` (from ${entries.length} loaded)` : ""}
          {shown < visible.length && " — Load more to see the rest"}
        </p>
      )}

      <div className="zv-audit-table-wrap">
        <table className="zv-audit-table">
          <caption className="zv-sr-only">
            Audit log entries, most recent last
          </caption>
          <thead>
            <tr>
              <th scope="col">When</th>
              <th scope="col">Election</th>
              <th scope="col">Action</th>
              <th scope="col">Actor</th>
              <th scope="col">Status</th>
              <th scope="col">Entry hash</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((entry) => (
              <tr key={entry.entry_hash}>
                {/* Was time-of-day only, so entries from different days were
                    indistinguishable in a log about sequence. The data-label
                    attributes are what this becomes below 560px, where the
                    table is a list of records instead of a grid. */}
                <td className="zv-audit-when" data-label="When">
                  <time dateTime={entry.timestamp}>
                    <span className="zv-when-full">
                      {formatTimestamp(entry.timestamp)}
                    </span>
                    <span className="zv-when-compact">
                      {formatTimestampCompact(entry.timestamp)}
                    </span>
                  </time>
                </td>
                <td className="zv-mono" data-label="Election">
                  {entry.election_id}
                </td>
                <td data-label="Action">{entry.action}</td>
                <td
                  className="zv-mono zv-hash-truncate"
                  data-label="Actor"
                  title={entry.actor}
                >
                  {entry.actor}
                </td>
                <td data-label="Status">{entry.status}</td>
                <td
                  className="zv-mono zv-hash-truncate"
                  data-label="Entry hash"
                  title={entry.entry_hash}
                >
                  {entry.entry_hash}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && entries !== null && (
          <Alert type="info" message="No entries match that search." />
        )}
      </div>

      {shown < visible.length && (
        <div className="zv-form-actions">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShown((n) => n + AUDIT_PAGE)}
          >
            Load {Math.min(AUDIT_PAGE, visible.length - shown)} more
          </Button>
        </div>
      )}
    </section>
  );
};
