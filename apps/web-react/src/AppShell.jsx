import { useEffect, useState } from "react";
import { useLegacyVoxelScene } from "./LegacyVoxelScene.jsx";
import { setupIdentity } from "./identity.js";

export function AppShell({ children, routeKey }) {
  useLegacyVoxelScene(routeKey);
  const insideApp =
    routeKey === "#missions" ||
    routeKey === "#new-mission" ||
    routeKey?.startsWith("#mission/");
  const [theme, setTheme] = useState(
    () =>
      localStorage.getItem("spark-theme") ||
      (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"),
  );
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("spark-theme", theme);
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", theme === "dark" ? "#0e121d" : "#fbf6e8");
    window.dispatchEvent(new Event("spark-themechange"));
  }, [theme]);
  useEffect(() => setupIdentity(), []);
  return (
    <section
      className={`world${insideApp ? " discovery-open" : ""}`}
      aria-label="Spark homepage"
    >
      <header className="top">
        <a className="brand" href="/" aria-label="Spark home">
          <svg className="spark-mark" viewBox="0 0 32 32" aria-hidden="true">
            <g className="bot-float">
              <rect
                className="bot-shadow"
                x="8"
                y="28"
                width="16"
                height="2"
                rx="1"
              />
              <rect className="bot-leg" x="10" y="23" width="4" height="6" />
              <rect
                className="bot-leg bot-leg-alt"
                x="18"
                y="23"
                width="4"
                height="6"
              />
              <rect
                className="bot-body"
                x="8"
                y="16"
                width="16"
                height="9"
                rx="2"
              />
              <rect
                className="bot-panel"
                x="11"
                y="19"
                width="10"
                height="4"
                rx="1"
              />
              <rect
                className="bot-arm"
                x="5"
                y="18"
                width="3"
                height="6"
                rx="1"
              />
              <rect
                className="bot-arm bot-arm-right"
                x="24"
                y="18"
                width="3"
                height="6"
                rx="1"
              />
              <rect
                className="bot-block"
                x="27"
                y="20"
                width="4"
                height="4"
                rx=".5"
              />
              <rect
                className="bot-head"
                x="7"
                y="7"
                width="18"
                height="11"
                rx="2"
              />
              <rect className="bot-ear" x="5" y="10" width="3" height="5" />
              <rect
                className="bot-ear bot-ear-right"
                x="24"
                y="10"
                width="3"
                height="5"
              />
              <rect
                className="bot-visor"
                x="10"
                y="10"
                width="12"
                height="5"
                rx="1"
              />
              <rect className="bot-eye" x="12" y="12" width="2" height="2" />
              <rect
                className="bot-eye bot-eye-right"
                x="18"
                y="12"
                width="2"
                height="2"
              />
              <rect className="bot-antenna" x="15" y="3" width="2" height="4" />
              <rect
                className="bot-signal"
                x="14"
                y="1"
                width="4"
                height="2"
                rx="1"
              />
            </g>
          </svg>
          spark
        </a>
        <nav aria-label="Main navigation">
          <a href="#missions">Missions</a>
          <a href="#how-it-works">How it works</a>
          <a href="#first-mission">About</a>
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
          {theme === "dark" ? "☀" : "☾"}
        </button>
        <a className="top-cta" href="#new-mission">
          + Start a mission
        </a>
      </header>
      <main>{children}</main>
    </section>
  );
}
