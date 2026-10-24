import React from "react";

/**
 * Where a person is in a multi-step flow, shown above the step itself. Rounded
 * pills: the current step is named in words and underlined, completed steps carry
 * a check, so state never rests on colour alone.
 */
export const Stepper: React.FC<{ steps: string[]; current: number }> = ({
  steps,
  current,
}) => (
  <ol className="zv-stepper" aria-label="Progress">
    {steps.map((label, i) => {
      const state = i < current ? "done" : i === current ? "now" : "todo";
      return (
        <li
          key={label}
          className={`zv-stepper-step zv-stepper-${state}`}
          aria-current={state === "now" ? "step" : undefined}
        >
          <span className="zv-stepper-dot" aria-hidden="true">
            {state === "done" ? "✓" : i + 1}
          </span>
          <span className="zv-stepper-label">{label}</span>
        </li>
      );
    })}
  </ol>
);
