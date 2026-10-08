import React from "react";
import { ZvMark } from "../Brand/ZvMark";
import { useSession } from "../../auth/SessionContext";
import type { Section } from "../../hooks/useHashSection";
import type { Theme } from "../../hooks/useTheme";
import type { Role } from "../../auth/SessionContext";

interface NavbarProps {
  activeSection: Section;
  onNavigate: (section: Section) => void;
  theme: Theme;
  onToggleTheme: () => void;
  /** Null until the session resolves, and null when signed out. */
  role: Role | null;
  /** Which way in is chosen. Signed out only — App owns it and passes it here. */
  entryRole: "voter" | "admin";
  onEntryRoleChange: (role: "voter" | "admin") => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeSection,
  onNavigate,
  theme,
  onToggleTheme,
  role,
  entryRole,
  onEntryRoleChange,
}) => {
  const { subject, signOut } = useSession();
  const isDark = theme === "dark";

  // Tabs are a signed-in affordance. Signed out, the sign-in form is the whole
  // navigation — a row of tabs leading nowhere but the form you are already
  // looking at is worse than no tabs.
  //
  // The verify endpoint takes no session, so this is stricter than the API. That
  // is deliberate: the tab is a way in, and keeping it off the signed-out navbar
  // keeps the front door to one decision — sign in, or don't.
  const tabs: { section: Section; label: string }[] = [];
  if (role !== null) {
    tabs.push({
      section: role === "admin" ? "admin" : "voter",
      label: role === "admin" ? "Elections" : "My ballots",
    });
    tabs.push({ section: "verify", label: "Verify" });
  }

  // Home is the session's own front door. Clicking the logo used to navigate to
  // the sign-in form, which dropped a signed-in admin onto a page for an account
  // they already had.
  const home: Section = role === null ? "login" : role === "admin" ? "admin" : "voter";

  return (
    <header className="zv-navbar">
      <div className="zv-navbar-container">
        {/* Brand Logo & Title */}
        <button
          type="button"
          className="zv-brand"
          onClick={() => onNavigate(home)}
          aria-label="ZetaVote home"
        >
          <div className="zv-brand-icon" aria-hidden="true">
            <ZvMark className="zv-brand-mark" />
          </div>
          {(
            <div className="zv-brand-text">
              <span className="zv-brand-name">ZetaVote</span>
              <span className="zv-brand-tag">LOCAL SECURE VOTING</span>
            </div>
          )}
        </button>

        {/* Signed out, the choice of role lives in the chrome rather than on the
            page, so it survives a scroll. Signed in, the toggle is gone and the
            tabs below take its place. The sign-in/register choice is nearer its
            fields, on the page. */}
        {role === null && (
          <div
            className="zv-segment zv-navbar-entry"
            role="group"
            aria-label="Account type"
          >
            {(
              [
                ["voter", "Voter"],
                ["admin", "Admin"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={entryRole === value}
                className="zv-segment-option"
                onClick={() => onEntryRoleChange(value)}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {/* Not rendered at all when there are no tabs. Signed out that is every
            time, and an empty <nav> is two problems: it leaves an empty
            navigation landmark behind, and the container still carries a border
            and background, so it drew itself as an 8px dot in the middle of the
            navbar. */}
        {tabs.length > 0 && (
          <nav className="zv-nav-tabs" aria-label="Main">
            {tabs.map((tab) => (
              <button
                key={tab.section}
                type="button"
                className={`zv-nav-link ${activeSection === tab.section ? "active" : ""}`}
                onClick={() => onNavigate(tab.section)}
                aria-current={activeSection === tab.section ? "page" : undefined}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        )}

        {/* Status Indicator + Theme Toggle */}
        <div className="zv-navbar-actions">
          {role !== null && (
            <div className="zv-account">
              <span className="zv-account-name zv-mono" title={subject ?? undefined}>
                {subject}
              </span>
              <button
                type="button"
                className="zv-signout-btn"
                onClick={() => {
                  onNavigate("login");
                  void signOut();
                }}
              >
                Sign out
              </button>
            </div>
          )}
          <button
            type="button"
            className="zv-theme-toggle"
            onClick={onToggleTheme}
            aria-label={
              isDark ? "Switch to light theme" : "Switch to dark theme"
            }
            title={isDark ? "Switch to light theme" : "Switch to dark theme"}
          >
            {isDark ? (
              <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path
                  fillRule="evenodd"
                  d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707a1 1 0 001.414-1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z"
                  clipRule="evenodd"
                />
              </svg>
            ) : (
              <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </header>
  );
};
