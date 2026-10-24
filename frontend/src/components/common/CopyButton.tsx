import React, { useCallback } from "react";
import { Hole } from "./Hole";
import { useToast } from "./Toast";

/**
 * Copy a hash, id or salt to the clipboard.
 *
 * Every value this app asks a voter to keep — the ballot commitment, the reveal
 * salt, the Merkle root — is 64 hex characters with no grouping, and selecting
 * 64 characters by hand across wrapped lines is exactly the kind of task people
 * get wrong. The Merkle root was the honest case for a control like this; the
 * rest of the app just never got one.
 */
export const CopyButton: React.FC<{
  value: string;
  /** What was copied, for the accessible name and the tooltip. */
  label?: string;
}> = ({ value, label = "Value" }) => {
  const { show } = useToast();

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // A clipboard the page is not allowed to write to, or an insecure origin.
      // Selecting the text is still the fallback, so say nothing rather than
      // reporting a copy that did not happen.
      return;
    }
    show("Copied", "ok");
  }, [value, show]);

  return (
    <button
      type="button"
      className="zv-copy-btn"
      onClick={() => void copy()}
      disabled={value === ""}
      aria-label={`Copy ${label}`}
      title={`Copy ${label}`}
    >
      Copy
    </button>
  );
};

/**
 * A hash in a block, selectable in one click, with a copy button beside it.
 *
 * `tone` is the only thing that decides how loud the block is, and it means one
 * thing each: `live` for a value that proves something, `secret` for one that
 * reveals a choice if it leaves this machine. Everything else stays neutral,
 * because a page with four coloured blocks has coloured nothing.
 */
export const HashBlock: React.FC<{
  label: string;
  value: string;
  tone?: "plain" | "live" | "secret";
  hint?: string;
}> = ({ label, value, tone = "plain", hint }) => (
  <div
    className={`zv-hash-block${tone === "plain" ? "" : ` zv-hash-block--${tone}`}`}
  >
    <div className="zv-hash-head">
      {/* The secret fields get a struck slot beside their name. A rule down one
          edge of a card is the most recognisable tell of a templated list, and
          this card does not need it: the word already says which of the two
          values is the dangerous one. */}
      <span className="zv-merkle-label">
        {tone === "secret" && (
          <>
            <Hole tone="risk" />
            {" "}
          </>
        )}
        {label}
      </span>
      <CopyButton value={value} label={label} />
    </div>
    <code className="zv-merkle-hash">{value}</code>
    {hint && <span className="zv-form-hint">{hint}</span>}
  </div>
);
