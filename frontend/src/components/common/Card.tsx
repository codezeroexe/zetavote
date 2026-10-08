import React from "react";

interface CardProps {
  children: React.ReactNode;
  className?: string;
}

export const Card: React.FC<CardProps> = ({ children, className = "" }) => {
  return (
    <div className={`zv-card ${className}`}>
      <div className="zv-card-body">{children}</div>
    </div>
  );
};
