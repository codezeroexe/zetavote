import React from "react";

interface CardProps {
  children: React.ReactNode;
  className?: string;
  title?: string;
  subtitle?: string;
}

export const Card: React.FC<CardProps> = ({
  children,
  className = "",
  title,
  subtitle,
}) => {
  return (
    <div className={`zv-card ${className}`}>
      {(title || subtitle) && (
        <div className="zv-card-header">
          <div>
            {title && <h3 className="zv-card-title">{title}</h3>}
            {subtitle && <p className="zv-card-subtitle">{subtitle}</p>}
          </div>
        </div>
      )}
      <div className="zv-card-body">{children}</div>
    </div>
  );
};
