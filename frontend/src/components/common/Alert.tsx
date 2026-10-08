import React from "react";
import { Hole, type Tone } from "./Hole";

interface AlertProps {
  type?: "info" | "success" | "warning" | "error";
  title?: string;
  message: string;
  className?: string;
  /**
   * Nothing is announced until focus or a read reaches it. A success banner that
   * interrupts whatever the user was doing is worse than one they have to go and
   * look for, and this app fires one on page load for every verification.
   */
  live?: boolean;
}

export const Alert: React.FC<AlertProps> = ({
  type = "info",
  title,
  message,
  className = "",
  live = true,
}) => {
  /* One mark, not two. This world states a verdict with a punched slot and a
     word, and a card has never needed an icon as well — so the alert's icon is
     the hole. The shape is what distinguishes the four alerts with no colour at
     all, and it is the half a screen reader gets for free. */
  const tone: Record<NonNullable<AlertProps["type"]>, Tone> = {
    info: "pending",
    success: "live",
    warning: "warn",
    error: "risk",
  };

  // An alert interrupts. Information and success do not need to: they report on
  // something the user just did, or on a state they can read when they look.
  const role = type === "error" || type === "warning" ? "alert" : "status";
  const announce = live ? role : undefined;

  return (
    <div
      className={`zv-alert zv-alert-${type} ${className}`}
      {...(announce ? { role: announce } : {})}
    >
      <span className="zv-alert-mark">
        <Hole tone={tone[type]} />
      </span>
      <div className="zv-alert-content">
        {title && <h4 className="zv-alert-title">{title}</h4>}
        <p className="zv-alert-message">{message}</p>
      </div>
    </div>
  );
};
