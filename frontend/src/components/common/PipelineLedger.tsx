import React from "react";
import { Hole, type Tone } from "./Hole";

/**
 * The vote pipeline, as a card being read by the machine.
 *
 * This is the one place in the app where work takes long enough to be worth
 * watching, and it renders only what actually happened. A row's hole is punched
 * when its step has genuinely completed, and `active` means the key is in the
 * slot and the step is in flight right now.
 *
 * It does not simulate duration. The nine-stage pipeline in `crypto.ts` is
 * synchronous between two slow stages, so there is nothing to animate across —
 * what this shows is the order things happened in, and the one step that
 * genuinely takes time (scrypt key derivation) is labelled so the wait is
 * explained rather than decorated.
 */

export type StageState = "pending" | "active" | "done" | "failed";

export type Stage = {
  id: string;
  /** What this step does, in the words a first-time voter would use. */
  label: string;
  /** The mechanism behind it, in the margin. Empty until the step has run. */
  detail?: string;
  state: StageState;
};

/** One shape per state, and the word stays beside it either way. */
const TONE: Record<StageState, Tone> = {
  pending: "pending",
  active: "pending",
  done: "live",
  failed: "risk",
};

export const PipelineLedger: React.FC<{
  stages: Stage[];
  /** Measured milliseconds, rendered only once the work has finished. */
  elapsedMs?: number | null;
  /** Why the wait is what it is. Sits under the ruled block. */
  note?: string;
}> = ({ stages, elapsedMs = null, note }) => {
  const done = stages.filter((s) => s.state === "done").length;
  const failed = stages.some((s) => s.state === "failed");
  const finished = done === stages.length && !failed;

  return (
    <div className="zv-pipeline">
      <div className="zv-pipeline-head">
        {/* Past tense once it is over. "Writing your entry" above a finished
            six-of-six is a caption that disagrees with the page. */}
        <p className="zv-pipeline-title">
          {failed
            ? "Record stopped"
            : finished
              ? "How this entry was made"
              : "Writing your entry"}
        </p>
        <span className="zv-pipeline-tally">
          {done} of {stages.length}
          {elapsedMs !== null && (
            <span className="zv-pipeline-elapsed">
              {" · "}
              {(elapsedMs / 1000).toFixed(2)}s
            </span>
          )}
        </span>
      </div>

      <div className="zv-pipeline-rows">
        {stages.map((stage, i) => (
          <div
            key={stage.id}
            className="zv-pipeline-row"
            data-state={stage.state}
          >
            <Hole tone={TONE[stage.state]} />
            <span className="zv-pipeline-index" aria-hidden="true">
              {String(i + 1).padStart(2, "0")}
            </span>
            <span className="zv-pipeline-label">
              {stage.label}
              {stage.detail && (
                <>
                  {" — "}
                  <span className="zv-clause-figure">{stage.detail}</span>
                </>
              )}
            </span>
          </div>
        ))}
      </div>

      {note && <p className="zv-pipeline-note">{note}</p>}

      {/* The ledger announces itself once, politely, and does not re-announce
          each row: a screen reader that narrates nine lines of progress is a
          worse experience than one that says how far along it is. */}
      <p aria-live="polite" className="zv-sr-only">
        {failed
          ? "Recording stopped."
          : `Recording your ballot. Step ${done} of ${stages.length} complete.`}
      </p>
    </div>
  );
};

/** The six steps that are actually separable, as opposed to the nine in the
 *  pipeline diagram. See the note above on why it is six. */
export const VOTE_STAGES = [
  {
    id: "fetch",
    label: "Read the election record",
    detail: "",
  },
  {
    id: "derive",
    label: "Derive this election's ballot key",
    // "Expensive", not "slow". It is deliberately costly, and on a fast machine
    // it measures in a fraction of a second — the elapsed figure is printed
    // beside this row, so the reader can judge the claim rather than take it.
    detail: "scrypt — deliberately expensive",
  },
  {
    id: "seal",
    label: "Seal your choice and sign the entry",
    detail: "AES-GCM + Ed25519",
  },
  {
    id: "submit",
    label: "Submit to the server",
    detail: "",
  },
  {
    id: "chain",
    label: "Validate, store, append to the chain",
    detail: "SHA-256",
  },
  {
    id: "receipt",
    label: "Issue your receipt",
    detail: "",
  },
] as const satisfies readonly { id: string; label: string; detail: string }[];

export const initialStages = (): Stage[] =>
  VOTE_STAGES.map((s) => ({ ...s, state: "pending" as StageState }));