import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Skeleton } from "../../components/common/Skeleton";
import { api } from "../../services/api";
import { useSession } from "../../auth/SessionContext";
import { formatTimestamp } from "../../services/format";
import type {
  ElectionSummary,
  AuditEntry,
  AuditVerifyResponse,
} from "../../types/api";
import { Button } from "../../components/common/Button";
import { Alert } from "../../components/common/Alert";
import { Field } from "../../components/common/Field";
import { PageToolbar } from "../../components/common/PageToolbar";
import { useToast } from "../../components/common/Toast";
import { StatusPill } from "../../components/common/StatusPill";
import { matchesShortcut } from "../../hooks/usePlatform";
import { CreateElection } from "./CreateElection";
import { FinishElection } from "./FinishElection";
import { ManageMenu } from "./ManageMenu";
import { BlockList } from "./BlockList";

/** How many audit entries one page holds. Stated in the UI, never implied. */
const AUDIT_PAGE = 100;

type Tab = "elections" | "audit";
type View =
  | { kind: "list" }
  | { kind: "create" }
  | { kind: "finish"; id: string }
  | { kind: "details"; id: string };

type Status = "open" | "ready" | "results";
const STATUS_LABEL: Record<Status, string> = {
  open: "Open",
  ready: "Ready to count",
  results: "Results out",
};

/** What each audit action means, in the words the log is read in. The raw name
    stays in the log file; the screen says what happened. */
const ACTION_LABELS: Record<string, string> = {
  "bootstrap-admin": "Admin account set up",
  "create-account": "Account created",
  create: "Election created",
  enrol: "Joined election",
  vote: "Ballot accepted",
  close: "Voting closed",
  tally: "Votes counted",
  "rotate-seal": "Sign-in key re-sealed",
  "block-account": "Account blocked",
  "unblock-account": "Account unblocked",
};

const turnoutText = (e: ElectionSummary) =>
  `${e.ballots} of ${e.registered}` +
  (e.turnout === null ? "" : ` (${Math.round(e.turnout * 100)}%)`);

export const AdminPage: React.FC = () => {
  const { subject } = useSession();
  const [tab, setTab] = useState<Tab>("elections");
  const [view, setView] = useState<View>({ kind: "list" });
  const [elections, setElections] = useState<ElectionSummary[] | null>(null);
  const [tallied, setTallied] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { elections: rows } = await api.listElections();
      // Whether results are out is not on the list; a closed election has them
      // once the published-results call stops answering 404.
      const done = await Promise.all(
        rows
          .filter((r) => !r.active)
          .map((r) =>
            api.getResults(r.id).then(
              () => r.id,
              () => null,
            ),
          ),
      );
      setTallied(new Set(done.filter((x): x is string => x !== null)));
      setElections(rows);
      setError(null);
    } catch {
      setError("Could not load the election list. Your session may have expired.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // New election shortcut (Cmd+N on Mac, Ctrl+N elsewhere).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || !matchesShortcut(e, { key: "N" })) return;
      e.preventDefault();
      setTab("elections");
      setView({ kind: "create" });
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const goList = () => {
    setTab("elections");
    setView({ kind: "list" });
    void load();
  };

  const statusOf = (e: ElectionSummary): Status =>
    e.active ? "open" : tallied.has(e.id) ? "results" : "ready";

  const current =
    view.kind === "finish" || view.kind === "details"
      ? elections?.find((e) => e.id === view.id)
      : undefined;

  const tabs = (
      <div className="zv-tabs zv-a-tabs" role="group" aria-label="Admin view">
        {(
          [
            ["elections", "Elections"],
            ["audit", "Activity record"],
          ] as [Tab, string][]
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={tab === value}
            className="zv-tab"
            onClick={() => {
              setTab(value);
              if (value === "elections") setView({ kind: "list" });
            }}
          >
            {label}
          </button>
        ))}
        <span className="zv-a-who">
          Signed in as <code className="zv-mono">{subject}</code>
        </span>
      </div>
  );

  return (
    <div className="zv-page-container">
      {tab === "elections" && view.kind === "create" && (
        <PageToolbar title="Create election" />
      )}
      {tab === "elections" && view.kind === "details" && current && (
        <PageToolbar crumb={crumbTo(current.name, goList)} title={current.name} />
      )}
      {tab === "elections" && view.kind === "finish" && current && (
        <PageToolbar crumb={crumbTo(current.name, goList)} title="Finish the election" />
      )}
      {tab === "elections" && view.kind !== "list" && tabs}

      {tab === "elections" && view.kind === "list" && (
        <ElectionsPanel
          elections={elections}
          error={error}
          statusOf={statusOf}
          tabs={tabs}
          onNew={() => setView({ kind: "create" })}
          onFinish={(id) => setView({ kind: "finish", id })}
          onDetails={(id) => setView({ kind: "details", id })}
        />
      )}

      {/* Unmounted when not shown: its Ctrl+Enter submit shortcut must never
          fire from another tab. */}
      {tab === "elections" && view.kind === "create" && (
        <section className="zv-admin-section">
          <CreateElection onDone={goList} />
        </section>
      )}

      {tab === "elections" && view.kind === "finish" && current && (
        <FinishElection
          key={current.id}
          election={current}
          tallied={tallied.has(current.id)}
          onChanged={load}
          onExit={goList}
        />
      )}

      {tab === "elections" && view.kind === "details" && current && (
        <section className="zv-admin-section">
          <div className="zv-card">
            <dl className="zv-a-kv">
              <dt>Election ID</dt>
              <dd className="zv-mono">{current.id}</dd>
              <dt>Status</dt>
              <dd>{STATUS_LABEL[statusOf(current)]}</dd>
              <dt>Turnout</dt>
              <dd>{turnoutText(current)}</dd>
              {current.description && (
                <>
                  <dt>About</dt>
                  <dd>{current.description}</dd>
                </>
              )}
              <dt>Opens</dt>
              <dd>{current.starts_at ? formatTimestamp(current.starts_at) : "When created"}</dd>
              <dt>Closes</dt>
              <dd>{current.ends_at ? formatTimestamp(current.ends_at) : "By hand"}</dd>
            </dl>
          </div>
          <h2 className="zv-subsection-title">Blocked accounts</h2>
          <BlockList electionId={current.id} onDone={() => void load()} />
        </section>
      )}

      {tab === "audit" && <AuditPanel tabs={tabs} />}
    </div>
  );
};

const crumbTo = (name: string, back: () => void) => (
  <nav aria-label="Breadcrumb">
    <button type="button" className="zv-a-link" onClick={back}>
      Elections
    </button>
    <span aria-hidden="true"> › </span>
    <span>{name}</span>
  </nav>
);

const ElectionsPanel: React.FC<{
  elections: ElectionSummary[] | null;
  error: string | null;
  statusOf: (e: ElectionSummary) => Status;
  tabs: React.ReactNode;
  onNew: () => void;
  onFinish: (id: string) => void;
  onDetails: (id: string) => void;
}> = ({ elections, error, statusOf, tabs, onNew, onFinish, onDetails }) => {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | Status>("all");
  const [note, setNote] = useState("");
  const toast = useToast();

  const needle = search.trim().toLowerCase();
  const rows = useMemo(
    () =>
      (elections ?? []).filter(
        (e) =>
          (filter === "all" || statusOf(e) === filter) &&
          (needle === "" ||
            e.name.toLowerCase().includes(needle)),
      ),
    [elections, filter, needle, statusOf],
  );

  const copyId = (id: string) => {
    void navigator.clipboard
      ?.writeText(id)
      .then(() => toast.show("Election ID copied", "ok"))
      .catch(() => setNote("Could not copy. Select the ID in Details instead."));
  };

  return (
    <section className="zv-admin-section">
      <PageToolbar title="Elections">
        <input
          className="zv-input zv-a-search"
          type="search"
          aria-label="Search elections"
          placeholder="Search by name"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoComplete="off"
        />
        <select
          className="zv-input zv-a-status-filter"
          aria-label="Status"
          value={filter}
          onChange={(e) => setFilter(e.target.value as "all" | Status)}
        >
          <option value="all">All statuses</option>
          <option value="open">Open</option>
          <option value="ready">Ready to count</option>
          <option value="results">Results out</option>
        </select>
        <Button variant="primary" className="zv-a-new" onClick={onNew} shortcut={{ key: "N" }}>
          New election
        </Button>
      </PageToolbar>
      {tabs}

      {error && <Alert type="error" title="Could not load" message={error} />}
      {elections === null && !error && <Skeleton label="Loading elections" rows={3} />}
      {elections !== null && elections.length === 0 && (
        <div className="zv-card">
          <p className="zv-a-lede">
            No elections yet. Create one, then share its ID with the people who
            should vote.
          </p>
        </div>
      )}

      {elections !== null && elections.length > 0 && (
        <div className="zv-card zv-a-table-card">
          <table className="zv-a-table">
            <caption className="zv-sr-only">Elections</caption>
            <thead>
              <tr>
                <th scope="col">Election</th>
                <th scope="col">Status</th>
                <th scope="col">Turnout</th>
                <th scope="col">
                  <span className="zv-sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => {
                const status = statusOf(e);
                return (
                  <tr key={e.id}>
                    <th scope="row">
                      <span className="zv-a-name">{e.name}</span>
                      <code className="zv-mono zv-a-id">{e.id}</code>
                    </th>
                    <td>
                      <StatusPill
                        tone={status === "open" ? "open" : status === "results" ? "done" : "closed"}
                      >
                        {STATUS_LABEL[status]}
                      </StatusPill>
                    </td>
                    <td className="zv-a-num">{turnoutText(e)}</td>
                    <td className="zv-a-actions">
                      {status === "ready" && (
                        <Button variant="primary" size="sm" onClick={() => onFinish(e.id)}>
                          Count votes
                        </Button>
                      )}
                      <ManageMenu
                        label={`Manage ${e.name}`}
                        items={[
                          { label: "View details", onSelect: () => onDetails(e.id) },
                          { label: "Copy election ID", onSelect: () => copyId(e.id) },
                          ...(e.active
                            ? [
                                {
                                  label: "Close voting…",
                                  danger: true,
                                  onSelect: () => onFinish(e.id),
                                },
                              ]
                            : []),
                        ]}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows.length === 0 && (
            <p className="zv-a-lede zv-a-empty">No elections match.</p>
          )}
        </div>
      )}
      <p className="zv-sr-only" role="status">
        {note}
      </p>
      {note && <p className="zv-form-hint">{note}</p>}
    </section>
  );
};

const AuditPanel: React.FC<{ tabs: React.ReactNode }> = ({ tabs }) => {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [chain, setChain] = useState<AuditVerifyResponse | null>(null);
  const [checkedAt, setCheckedAt] = useState("");
  const [filter, setFilter] = useState("");
  const [electionFilter, setElectionFilter] = useState("");
  const [shown, setShown] = useState(AUDIT_PAGE);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [audit, verify] = await Promise.all([
        api.getAudit(electionFilter || undefined, AUDIT_PAGE),
        api.verifyAudit(),
      ]);
      setEntries(audit.entries);
      setChain(verify);
      setCheckedAt(
        new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }),
      );
      setError(null);
    } catch {
      setError("Could not read the activity record.");
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
      (ACTION_LABELS[entry.action] ?? entry.action).toLowerCase().includes(needle) ||
      entry.actor.toLowerCase().includes(needle),
  );
  const rows = visible.slice(0, shown);
  const ids = [...new Set((entries ?? []).map((entry) => entry.election_id))].sort();
  const picked = entries?.find((en) => en.entry_hash === selected);

  return (
    <section className="zv-admin-section">
      <PageToolbar title="Activity record">
        <Button variant="outline" size="sm" onClick={() => void load()} isLoading={loading}>
          Check again
        </Button>
      </PageToolbar>
      {tabs}

      {error && <Alert type="error" title="Could not read" message={error} />}

      <div className="zv-a-toolbar">
        {chain && (
          <p
            className={`zv-a-chain ${chain.valid ? "zv-a-chain-ok" : "zv-a-chain-bad"}`}
            role="status"
          >
            {chain.valid ? (
              <>
                <strong>Record intact.</strong> {chain.entries}{" "}
                {chain.entries === 1 ? "entry" : "entries"}, none changed. Checked {checkedAt}.
              </>
            ) : (
              <>
                <strong>Record broken at entry {chain.broken_at}.</strong> An entry was
                changed or removed. Don't trust the results. Checked {checkedAt}.
              </>
            )}
          </p>
        )}
      </div>

      <div className="zv-a-toolbar">
        <div className="zv-a-search">
          <Field
            label="Search"
            placeholder="Election, event, or person"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            autoComplete="off"
          />
        </div>
        <div className="zv-a-search">
          <Field
            label="Election"
            placeholder="All elections"
            value={electionFilter}
            onChange={(e) => setElectionFilter(e.target.value.trim())}
            list="zv-audit-elections"
            autoComplete="off"
          />
        </div>
        <datalist id="zv-audit-elections">
          {ids.map((id) => (
            <option key={id} value={id} />
          ))}
        </datalist>
      </div>

      {entries !== null && (
        <p className="zv-audit-scope">
          Showing {rows.length} of {visible.length} matching
          {visible.length !== entries.length ? ` (from ${entries.length} loaded)` : ""}
        </p>
      )}

      <div className="zv-card zv-a-table-card">
        <table className="zv-a-table">
          <caption className="zv-sr-only">Activity record, most recent last</caption>
          <thead>
            <tr>
              <th scope="col">Time</th>
              <th scope="col">Event</th>
              <th scope="col">Election</th>
              <th scope="col">By</th>
              <th scope="col">Result</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((entry) => {
              const on = entry.entry_hash === selected;
              return (
                <tr key={entry.entry_hash} className={on ? "zv-a-row-on" : undefined}>
                  <td className="zv-a-num">
                    <time dateTime={entry.timestamp}>{formatTimestamp(entry.timestamp)}</time>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="zv-a-link"
                      aria-pressed={on}
                      onClick={() => setSelected(on ? null : entry.entry_hash)}
                    >
                      {ACTION_LABELS[entry.action] ?? entry.action}
                    </button>
                  </td>
                  <td className="zv-mono">{entry.election_id || "—"}</td>
                  <td className="zv-mono zv-hash-truncate" title={entry.actor}>
                    {entry.actor}
                  </td>
                  <td>{entry.status}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && entries !== null && (
          <p className="zv-a-lede zv-a-empty">No entries match that search.</p>
        )}
        <div className="zv-a-detail" aria-live="polite">
          {picked ? (
            <>
              <span className="zv-label-text">Fingerprint</span>
              <div className="zv-mono zv-hash-full">{picked.entry_hash}</div>
              <div className="zv-form-hint">
                Follows <span className="zv-mono">{picked.prev_hash}</span>
              </div>
            </>
          ) : (
            <p className="zv-form-hint">Select an event to see its fingerprint.</p>
          )}
        </div>
      </div>

      {shown < visible.length && (
        <div className="zv-form-actions">
          <Button variant="outline" size="sm" onClick={() => setShown((n) => n + AUDIT_PAGE)}>
            Load {Math.min(AUDIT_PAGE, visible.length - shown)} more
          </Button>
        </div>
      )}
    </section>
  );
};
