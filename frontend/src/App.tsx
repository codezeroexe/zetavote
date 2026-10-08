import { useEffect, useRef } from "react";
import "./App.css";
import { SessionProvider, useSession } from "./auth/SessionContext";
import { Navbar } from "./components/Navigation/Navbar";
import { Footer } from "./components/Layout/Footer";
import { OfflineBanner } from "./components/Status/BackendStatus";
import { ErrorBoundary } from "./components/common/ErrorBoundary";
import { Skeleton } from "./components/common/Skeleton";

import { LoginPage } from "./pages/Login/LoginPage";
import { AdminPage } from "./pages/Admin/AdminPage";
import { VoterDashboard } from "./pages/Voter/VoterDashboard";
import { VerifyPage } from "./pages/Verify/VerifyPage";
import { useTheme } from "./hooks/useTheme";
import { useHashSection, type Section } from "./hooks/useHashSection";

/** Where a session lands when the URL says nothing, and where Sign Out goes. */
function homeFor(role: "admin" | "voter" | null): Section {
  if (role === "admin") return "admin";
  if (role === "voter") return "voter";
  return "login";
}

function Shell() {
  const { role, checking } = useSession();
  const { theme, toggleTheme } = useTheme();
  const [requested, navigate] = useHashSection();
  const main = useRef<HTMLElement>(null);

  const section = requested ?? homeFor(role);

  // A section the session cannot serve is not a dead end: the voter and admin
  // halves both resolve to the sign-in form, which is what the role toggle picks.
  const signInAs: "voter" | "admin" =
    section === "admin" ? "admin" : "voter";

  // Focus follows navigation, and nothing else. Without it, switching section or
  // tab drops focus back to <body> and the next thing read aloud is the navbar,
  // some distance above whatever the user just asked for.
  //
  // Two things it must not do. On first paint — focusing <main> at mount would
  // swallow the first Tab and skip the skip link and the navbar entirely. And it
  // must not key on `checking`, because that flips from true to false as the
  // session resolves, which is not a navigation and would fire the same way.
  const settled = useRef(false);
  useEffect(() => {
    if (!settled.current) {
      settled.current = true;
      return;
    }
    // The scroll goes first. Focus alone lands the top of <main> wherever the
    // viewport happened to be, so switching away from a 40-row audit table and
    // back used to drop the elections list halfway down its own page.
    window.scrollTo({ top: 0 });
    main.current?.focus();
  }, [section]);

  // Signing in has to land on the page for the role that now exists.
  //
  // It did not, and the failure was on the one path a first-time voter takes:
  // open the app, register, submit — and stay on the sign-in form, signed in,
  // with the navbar quietly gaining its tabs and nothing else changing. It only
  // ever looked right in testing because the role toggle had already rewritten
  // the hash before the form was submitted.
  //
  // Gated on the current section so a reload of #/verify keeps you on Verify
  // rather than bouncing you to your ballots.
  const wasSignedOut = useRef(true);
  useEffect(() => {
    if (role === null) {
      wasSignedOut.current = true;
      return;
    }
    if (!wasSignedOut.current) return;
    wasSignedOut.current = false;
    if (section === "login") navigate(homeFor(role));
  }, [role, section, navigate]);

  // The document title is the one thing a person sees when this app is in a
  // background tab next to a terminal running the server.
  const title =
    section === "admin"
      ? "Elections — ZetaVote"
      : section === "voter"
        ? "Your ballots — ZetaVote"
        : section === "verify"
          ? "Verify a ballot — ZetaVote"
          : "ZetaVote — local secure voting";
  useEffect(() => {
    document.title = title;
  }, [title]);

  const content = (() => {
    // Every section needs a session, including verify. The endpoint itself is
    // public, but the UI is stricter on purpose — one way in, and no screen
    // reachable by typing a URL that the navbar does not offer.
    if (section === "verify" && role !== null) return <VerifyPage />;
    if (section === "admin" && role === "admin") return <AdminPage />;
    if (section === "voter" && role === "voter") return <VoterDashboard />;
    return <LoginPage role={signInAs} />;
  })();

  return (
    <div className="zv-app-root">
      <a className="zv-skip-link" href="#zv-main">
        Skip to main content
      </a>
      <Navbar
        activeSection={section}
        onNavigate={navigate}
        theme={theme}
        onToggleTheme={toggleTheme}
        role={role}
        entryRole={signInAs}
        onEntryRoleChange={(next) => navigate(next === "admin" ? "admin" : "voter")}
      />
      <OfflineBanner />
      <main className="zv-main-content" id="zv-main" tabIndex={-1} ref={main}>
        {checking ? (
          <Skeleton variant="page" label="Checking session" rows={2} />
        ) : (
          content
        )}
      </main>
      <Footer />
    </div>
  );
}

export function App() {
  return (
    <SessionProvider>
      <ErrorBoundary>
        <Shell />
      </ErrorBoundary>
    </SessionProvider>
  );
}

export default App;
