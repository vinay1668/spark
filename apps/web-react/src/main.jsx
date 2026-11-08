import React from "react";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Board } from "./Board.jsx";
import { MissionDetail } from "./MissionDetail.jsx";
import { Home } from "./Home.jsx";
import { Discovery } from "./Discovery.jsx";
import { NewMission } from "./NewMission.jsx";
import { AppShell } from "./AppShell.jsx";
import "./styles.css";

function RouterApp() {
  const [location, setLocation] = useState({
    search: window.location.search,
    hash: window.location.hash,
  });
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
  const missionId = location.hash.startsWith("#mission/")
    ? decodeURIComponent(location.hash.slice("#mission/".length))
    : null;
  const page = missionId ? (
    <MissionDetail missionId={missionId} />
  ) : location.hash === "#new-mission" ? (
    <NewMission />
  ) : location.hash === "#missions" ? (
    <Discovery />
  ) : (
    <Home />
  );
  return <AppShell routeKey={location.hash}>{page}</AppShell>;
}

createRoot(document.getElementById("root")).render(<RouterApp />);
