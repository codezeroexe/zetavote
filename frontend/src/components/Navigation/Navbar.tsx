import React from "react";
import { BackendStatus } from "../Status/BackendStatus";
import type { Theme } from "../../hooks/useTheme";

export type NavSection = "home" | "admin" | "voter" | "verify";

interface NavbarProps {
  activeSection: NavSection;
  onNavigate: (section: NavSection) => void;
  theme: Theme;
  onToggleTheme: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({ activeSection, onNavigate, theme, onToggleTheme }) => {
  const isDark = theme === "dark";
  return (
    <header className="zv-navbar">
      <div className="zv-navbar-container">
        {/* Brand Logo & Title */}
        <button
          type="button"
          className="zv-brand"
          onClick={() => onNavigate("home")}
          aria-label="ZetaVote Home"
        >
          <div className="zv-brand-icon zv-brand-icon--img" aria-hidden="true">
            <img src="/icons/zv-mark.png" alt="" width="36" height="36" />
          </div>
          <div className="zv-brand-text">
            <span className="zv-brand-name">ZetaVote</span>
            <span className="zv-brand-tag">LOCAL SECURE VOTING</span>
          </div>
        </button>

        {/* Primary Navigation Tabs */}
        <nav className="zv-nav-tabs" aria-label="Main Navigation">
          <button
            type="button"
            className={`zv-nav-link ${activeSection === "admin" ? "active" : ""}`}
            onClick={() => onNavigate("admin")}
            aria-current={activeSection === "admin" ? "page" : undefined}
          >
            ADMIN
          </button>
          <button
            type="button"
            className={`zv-nav-link ${activeSection === "voter" ? "active" : ""}`}
            onClick={() => onNavigate("voter")}
            aria-current={activeSection === "voter" ? "page" : undefined}
          >
            VOTER
          </button>
          <button
            type="button"
            className={`zv-nav-link ${activeSection === "verify" ? "active" : ""}`}
            onClick={() => onNavigate("verify")}
            aria-current={activeSection === "verify" ? "page" : undefined}
          >
            VERIFY
          </button>
        </nav>

        {/* Status Indicator + Theme Toggle */}
        <div className="zv-navbar-actions">
          <button
            type="button"
            className="zv-theme-toggle"
            onClick={onToggleTheme}
            aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
            title={isDark ? "Switch to light theme" : "Switch to dark theme"}
          >
            {isDark ? (
              <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path fillRule="evenodd" d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" clipRule="evenodd" />
              </svg>
            ) : (
              <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
              </svg>
            )}
          </button>
          <div className="zv-navbar-status">
            <BackendStatus />
          </div>
        </div>
      </div>
    </header>
  );
};
