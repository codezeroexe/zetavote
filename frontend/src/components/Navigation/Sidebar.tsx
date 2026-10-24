import React from "react";
import { ZvMark } from "../Brand/ZvMark";
import { useSession } from "../../auth/SessionContext";
import type { Section } from "../../hooks/useHashSection";
import type { Theme } from "../../hooks/useTheme";
import type { Role } from "../../auth/SessionContext";

interface SidebarProps {
  activeSection: Section;
  onNavigate: (section: Section) => void;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  /** Null until the session resolves, and null when signed out. */
  role: Role | null;
  /** Which way in is chosen. Signed out only — App owns it and passes it here. */
  entryRole: "voter" | "admin";
  onEntryRoleChange: (role: "voter" | "admin") => void;
}

const THEMES: { value: Theme; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

/**
 * The one navigation surface: brand at the top, sections in the middle, account,
 * sign out and the theme control at the bottom. Fixed height, so the page scrolls
 * beside it and never under it.
 */
export const Sidebar: React.FC<SidebarProps> = ({
  activeSection,
  onNavigate,
  theme,
  onThemeChange,
  role,
  entryRole,
  onEntryRoleChange,
}) => {
  const { subject, signOut } = useSession();

  // Sections are a signed-in affordance. Signed out, the sign-in form is the whole
  // navigation. The verify endpoint takes no session, but the UI keeps one front
  // door: sign in, or don't.
  const tabs: { section: Section; label: string }[] = [];
  if (role !== null) {
    tabs.push({
      section: role === "admin" ? "admin" : "voter",
      label: role === "admin" ? "Elections" : "My ballots",
    });
    tabs.push({ section: "verify", label: "Verify" });
  }

  // Home is the session's own front door, not the sign-in form.
  const home: Section = role === null ? "login" : role === "admin" ? "admin" : "voter";

  return (
    <aside className="zv-sidebar zv-glass">
      <button
        type="button"
        className="zv-brand"
        onClick={() => onNavigate(home)}
        aria-label="ZetaVote home"
      >
        <div className="zv-brand-icon" aria-hidden="true">
          <ZvMark className="zv-brand-mark" />
        </div>
        <span className="zv-brand-name">ZetaVote</span>
      </button>

      <div className="zv-sidebar-mid">
        {role === null && (
          <div className="zv-segment zv-sidebar-entry" role="group" aria-label="Account type">
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

        {/* Not rendered when there are no sections: an empty nav is an empty landmark. */}
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
      </div>

      <div className="zv-sidebar-foot">
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
        <div className="zv-segment zv-theme-control" role="group" aria-label="Theme">
          {THEMES.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              aria-pressed={theme === value}
              className="zv-segment-option"
              onClick={() => onThemeChange(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
};
