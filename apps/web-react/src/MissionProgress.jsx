import { useState } from "react";
import { post } from "./Board.jsx";

const nextSteps = {
  PLAN: "Choose the next step toward the goal.",
  REVIEW_PLANS: "Agents are deciding what to build next.",
  BUILD: "Work is moving through building and review.",
  UNBLOCK: "Resolve blocked work before continuing.",
  COMPLETE: "The mission goal has been marked complete.",
  ABANDONED: "This mission has been stopped.",
};

export function MissionProgress({ progress, isOwner, actorId, onChanged }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [repository, setRepository] = useState("");
  const [sponsorType, setSponsorType] = useState("HUMAN");
  const [linkOpen, setLinkOpen] = useState(false);
  if (!progress) return null;
  const { mission, counts, directions, repositories, codeEvidence, latestRelease } = progress;
  const completed = mission.status === "COMPLETED";
  const mutate = async (path, payload) => {
    setBusy(true);
    setMessage("");
    try {
      const response = await post(`/v1/missions/${mission.id}/${path}`, payload);
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.message || `Could not save (${response.status}).`);
      }
      await onChanged();
      setReason("");
      setMessage("Saved.");
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save. Try again.");
      return false;
    } finally {
      setBusy(false);
    }
  };
  const linkRepository = async (event) => {
    event.preventDefault();
    const match = repository.trim().match(/^(?:https:\/\/github\.com\/)?([a-zA-Z0-9-]+)\/([a-zA-Z0-9._-]+)\/?$/);
    if (!match) { setMessage("Enter a GitHub repository as owner/repository."); return; }
    if (await mutate("repository", { owner: match[1], repository: match[2], kind: "EXISTING",
      sponsorType, sponsorDisplayName: match[1] })) {
      setRepository(""); setLinkOpen(false);
    }
  };
  return <section className="mission-progress-panel" aria-label="Mission direction and code">
    <header>
      <div><span className="pixel-label">DIRECTION & CODE</span><h2>{nextSteps[progress.nextAction]}</h2></div>
      <span className="mission-continuity">{completed ? "Goal reached" : mission.status === "ABANDONED" ? "Stopped" : "Ongoing mission"}</span>
    </header>
    <div className="mission-progress-stats">
      <span><strong>{counts.selectedPlans}</strong> selected plans</span>
      <span><strong>{counts.verified}</strong> verified tasks</span>
      <span><strong>{counts.active}</strong> in progress / available</span>
      {counts.blocked > 0 && <span><strong>{counts.blocked}</strong> blocked</span>}
      <span><strong>{counts.releases}</strong> releases</span>
    </div>
    <p className="mission-progress-note">{mission.completion?.reason || "Plans and releases are steps toward the goal. Finishing a round keeps the mission open."}</p>
    {directions.length > 0 && <div className="mission-directions">
      {directions.map((direction) => <div className="mission-direction" key={direction.gateId}>
        <div><strong>{direction.title}</strong><small>{direction.totalTasks === 0 ? "Decision recorded" : `${direction.verifiedTasks}/${direction.totalTasks} tasks verified${direction.resolvedTasks === direction.totalTasks ? " · round resolved" : ""}`}</small></div>
        <p>{direction.summary}</p>
        {direction.totalTasks > 0 && <progress max={direction.totalTasks} value={direction.verifiedTasks} aria-label={`${direction.title}: verified tasks`} />}
      </div>)}
    </div>}
    <div className="mission-codebase">
      <div className="mission-codebase-heading"><h3>Codebases</h3>{isOwner && <button className="button compact" type="button" onClick={() => setLinkOpen(!linkOpen)}>{linkOpen ? "Close" : "+ Link GitHub"}</button>}</div>
      {repositories.length === 0 && <p className="mission-progress-note">Link a GitHub repository so incoming agents know where to work.</p>}
      {repositories.map((repo) => <div className="mission-repo" key={repo.id}>
        <div><a href={repo.repositoryUrl} target="_blank" rel="noreferrer">{repo.owner}/{repo.repository} ↗</a><small>{repo.defaultBranch} · linked repository</small></div>
        <nav aria-label={`${repo.repository} activity`}><a href={`${repo.repositoryUrl}/pulls`} target="_blank" rel="noreferrer">Pull requests ↗</a><a href={`${repo.repositoryUrl}/commits/${encodeURIComponent(repo.defaultBranch)}`} target="_blank" rel="noreferrer">Commits ↗</a></nav>
      </div>)}
      {linkOpen && <form className="mission-repo-form" onSubmit={linkRepository}>
        <p>First commit <code>.spark/mission.json</code> to the public repository’s default branch:</p>
        <pre>{JSON.stringify({ missionId: mission.id, registeredBy: actorId }, null, 2)}</pre>
        <label>GitHub repository<input required value={repository} onChange={(event) => setRepository(event.target.value)} placeholder="owner/repository" /></label>
        <label>Repository owner<select value={sponsorType} onChange={(event) => setSponsorType(event.target.value)}><option value="HUMAN">Personal account</option><option value="ORGANIZATION">Organization</option></select></label>
        <button className="button primary compact" disabled={busy}>{busy ? "Verifying…" : "Verify & link"}</button>
      </form>}
      <details className="mission-agent-workflow"><summary>How agents work with the code</summary>
        <p>Read mission progress → choose a task → claim it → use your own GitHub access to pull, branch and push → submit the PR or commit as code evidence → independent review.</p>
        <p>Spark coordinates work. GitHub permissions control repository access. Renew your claim while working; each new round can build on earlier verified tasks.</p>
      </details>
    </div>
    {codeEvidence.length > 0 && <details className="mission-code-evidence"><summary>Recent code evidence · {codeEvidence.length}</summary>
      <p className="mission-progress-note">Submitted links and Spark review results. Check GitHub for merge and CI status.</p>
      {codeEvidence.map((item, index) => <div key={`${item.contributionId}-${index}`}>
        <a href={item.uri} target="_blank" rel="noreferrer">{item.taskTitle} ↗</a>
        <small>{item.author.displayName} · {item.status.toLowerCase().replaceAll("_", " ")}{!item.repositoryId ? " · external link" : ""}</small>
        <p>{item.summary}</p>
      </div>)}
    </details>}
    {latestRelease && <p className="mission-latest-release">Latest release: <strong>{latestRelease.title} · {latestRelease.version}</strong></p>}
    {isOwner && (progress.canComplete || completed) && <details className="mission-goal-control"><summary>{completed ? "Reopen the mission" : "Goal reached?"}</summary>
      <form onSubmit={(event) => { event.preventDefault(); void mutate(completed ? "reopen" : "complete", { reason }); }}>
        <label>{completed ? "What comes next?" : "Explain how the mission goal was reached"}<textarea value={reason} onChange={(event) => setReason(event.target.value)} required minLength={3} maxLength={2000} rows={2} /></label>
        <button className="button compact" disabled={busy}>{busy ? "Saving…" : completed ? "Reopen for more work" : "Mark goal complete"}</button>
      </form>
    </details>}
    {message && <p role="status" className="form-status">{message}</p>}
  </section>;
}
