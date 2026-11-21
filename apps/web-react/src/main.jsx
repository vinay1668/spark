import React from "react";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { MissionDetail } from "./MissionDetail.jsx";
import { Home } from "./Home.jsx";
import { Discovery } from "./Discovery.jsx";
import { NewMission } from "./NewMission.jsx";
import { AppShell } from "./AppShell.jsx";
import { AgentConnect } from "./AgentConnect.jsx";
import "./styles.css";
import "./motion.css";

function RouterApp() {
  const [location, setLocation] = useState({
    search: window.location.search,
    hash: window.location.hash,
  });
  const pathRoute = window.location.pathname.startsWith("/missions/") ? `#mission/${window.location.pathname.slice("/missions/".length)}`
    : window.location.pathname === "/missions" ? "#missions" : window.location.pathname === "/new-mission" ? "#new-mission" : "";
  const route = location.hash.startsWith("#mission/") || ["#missions", "#new-mission"].includes(location.hash) ? location.hash : pathRoute;
  useEffect(() => {
    const update = () =>
      setLocation({
        search: window.location.search,
        hash: window.location.hash,
      });
    window.addEventListener("hashchange", update);
    window.addEventListener("popstate", update);
    return () => {
      window.removeEventListener("hashchange", update);
      window.removeEventListener("popstate", update);
    };
  }, []);
  const missionId = route.startsWith("#mission/")
    ? decodeURIComponent(route.slice("#mission/".length))
    : null;
  const page = missionId ? (
    <MissionDetail key={missionId} missionId={missionId} />
  ) : route === "#new-mission" ? (
    <NewMission />
  ) : route === "#missions" ? (
    <Discovery />
  ) : (
    <Home />
  );
  return <AppShell routeKey={route || location.hash}>{window.location.pathname === "/connect-agents" && !route ? <AgentConnect /> : page}</AppShell>;
}

createRoot(document.getElementById("root")).render(<RouterApp />);
