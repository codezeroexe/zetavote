import React, { useEffect, useState } from "react";
import { api } from "../../services/api";
import type { AuditVerifyResponse } from "../../types/api";
import { Alert } from "../../components/common/Alert";

/**
 * The left column of the signed-out page: what this is, and how to check it.
 *
 * It exists because the signed-out page was the only screen a stranger saw, and
 * it said "Sign in to vote" and nothing else — so the app's central claim, that
 * a vote is secret, counted once, recorded, and checkable afterwards, was
 * asserted by nobody and shown to nobody.
 *
 * Two constraints shaped it. The words are plain, because a first-time voter
 * must not have to learn Ed25519 to use the app, so every mechanism is named in
 * the margin where it belongs rather than in the sentence. And every line pairs
 * a claim with the thing that backs it, which is why the margin of the chain
 * line carries the real genesis hash rather than the name of the algorithm.
 *
 * The verdict is fetched from `GET /api/audit/verify`, which is public, so the
 * claim on screen is the machine's own recomputation of the log rather than a
 * sentence about it. When it cannot be fetched nothing is rendered: an offline
 * notice already says so, and inventing a figure would be the one thing this
 * column must never do.
 */

interface Pledge {
  words: string;
  /** The mechanism, in the margin. */
  figure: string;
  caption: string;
}

export const FrontDoor: React.FC<{ title: string; note: string }> = ({
  title,
  note,
}) => {
  const [chain, setChain] = useState<AuditVerifyResponse | null>(null);

  useEffect(() => {
    let current = true;
    void api
      .verifyAudit()
      .then((answer) => current && setChain(answer))
      // A machine that cannot be reached says so in its own banner; this column
      // has nothing true to add, so it stays empty rather than filling the gap.
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, []);

  const pledges: Pledge[] = [
    {
      words:
        "Your ballot is sealed before it leaves this browser. The server stores only the sealed text.",
      figure: "AES-GCM",
      caption: "sealed ballot",
    },
    {
      words:
        "One account casts one ballot per election. A second attempt is refused at the door.",
      figure: "server-side check",
      caption: "one per account",
    },
    {
      words:
        "Every entry keeps the fingerprint of the entry before it, so an edit breaks every line after it.",
      figure: chain ? `${chain.genesis.slice(0, 16)}…` : "SHA-256",
      caption: "chain genesis",
    },
    {
      words:
        "The published count carries one fingerprint built from every ballot in it.",
      figure: "Merkle root",
      caption: "count fingerprint",
    },
  ];

  return (
    <div className="zv-door">
      <header className="zv-page-header">
        <h1 className="zv-page-title">{title}</h1>
        <p className="zv-page-subtitle">{note}</p>
      </header>

      {/* The one measured figure on the page, and it sits directly under the
          claim it measures: nothing above it asserts anything. */}
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
              ? `Recomputed from scratch when this page loaded, by re-reading the log on disk. Genesis ${chain.genesis.slice(0, 16)}…`
              : "An entry has been altered or removed. Treat the results as untrustworthy."
          }
          live={false}
        />
      )}

      {/* The claim and the mechanism that backs it, printed on the machine's own
          specimen card rather than stacked on the page. A guarantee that has no
          figure beside it is the thing this product exists to avoid, so the two
          are the same row. */}
      <section className="zv-door-panel" aria-labelledby="zv-door-title">
        <h2 id="zv-door-title" className="zv-door-title">
          What this machine guarantees
        </h2>
        <p className="zv-door-lead">
          Each row names the mechanism behind the claim, so the claim can be
          checked rather than believed.
        </p>

        <div className="zv-clause-set">
          {pledges.map((pledge) => (
            <div className="zv-clause zv-clause--pledge" key={pledge.caption}>
              <div className="zv-clause-body">
                <p className="zv-clause-words">{pledge.words}</p>
              </div>
              <div className="zv-clause-aside">
                <span className="zv-clause-figure">{pledge.figure}</span>
                <span className="zv-clause-caption">{pledge.caption}</span>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};