import React, { useEffect, useState } from "react";
import { formatDuration, msRemaining } from "../../services/format";

/**
 * The two facts every election row shows, in one place.
 *
 * Both the admin and the voter list were building these separately, which is
 * how "1 ballots" reached the screen: the plural was hard-coded in two copies
 * and neither had a case where the count was one.
 */

/** Ballots, registered voters, and the turnout they make. Never a hero metric. */
export const Tallies: React.FC<{
  ballots: number;
  registered: number;
  /** Null when there is no denominator to divide by. */
  turnout: number | null;
}> = ({ ballots, registered, turnout }) => (
  <div className="zv-counts">
    <span className="zv-count">
      <span className="zv-count-value">{ballots}</span>
      <span className="zv-count-label">
        {ballots === 1 ? "ballot" : "ballots"}
      </span>
    </span>
    <span className="zv-count">
      <span className="zv-count-value">{registered}</span>
      <span className="zv-count-label">
        {registered === 1 ? "registered voter" : "registered"}
      </span>
    </span>
    <span className="zv-count">
      <span className="zv-count-value">
        {turnout === null ? "—" : `${Math.round(turnout * 100)}%`}
      </span>
      <span className="zv-count-label">turnout</span>
    </span>
  </div>
);

/** Under a day left, the countdown says so in the warning hue and in words. */
const SOON_MS = 24 * 60 * 60 * 1000;

/**
 * "Opens in 2d 4h", "Closes in 3h 12m", recomputed each second.
 *
 * The admin list needs the "opens in" case and the voter list does not, so this
 * is the one implementation of both rather than the two near-identical ones that
 * were here.
 */
export const WindowCountdown: React.FC<{
  startsAt: string | null;
  endsAt: string | null;
}> = ({ startsAt, endsAt }) => {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const start = startsAt ? new Date(startsAt).getTime() : null;
  const end = endsAt ? new Date(endsAt).getTime() : null;
  const startOk = start !== null && !Number.isNaN(start);
  const endOk = end !== null && !Number.isNaN(end);

  if (startOk && now < start!) {
    return <span className="zv-countdown">Opens in {formatDuration(start! - now)}</span>;
  }
  if (end === null) return <span className="zv-countdown">No end date set</span>;
  if (endOk && now < end!) {
    const left = msRemaining(endsAt) ?? 0;
    const soon = left <= SOON_MS;
    return (
      <span className={`zv-countdown${soon ? " zv-countdown--soon" : ""}`}>
        Closes in {formatDuration(left)}
      </span>
    );
  }
  return null;
};
