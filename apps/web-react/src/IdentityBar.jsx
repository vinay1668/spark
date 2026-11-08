import { useEffect, useState } from "react";

export function IdentityBar() {
  const [user, setUser] = useState(null);
  const [theme, setTheme] = useState(
    () => localStorage.getItem("spark-theme") || "light",
  );
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("spark-theme", theme);
  }, [theme]);
  useEffect(() => {
    const clerk = window.Clerk;
    if (!clerk) return;
    clerk.load?.().then(() => {
      setUser(clerk.user);
      clerk.addListener?.(({ user: nextUser }) => setUser(nextUser));
    });
  }, []);
  return (
    <div className="react-identity-bar">
      <button className="sign" onClick={() => window.Clerk?.openSignIn?.()}>
        {user ? user.username || user.fullName || "Account" : "Sign in"}
      </button>
      <button
        className="theme-toggle"
        onClick={() =>
          setTheme((value) => (value === "dark" ? "light" : "dark"))
        }
        aria-label="Switch theme"
      >
        {theme === "dark" ? "☀" : "☾"}
      </button>
    </div>
  );
}
