import React from "react";

/**
 * The world, as four small components.
 *
 * Everything here is drawn rather than imported: a card hole is a shape, a
 * binary column is a set of shapes, and a stamp is a stamp. No icon library and
 * no glyph standing in for any of them.
 */

/* --------------------------------------------------------------------------
   The hole

   One measurement, five keyway shapes, and that is the entire state system. The
   shape is the first channel and the ink is the last, so a punched mark, a
   part-made chad and a struck slot are distinguishable in greyscale, to a
   colour-blind reader and on a monochrome print.
   -------------------------------------------------------------------------- */

export type Tone = "live" | "pending" | "warn" | "spent" | "risk" | "muted";

export const Hole: React.FC<{
  tone: Tone;
  /** Hidden from assistive tech by default: the word beside it is the meaning. */
  label?: string;
  className?: string;
}> = ({ tone, label, className = "" }) => (
  <span
    className={`zv-hole ${className}`.trim()}
    data-tone={tone}
    aria-hidden={label ? undefined : true}
    role={label ? "img" : undefined}
    aria-label={label}
  />
);

/** A state and its word together. The word is never optional. */
export const StateMark: React.FC<{ tone: Tone; children: React.ReactNode }> = ({
  tone,
  children,
}) => (
  <span className="zv-state-mark" data-tone={tone}>
    <Hole tone={tone} />
    {children}
  </span>
);

/* --------------------------------------------------------------------------
   The machine key pattern

   The eight digits of this build's seed key, punched four rows deep in the dead
   zone every card carries to say which keying station made it. It is a
   reproduction of the machine that produced this build, not decoration: it is
   printed at full contrast nowhere and read by nobody, and that is the correct
   prominence for a device plate.
   -------------------------------------------------------------------------- */

const SEED_KEY = "1328a8f9";

export const KeyPattern: React.FC<{ variant?: "card" | "chrome" }> = ({
  variant = "card",
}) => (
  <span
    className={`zv-key-pattern zv-key-pattern--${variant}`}
    role="img"
    aria-label={`Keying station pattern ${SEED_KEY}`}
    title={`Keying station ${SEED_KEY}`}
  >
    {SEED_KEY.split("")
      .map((digit, column) => ({ digit, column }))
      // MSB first, so the top row of every column is the 8s place. Keyed on the
      // column and not the digit: the seed repeats digits, and a key built from
      // the value collides.
      .flatMap(({ digit, column }) =>
        [8, 4, 2, 1].map((place) => (
          <i
            key={`${column}-${place}`}
            data-on={Number.parseInt(digit, 16) & place ? "1" : "0"}
          />
        )),
      )}
  </span>
);

/* --------------------------------------------------------------------------
   The binary column — this world's one signature move

   A count is a bit pattern before it is a number, and a bit pattern is what this
   product hashes and signs. So a tally is printed as the pattern: MSB at the top,
   the powers of two down the margin, the decimal figure set beside it.

   It is `aria-hidden` on purpose. The column carries no information the decimal
   figure beside it does not already say out loud, so announcing both would make
   a screen reader repeat itself. The pattern is the argument the page makes to
   the eye, not a second channel for the choice.
   -------------------------------------------------------------------------- */

export const BinaryColumn: React.FC<{
  value: number;
  /** Printed under the column. Omit where there is no room for it. */
  caption?: string;
}> = ({ value, caption }) => {
  const safe = Math.max(0, Math.trunc(value));
  // Four places minimum, so a count of 1 or 2 still reads as a column rather
  // than as a pair of stray marks.
  const width = Math.max(4, Math.ceil(Math.log2(safe + 1)));

  return (
    <div className="zv-bits" aria-hidden="true" title={`${safe} = ${safe.toString(2)}`}>
      {Array.from({ length: width }, (_, i) => {
        const place = width - 1 - i;
        const on = (safe >> place) & 1;
        return (
          <span className="zv-bit" data-on={on} key={place}>
            <span className="zv-bit-weight">{2 ** place}</span>
            <Hole tone={on ? "live" : "muted"} />
          </span>
        );
      })}
      {caption && <p className="zv-bits-caption">{caption}</p>}
    </div>
  );
};

/* --------------------------------------------------------------------------
   The SEAL stamp

   A card stops accepting punches at one moment, and this is the mark for it: a
   stamp ruled twice and put down slightly crooked, in the exception ink. It is
   drawn so it can carry the word SEAL at the weight and tracking a real stamp
   has, and so it can be pressed rather than faded.
   -------------------------------------------------------------------------- */

export const SealStamp: React.FC<{
  /** What the stamp says. SEAl by default; a card is sealed, not "invalid". */
  text?: string;
  /** A line under the word, the way a dated stamp carries one. */
  sub?: string;
  width?: number;
  className?: string;
}> = ({ text = "SEAL", sub, width = 148, className = "" }) => {
  const height = sub ? 62 : 52;
  return (
    <svg
      className={`zv-seal ${className}`.trim()}
      viewBox={`0 0 164 ${height}`}
      fill="none"
      aria-hidden="true"
      focusable="false"
      style={{ width }}
    >
      {/* One rotation for the whole stamp: rotating each ring separately would
          drift them apart, because they do not share a centre. */}
      <g transform="rotate(-7 82 26)" stroke="currentColor" fill="none">
        <rect
          x="3"
          y="3"
          width="158"
          height="46"
          strokeWidth="2.5"
          rx="1"
        />
        <rect x="8" y="8" width="148" height="36" strokeWidth="1" rx="1" />
        <text
          x="82"
          y="26"
          textAnchor="middle"
          dominantBaseline="central"
          className="zv-seal-word"
          fill="currentColor"
          stroke="none"
        >
          {text}
        </text>
        {sub && (
          <text
            x="82"
            y="55"
            textAnchor="middle"
            className="zv-seal-word"
            fill="currentColor"
            stroke="none"
            style={{ fontSize: 8, letterSpacing: "0.22em" }}
          >
            {sub}
          </text>
        )}
      </g>
    </svg>
  );
};
