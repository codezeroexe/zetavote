import React, { useSyncExternalStore } from "react";
import { isOnline, subscribeOnline } from "../../services/online";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "outline" | "danger" | "ghost";
  size?: "sm" | "md" | "lg";
  isLoading?: boolean;
  icon?: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = "primary",
  size = "md",
  isLoading = false,
  icon,
  className = "",
  disabled,
  type,
  ...props
}) => {
  const online = useSyncExternalStore(subscribeOnline, isOnline, isOnline);
  // A submit button whose request cannot leave the machine should not be
  // pressable. Done here rather than in each of the nine forms.
  const blocked = type === "submit" && !online;

  return (
    <button
      className={`zv-btn zv-btn-${variant} zv-btn-${size} ${className}`}
      disabled={disabled || isLoading || blocked}
      aria-busy={isLoading || undefined}
      type={type}
      {...props}
    >
      {/* The label stays put and the spinner sits beside it. Swapping the label
          out for a spinner left a button reading "Loading" with no way to tell
          which of four actions was running, and changed the button's width
          mid-click, which moved everything next to it. */}
      {isLoading && <span className="zv-spinner" aria-hidden="true" />}
      {!isLoading && icon && <span className="zv-btn-icon">{icon}</span>}
      <span>{children}</span>
    </button>
  );
};
