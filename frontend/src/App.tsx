import { useState } from "react";
import "./App.css";
import { Footer } from "./components/Layout/Footer";
import { Navbar, type NavSection } from "./components/Navigation/Navbar";
import { useTheme } from "./hooks/useTheme";
import { AdminPage } from "./pages/Admin/AdminPage";
import { LandingPage } from "./pages/Landing/LandingPage";
import { VerifyPage } from "./pages/Verify/VerifyPage";
import { VoterPage } from "./pages/Voter/VoterPage";

export function App() {
  const [activeSection, setActiveSection] = useState<NavSection>("home");
  const { theme, toggleTheme } = useTheme();

  const renderSection = () => {
    switch (activeSection) {
      case "admin":
        return <AdminPage />;
      case "voter":
        return <VoterPage />;
      case "verify":
        return <VerifyPage />;
      case "home":
      default:
        return <LandingPage onNavigate={setActiveSection} />;
    }
  };

  return (
    <div className="zv-app-root" data-theme={theme}>
      <Navbar activeSection={activeSection} onNavigate={setActiveSection} theme={theme} onToggleTheme={toggleTheme} />
      <main className="zv-main-content">{renderSection()}</main>
      <Footer />
    </div>
  );
}

export default App;
