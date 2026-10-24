import React from "react";

interface StubProps {
  children: React.ReactNode;
  /** Mono label on the tear line, top right, e.g. "LIB-0039 · 21 OCT". */
  id?: string;
  className?: string;
}

/**
 * The ballot stub: a card with a perforated tear line and side notches. Only for
 * surfaces that are the voter's receipt. Slides in once on mount (CSS, disabled
 * under reduced motion). The same look is available as the `zv-stub` class.
 */
export const Stub: React.FC<StubProps> = ({ children, id, className = "" }) => (
  <div className={`zv-card zv-stub ${className}`}>
    {id && <span className="zv-stub-id">{id}</span>}
    <div className="zv-card-body">{children}</div>
  </div>
);
