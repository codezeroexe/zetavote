import React, { type ReactNode } from "react";

/**
 * Sticky glass bar at the top of a page: title (and optional crumb) on the left,
 * actions (search fields, buttons) on the right. Fields inside render thinner.
 * The edge band blurs content as it scrolls beneath.
 */
export const PageToolbar: React.FC<{
  title: ReactNode;
  crumb?: ReactNode;
  children?: ReactNode;
}> = ({ title, crumb, children }) => (
  <div className="zv-toolbar-wrap">
    <div className="zv-edge-band" aria-hidden="true" />
    <div className="zv-toolbar zv-glass">
      <div className="zv-toolbar-title">
        {crumb && <span className="zv-toolbar-crumb">{crumb}</span>}
        <h1>{title}</h1>
      </div>
      {children}
    </div>
  </div>
);
