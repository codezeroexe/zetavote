import React, { useId, useState } from "react";

type BaseProps = {
  label: string;
  /** Renders the red asterisk and blocks submit when empty. */
  required?: boolean;
  /** Adds .zv-input-error and shows the message under the control. */
  error?: string;
  /** Always-visible muted guidance under the control. */
  hint?: string;
  /** Extra classes on the control, e.g. "zv-mono" for hashes. */
  controlClassName?: string;
  /**
   * Adds a Show / Hide button beside the control. Nine passphrases in this app
   * cannot be recovered by anyone, the user included, so a mistyped one has to be
   * catchable before it costs somebody their account.
   */
  revealable?: boolean;
};

type FieldProps = BaseProps &
  (
    | ({ as?: "input" } & React.InputHTMLAttributes<HTMLInputElement>)
    | ({ as: "textarea"; rows?: number } & React.TextareaHTMLAttributes<HTMLTextAreaElement>)
  );

/**
 * The label + control + hint/error trio that all 18 form fields in the app
 * repeated.
 *
 * The wrapper is a div holding a real `<label for>` rather than a label wrapping
 * the control, for two reasons that both showed up as bugs: a hint or error is
 * only reachable by a screen reader if the control can point at it by id, and a
 * `<button>` nested inside a `<label>` fires the label's activation as well as
 * its own — which is what made a reveal toggle flip twice.
 *
 * The class names are unchanged, so no selector in App.css moves.
 */
export const Field: React.FC<FieldProps> = ({
  label,
  required,
  error,
  hint,
  as,
  controlClassName = "",
  revealable = false,
  ...props
}) => {
  const uid = useId();
  const controlId = `${uid}-control`;
  const hintId = `${uid}-hint`;
  const errorId = `${uid}-error`;
  const [revealed, setRevealed] = useState(false);

  const describedBy =
    [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") ||
    undefined;
  const controlClass = `zv-input ${controlClassName} ${error ? "zv-input-error" : ""}`.trim();
  const shared = { id: controlId, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined };

  let control: React.ReactNode;
  if (as === "textarea") {
    control = (
      <textarea
        className={`${controlClass} zv-textarea`}
        {...shared}
        {...(props as React.TextareaHTMLAttributes<HTMLTextAreaElement>)}
      />
    );
  } else if (revealable) {
    const { type = "password", ...rest } = props as React.InputHTMLAttributes<HTMLInputElement>;
    control = (
      <div className="zv-reveal-wrap">
        <input
          className={`${controlClass} zv-reveal-input`}
          {...shared}
          {...rest}
          type={revealed ? "text" : type}
        />
        <button
          type="button"
          className="zv-reveal-btn"
          aria-pressed={revealed}
          onClick={() => setRevealed((on) => !on)}
        >
          {revealed ? "Hide" : "Show"}
        </button>
      </div>
    );
  } else {
    control = (
      <input
        className={controlClass}
        required={required}
        {...shared}
        {...(props as React.InputHTMLAttributes<HTMLInputElement>)}
      />
    );
  }

  return (
    <div className="zv-form-label">
      <label className="zv-label-text" htmlFor={controlId}>
        {label} {required && <span className="zv-required">*</span>}
      </label>
      {control}
      {hint && (
        <span className="zv-form-hint" id={hintId}>
          {hint}
        </span>
      )}
      {error && (
        <span className="zv-form-error-hint" id={errorId}>
          {error}
        </span>
      )}
    </div>
  );
};
