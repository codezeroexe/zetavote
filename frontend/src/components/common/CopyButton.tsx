import React, { useCallback, useEffect, useRef, useState } from "react";
import { Hole } from "./Hole";

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
  /** What was copied, for the live region and the tooltip. */
  label?: string;
}> = ({ value, label = "Value" }) => {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // A clipboard the page is not allowed to write to, or an insecure origin.
      // Selecting the text is still the fallback, so say what happened rather
      // than reporting a copy that did not happen.
      return;
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  }, [value]);

  return (
    <>
      <button
        type="button"
        className="zv-copy-btn"
        data-copied={copied || undefined}
        onClick={() => void copy()}
        disabled={value === ""}
        aria-label={copied ? `${label} copied` : `Copy ${label}`}
        title={copied ? "Copied" : `Copy ${label}`}
      >
        {copied ? "Copied" : "Copy"}
      </button>
      <span className="zv-sr-only" role="status" aria-live="polite">
        {copied ? `${label} copied to clipboard` : ""}
      </span>
    </>
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
