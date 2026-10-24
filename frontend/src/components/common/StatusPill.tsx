import React from "react";

export type PillTone = "open" | "done" | "closed" | "danger";

/**
 * Status as a word plus a shape, so it reads without colour:
 * dot = open, check = done, square = closed, triangle = danger.
 */
export const StatusPill: React.FC<{ tone: PillTone; children: React.ReactNode }> = ({
  tone,
  children,
}) => (
  <span className={`zv-pill zv-pill-${tone}`}>
    <span className="zv-pill-shape" aria-hidden="true" />
    {children}
  </span>
);
