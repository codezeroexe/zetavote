import React from "react";

interface SkeletonProps {
  /** `list` is a stack of rows; `page` is taller, for whole-screen loads. */
  variant?: "list" | "page";
  rows?: number;
  /** Read by screen readers in place of the shapes, which are hidden. */
  label: string;
}

/**
 * Placeholder shapes shown while data loads, in the layout the loaded content
 * will take, so nothing jumps when it arrives. Announced once as a status.
 */
export const Skeleton: React.FC<SkeletonProps> = ({
  variant = "list",
  rows = 3,
  label,
}) => (
  <div
    className={`zv-skel-set zv-skel-set--${variant}`}
    role="status"
    aria-live="polite"
  >
    <span className="zv-skel-label">{label}</span>
    {Array.from({ length: rows }, (_, i) => (
      <div
        key={i}
        className="zv-skel-row"
        style={{ animationDelay: `${i * 90}ms` }}
        aria-hidden="true"
      >
        <span className="zv-skel zv-skel--title" />
        <span className="zv-skel zv-skel--line" />
      </div>
    ))}
  </div>
);
