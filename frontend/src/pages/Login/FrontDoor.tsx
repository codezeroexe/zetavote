import React, { useEffect, useState } from "react";
import { api } from "../../services/api";
import type { AuditVerifyResponse } from "../../types/api";
import { Alert } from "../../components/common/Alert";

/**
 * The side panel of the signed-out screens. "trust" answers why the result can
 * be believed (sign in); "next" says what the first-run setup does.
 *
 * The trust panel also shows the machine's own recomputation of the activity
 * record (public `GET /api/audit/verify`). When it cannot be fetched nothing
 * extra is rendered: an offline notice already says so, and inventing a figure
 * is the one thing this panel must never do.
 */
const PANELS = {
  trust: {
    title: "Why you can trust the result",
    points: [
      "Your vote is locked in this browser before it is sent.",
      "One person, one vote per election.",
      "The record can't be edited without it showing.",
      "You can check your own vote was counted.",
    ],
  },
  next: {
    title: "What happens next",
    points: [
      "You become the only admin.",
      "You create elections and voters register themselves.",
      "The setup code works once.",
    ],
  },
} as const;

export const FrontDoor: React.FC<{ variant: keyof typeof PANELS }> = ({
  variant,
}) => {
  const [chain, setChain] = useState<AuditVerifyResponse | null>(null);

  useEffect(() => {
    if (variant !== "trust") return;
    let current = true;
    void api
      .verifyAudit()
      .then((answer) => current && setChain(answer))
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [variant]);

  const { title, points } = PANELS[variant];

  return (
    <aside className="zv-acct-door" aria-labelledby={`zv-door-${variant}`}>
      <h2 id={`zv-door-${variant}`} className="zv-acct-door-title">
        {title}
      </h2>
      <ul className="zv-acct-door-list">
        {points.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
      {chain && (
        <Alert
          type={chain.valid ? "success" : "error"}
          title={
            chain.valid
              ? `Activity record intact: ${chain.entries} entries`
              : `Activity record broken at entry ${chain.broken_at}`
          }
          message={
            chain.valid
              ? "Checked again from scratch when this page loaded."
              : "An entry has been altered or removed. Treat the results as untrustworthy."
          }
          live={false}
        />
      )}
    </aside>
  );
};
