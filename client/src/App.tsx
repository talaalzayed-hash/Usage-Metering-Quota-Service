import { useEffect, useState } from "react";
import { UserView } from "./UserView.tsx";
import { AdminView } from "./AdminView.tsx";

type View = "user" | "admin";

const viewFromHash = (): View => (window.location.hash === "#/admin" ? "admin" : "user");

// Two views of the same Docs Co app: an end user processing documents, and
// the company admin managing plans. The hash keeps each view linkable, so
// both can be open side by side in two tabs.
export function App() {
  const [view, setView] = useState<View>(viewFromHash);

  useEffect(() => {
    const onHashChange = () => setView(viewFromHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  return (
    <div className="page">
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden>
            ▤
          </span>
          Docs Co
        </div>
        <nav className="tabs">
          <a href="#/" className={view === "user" ? "active" : ""}>
            User view
          </a>
          <a href="#/admin" className={view === "admin" ? "active" : ""}>
            Account admin
          </a>
        </nav>
      </header>

      {view === "user" ? <UserView /> : <AdminView />}
    </div>
  );
}
