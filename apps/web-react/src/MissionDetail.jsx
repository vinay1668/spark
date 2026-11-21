import { useEffect, useState } from "react";
import { Board, post } from "./Board.jsx";
import { MissionProgress } from "./MissionProgress.jsx";
import { DecisionEmpty, DecisionPanel } from "./DecisionPanel.jsx";
import { getActiveIdentity, getAuthHeaders, isAuthenticated } from "./identity.js";

async function readAgentInterest(missionId) {
  const headers = await getAuthHeaders();
  const response = await fetch(
    `/api/v1/missions/${encodeURIComponent(missionId)}/agent-interest`,
    { headers },
  );
  return response.ok ? response.json() : null;
}

async function readPlanningPage(missionId, cursor) {
  const response = await fetch(`/api/v1/missions/${encodeURIComponent(missionId)}/decision-gates?page=true&limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, { headers: await getAuthHeaders() });
  if (!response.ok) throw new Error("Could not load planning threads");
  return response.json();
}

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
  const [interestBusy, setInterestBusy] = useState(false);
  const [identity, setIdentity] = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  const [historyLimit, setHistoryLimit] = useState(5);
  const [showResolved, setShowResolved] = useState(false);
  const [taskLimit, setTaskLimit] = useState(20);
  const [taskCursor, setTaskCursor] = useState(null);
  const [gateCursor, setGateCursor] = useState(null);
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
      readPlanningPage(missionId),
      fetch(`/api/v1/missions/${encodeURIComponent(missionId)}/progress`).then((response) => {
        if (!response.ok) throw new Error("Could not load mission progress.");
        return response.json();
      }),
      readAgentInterest(missionId),
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
      .then(([nextView, decisionGates, progress, agentInterest, board]) => {
        if (active) setView({ ...nextView, decisionGates: decisionGates.items ?? [], gateTotal: decisionGates.total, gateNextCursor: decisionGates.nextCursor, progress, agentInterest, board });
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
  const activeTasks = view.progress?.counts.active ?? tasks.filter((task) =>
    ["OPEN", "CLAIMED", "SUBMITTED", "VERIFYING"].includes(task.status),
  ).length;
  const verifiedTasks = view.progress?.counts.verified ?? tasks.filter(
    (task) => task.status === "VERIFIED",
  ).length;
  const stage = missionStage(mission.status);
  const actorId =
    identity?.kind === "account" ? identity.id : `guest:${identity?.id ?? ""}`;
  const isOwner = mission.creator.id === actorId;
  const archivedGates = view.decisionGates.filter(({ gate }) => ["SELECTED", "PAUSED"].includes(gate.status))
    .sort((a, b) => b.gate.createdAt.localeCompare(a.gate.createdAt));
  const activeGates = view.decisionGates.filter(({ gate }) => !["SELECTED", "PAUSED"].includes(gate.status));
  const openMission = !["COMPLETED", "ABANDONED"].includes(mission.status);
  const visibleTasks = tasks.filter((task) => showResolved || !["VERIFIED", "CANCELLED"].includes(task.status));
  const refresh = async () => {
    const [next, gates, progress, interest, board] = await Promise.all([
      fetch(`/api/v1/missions/${encodeURIComponent(missionId)}`).then(
        (result) => result.json(),
      ),
      readPlanningPage(missionId),
      fetch(`/api/v1/missions/${encodeURIComponent(missionId)}/progress`).then((response) => {
        if (!response.ok) throw new Error("Could not load mission progress.");
        return response.json();
      }),
      readAgentInterest(missionId),
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
    setTaskCursor(null); setGateCursor(null);
    setView({ ...next, decisionGates: gates.items ?? [], gateTotal: gates.total, gateNextCursor: gates.nextCursor, progress, agentInterest: interest, board });
  };
  const nextTasks = async (cursor) => {
    try {
      const response = await fetch(`/api/v1/missions/${encodeURIComponent(missionId)}/records/tasks?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      if (!response.ok) throw new Error("Could not load tasks");
      const page = await response.json();
      setTaskCursor(cursor);
      setTaskLimit(20);
      setView(current => ({ ...current, tasks: page.items, pagination: { ...current.pagination, tasks: { nextCursor: page.nextCursor, total: page.total } } }));
    } catch (reason) { setError(reason.message); }
  };
  const nextGates = async (cursor) => {
    try {
      const page = await readPlanningPage(missionId, cursor);
      setGateCursor(cursor);
      setView(current => ({ ...current, decisionGates: page.items, gateNextCursor: page.nextCursor }));
    } catch (reason) { setError(reason.message); }
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
  const toggleAgentInterest = async () => {
    setInterestBusy(true);
    const response = await post(
      `/v1/missions/${encodeURIComponent(missionId)}/agent-interest`,
      { action: view.agentInterest?.optedIn ? "LEAVE" : "JOIN" },
    );
    if (response.ok) await refresh();
    setInterestBusy(false);
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
        <MissionProgress progress={view.progress} isOwner={isOwner && identity?.kind === "account"} actorId={actorId} onChanged={refresh} />
        {view.gateNextCursor && <button className="button compact" onClick={() => nextGates(view.gateNextCursor)}>Next planning threads →</button>}
        {gateCursor && <button className="button compact" onClick={() => nextGates(null)}>First planning threads</button>}
        <div className="mission-columns">
          <main className="mission-work">
            <section className="mission-section">
              <div className="section-title">
                <div>
                  <span className="pixel-label">DIRECTION</span>
                  <h2>Planning threads</h2>
                </div>
                <span>{view.gateTotal ?? view.decisionGates.length} threads</span>
                {view.agentInterest?.actorType === "agent" && (
                  <button
                    className="button compact"
                    type="button"
                    onClick={toggleAgentInterest}
                    disabled={interestBusy}
                  >
                    {view.agentInterest.optedIn ? "Leave agent pool" : "Join agent pool"}
                  </button>
                )}
              </div>
              {activeGates.map((gateView) => (
                <DecisionPanel
                  gateView={gateView}
                  onChanged={refresh}
                  mission={mission}
                  actorId={actorId}
                  canRespond={view.agentInterest?.optedIn === true}
                  agentInterest={view.agentInterest}
                  key={gateView.gate.id}
                />
              ))}
              {archivedGates.length > 0 && <details className="mission-history" onToggle={(event) => setShowHistory(event.currentTarget.open)}>
                <summary>Earlier rounds · {archivedGates.length}</summary>
                {showHistory && archivedGates.slice(0, historyLimit).map((gateView) => <DecisionPanel
                  key={gateView.gate.id} gateView={gateView} onChanged={refresh} mission={mission}
                  actorId={actorId} canRespond={false} />)}
                {showHistory && archivedGates.length > historyLimit && <button className="button compact" onClick={() => setHistoryLimit((limit) => limit + 5)}>Show older rounds</button>}
              </details>}
              {openMission && <details className="mission-history" open={view.decisionGates.length === 0 ? true : undefined}>
                <summary>+ Start a planning thread</summary>
                <DecisionEmpty missionId={missionId} onChanged={refresh}
                  previousGates={archivedGates.filter(({ gate }) => gate.status === "SELECTED").map(({ gate }) => gate)} />
              </details>}
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
              {tasks.some((task) => ["VERIFIED", "CANCELLED"].includes(task.status)) && <label className="mission-history-toggle">
                <input type="checkbox" checked={showResolved} onChange={(event) => { setShowResolved(event.target.checked); setTaskLimit(20); }} /> Show finished work
              </label>}
              <div className="task-list">
                {visibleTasks.length === 0 && (
                  <div className="compact-empty">
                    <strong>{tasks.length ? "This round is clear." : "No tasks open yet."}</strong>
                    <span>{tasks.length ? "Start another planning round or review finished work." : "Tasks appear here after a plan is selected."}</span>
                  </div>
                )}
                {visibleTasks.slice(0, taskLimit).map((task) => (
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
            {visibleTasks.length > taskLimit && <button className="button compact" onClick={() => setTaskLimit((limit) => limit + 20)}>Show more tasks</button>}
            {view.pagination?.tasks?.nextCursor && <button className="button compact" onClick={() => nextTasks(view.pagination.tasks.nextCursor)}>Next tasks →</button>}
            {taskCursor && <button className="button compact" onClick={() => nextTasks(null)}>First tasks</button>}
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
              <strong>{publications.filter((publication) => publication.status === "PUBLISHED").length}</strong>
              <p>published capabilities</p>
            </section>
          </aside>
        </div>
      </div>
    </section>
  );
}
