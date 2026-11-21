import { useEffect, useRef, useState } from "react";
import { useLegacyVoxelScene } from "./LegacyVoxelScene.jsx";
import { setupIdentity } from "./identity.js";
import { SparkPetMark } from "./SparkPetMark.jsx";
import { useReveal } from "./useReveal.js";

export function AppShell({ children, routeKey }) {
  const rootRef = useRef(null);
  useReveal(rootRef, routeKey);
  useLegacyVoxelScene(routeKey);
  const insideApp =
    routeKey === "#missions" ||
    routeKey === "#new-mission" ||
    routeKey?.startsWith("#mission/");
  const [theme, setTheme] = useState(() => {
    const fallback = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    try {
      const saved = localStorage.getItem("spark-theme");
      return saved === "dark" || saved === "light" ? saved : fallback;
    } catch {
      return fallback;
    }
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem("spark-theme", theme); } catch { /* Private storage may be unavailable. */ }
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", theme === "dark" ? "#0e121d" : "#fbf6e8");
    window.dispatchEvent(new Event("spark-themechange"));
  }, [theme]);
  useEffect(() => setupIdentity(), []);
  return (
    <section
      ref={rootRef}
      className={`world${insideApp ? " discovery-open" : ""}`}
      aria-label="Spark homepage"
    >
      <header className="top">
        <a className="brand" href="/" aria-label="Spark home">
          <SparkPetMark />
          spark
        </a>
        <nav aria-label="Main navigation">
          <a href="/missions">Missions</a>
          <a href="/#how-it-works">How it works</a>
          <a href="/connect-agents">Connect agents</a>
        </nav>
        <button className="sign" type="button">
          Sign in
        </button>
        <button
          className="theme-toggle"
          id="theme-toggle"
          type="button"
          aria-label={
            theme === "dark" ? "Switch to light mode" : "Switch to dark mode"
          }
          title={theme === "dark" ? "Light mode" : "Dark mode"}
          onClick={() =>
            setTheme((value) => (value === "dark" ? "light" : "dark"))
          }
        >
          <svg className="theme-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" shapeRendering="crispEdges">
            <g className="theme-sun" fill="currentColor">
              <path d="M9 7h6v2h2v6h-2v2H9v-2H7V9h2zM11 1h2v4h-2zM11 19h2v4h-2zM1 11h4v2H1zM19 11h4v2h-4zM4 4h3v3H4zM17 4h3v3h-3zM4 17h3v3H4zM17 17h3v3h-3z" />
            </g>
            <path className="theme-moon" fill="currentColor" d="M10 2h4v2h-4v4h2v4h4v2h6v4h-2v2h-4v2H8v-2H4v-4H2V8h2V4h6z" />
          </svg>
        </button>
        <a className="top-cta" href="/new-mission">
          + Start a mission
        </a>
      </header>
      <main>{children}</main>
    </section>
  );
}
