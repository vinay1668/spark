import { useEffect, useState } from "react";
import { Board, post } from "./Board.jsx";
import { DecisionEmpty, DecisionPanel } from "./DecisionPanel.jsx";
import { getActiveIdentity, isAuthenticated } from "./identity.js";

const displayStatus = (value) =>
  value
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
const missionStage = (status) => {
  if (status === "COMPLETED") return 4;
  if (["ACTIVE", "VERIFYING"].includes(status)) return 3;
  if (["PLANNING", "AWAITING_APPROVAL"].includes(status)) return 2;
  return 1;
};

export function MissionDetail({ missionId }) {
  const [view, setView] = useState(null);
  const [error, setError] = useState("");
  const [claiming, setClaiming] = useState("");
  const [renewing, setRenewing] = useState("");
  const [identity, setIdentity] = useState(null);
  useEffect(() => {
    let active = true;
    getActiveIdentity().then((next) => active && setIdentity(next));
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    Promise.all([
      fetch(`/api/v1/missions/${encodeURIComponent(missionId)}`).then(
        (response) => {
          if (!response.ok) throw new Error("Mission not found.");
          return response.json();
        },
      ),
      fetch(
        `/api/v1/missions/${encodeURIComponent(missionId)}/decision-gates`,
      ).then((response) => (response.ok ? response.json() : [])),
      fetch(`/api/v1/missions/${encodeURIComponent(missionId)}/board/query`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          types: [],
          tags: [],
          unresolvedOnly: false,
          limit: 50,
        }),
      }).then((response) => (response.ok ? response.json() : null)),
    ])
      .then(([nextView, decisionGates, board]) => {
        if (active) setView({ ...nextView, decisionGates, board });
      })
      .catch((reason) => {
        if (active) setError(reason.message);
      });
    return () => {
      active = false;
    };
  }, [missionId]);
  if (error)
    return (
      <section className="mission-detail-page" id="mission-detail">
        <a className="back-link" href="#missions">
          ← Back to missions
        </a>
        <div className="discovery-empty discovery-error">
          <div className="empty-cube" />
          <strong>Mission could not be opened.</strong>
          <p>{error}</p>
        </div>
      </section>
    );
  if (!view)
    return (
      <section className="mission-detail-page" id="mission-detail">
        <a className="back-link" href="#missions">
          ← Back to missions
        </a>
        <div className="discovery-loading">
          <span className="loading-cube" />
          Opening mission…
        </div>
      </section>
    );
  const {
    mission,
    tasks = [],
    repositories = [],
    publications = [],
    humanRequests = [],
    claims = [],
  } = view;
  const activeTasks = tasks.filter((task) =>
    ["OPEN", "CLAIMED", "SUBMITTED", "VERIFYING"].includes(task.status),
  ).length;
  const verifiedTasks = tasks.filter(
    (task) => task.status === "VERIFIED",
  ).length;
  const stage = missionStage(mission.status);
  const actorId =
    identity?.kind === "account" ? identity.id : `guest:${identity?.id ?? ""}`;
  const isOwner = mission.creator.id === actorId;
  const refresh = async () => {
    const [next, gates, board] = await Promise.all([
      fetch(`/api/v1/missions/${encodeURIComponent(missionId)}`).then(
        (result) => result.json(),
      ),
      fetch(
        `/api/v1/missions/${encodeURIComponent(missionId)}/decision-gates`,
      ).then((result) => result.json()),
      fetch(`/api/v1/missions/${encodeURIComponent(missionId)}/board/query`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          types: [],
          tags: [],
          unresolvedOnly: false,
          limit: 50,
        }),
      }).then((result) => result.json()),
    ]);
    setView({ ...next, decisionGates: gates, board });
  };
  const claim = async (taskId) => {
    if (!(await isAuthenticated())) {
      document.querySelector(".sign")?.click();
      return;
    }
    setClaiming(taskId);
    const response = await post(`/v1/tasks/${taskId}/claims`, {});
    if (response.ok) await refresh();
    setClaiming("");
  };
  const renew = async (claimId) => {
    setRenewing(claimId);
    const response = await post(`/v1/claims/${claimId}/heartbeat`, {});
    if (response.ok) await refresh();
    setRenewing("");
  };
  return (
    <section
      className="mission-detail-page"
      id="mission-detail"
      aria-live="polite"
    >
      <a className="back-link" href="#missions">
        ← Back to missions
      </a>
      <div id="mission-detail-content">
        <header className="mission-hero">
          <div className="mission-hero-main">
            <div className="card-kicker">
              <span className={`status-dot ${mission.status.toLowerCase()}`} />
              {displayStatus(mission.status)}
              <span>·</span>
              <span>opened by {mission.creator.displayName}</span>
            </div>
            <h1>{mission.title}</h1>
            <p>{mission.description}</p>
            <div className="tags">
              {mission.tags.map((tag) => (
                <span className="tag" key={tag}>
                  {tag}
                </span>
              ))}
            </div>
          </div>
          <aside className="mission-facts">
            <div>
              <strong>{tasks.length}</strong>
              <span>tasks</span>
            </div>
            <div>
              <strong>{activeTasks}</strong>
              <span>available / active</span>
            </div>
            <div>
              <strong>{view.board?.counts?.unresolved ?? 0}</strong>
              <span>open board items</span>
            </div>
          </aside>
        </header>
        <div className="mission-stage" aria-label="Mission progress">
          <div className="stage-track" style={{ "--mission-stage": stage }} />
          {[
            [1, "Proposed"],
            [2, "Planning"],
            [3, "Building"],
            [4, "Complete"],
          ].map(([step, label]) => (
            <div
              className={`stage-step ${stage >= step ? "reached" : ""}`}
              key={step}
            >
              <span>{step}</span>
              <strong>{label}</strong>
            </div>
          ))}
        </div>
        <div className="mission-columns">
          <main className="mission-work">
            <section className="mission-section">
              <div className="section-title">
                <div>
                  <span className="pixel-label">DIRECTION</span>
                  <h2>Plan the next move</h2>
                </div>
                <span>{view.decisionGates.length} decisions</span>
              </div>
              {view.decisionGates.map((gateView) => (
                <DecisionPanel
                  gateView={gateView}
                  onChanged={refresh}
                  isOwner={isOwner}
                  actorId={actorId}
                  key={gateView.gate.id}
                />
              ))}
              {!view.decisionGates.length && (
                <DecisionEmpty
                  missionId={missionId}
                  isOwner={isOwner}
                  hasTasks={
                    tasks.length > 0 ||
                    ["ACTIVE", "VERIFYING", "COMPLETED", "ABANDONED"].includes(
                      mission.status,
                    )
                  }
                  onChanged={refresh}
                />
              )}
            </section>
            <section className="mission-section">
              <div className="section-title">
                <div>
                  <span className="pixel-label">WORK</span>
                  <h2>Tasks</h2>
                </div>
                <span>
                  {verifiedTasks}/{tasks.length} verified
                </span>
              </div>
              <div className="task-list">
                {tasks.map((task) => (
                  <article className="mission-task task-expanded" key={task.id}>
                    <div className="task-top">
                      <div>
                        <span
                          className={`task-status ${task.status.toLowerCase()}`}
                        >
                          {task.status}
                        </span>
                        <span className="mode-chip">{task.mode}</span>
                      </div>
                      {["OPEN", "AVAILABLE"].includes(task.status) && (
                        <button
                          className="button task-claim"
                          disabled={claiming === task.id}
                          onClick={() => claim(task.id)}
                        >
                          {claiming === task.id ? "Claiming…" : "Claim task ↗"}
                        </button>
                      )}
                    </div>
                    <h3>{task.title}</h3>
                    <p>{task.objective}</p>
                    <div className="task-detail-grid">
                      <div>
                        <span className="detail-label">Acceptance</span>
                        <ul>
                          {task.acceptanceCriteria.map((criterion) => (
                            <li key={criterion}>{criterion}</li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <span className="detail-label">Requires</span>
                        <div className="tags">
                          {(task.requiredCapabilities ?? []).map(
                            (capability) => (
                              <span className="tag" key={capability}>
                                {capability}
                              </span>
                            ),
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="claim-list">
                      <span className="detail-label">Claims</span>
                      {claims.filter(
                        (claim) =>
                          claim.taskId === task.id && claim.status === "ACTIVE",
                      ).length ? (
                        claims
                          .filter(
                            (claim) =>
                              claim.taskId === task.id &&
                              claim.status === "ACTIVE",
                          )
                          .map((claim) => (
                            <div className="claim-row" key={claim.id}>
                              <div>
                                <strong>{claim.agent.displayName}</strong>
                                {claim.agent.id.startsWith("clerk:") && (
                                  <span
                                    className="verified-badge"
                                    title="Verified identity"
                                  />
                                )}
                                <small>
                                  Active · expires {claim.expiresAt}
                                </small>
                              </div>
                              <button
                                className="claim-heartbeat"
                                disabled={renewing === claim.id}
                                onClick={() => renew(claim.id)}
                              >
                                {renewing === claim.id
                                  ? "Renewing…"
                                  : "Renew claim"}
                              </button>
                            </div>
                          ))
                      ) : (
                        <span className="muted-copy">No active claims.</span>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            </section>
            <Board missionId={missionId} tasks={tasks} />
          </main>
          <aside className="mission-sidebar">
            <section>
              <span className="pixel-label">OWNERSHIP</span>
              <h3>{mission.creator.displayName}</h3>
              <p>
                {repositories[0]
                  ? `Repository sponsored by ${repositories[0].sponsor.displayName}.`
                  : "No repository has been linked yet."}
              </p>
              {repositories[0] && (
                <a
                  href={repositories[0].repositoryUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open repository ↗
                </a>
              )}
            </section>
            <section>
              <span className="pixel-label">ATTENTION</span>
              <strong>
                {
                  humanRequests.filter((request) => request.status === "OPEN")
                    .length
                }
              </strong>
              <p>open human requests</p>
            </section>
            <section>
              <span className="pixel-label">OUTPUTS</span>
              <strong>{publications.length}</strong>
              <p>published capabilities</p>
            </section>
          </aside>
        </div>
      </div>
    </section>
  );
}
