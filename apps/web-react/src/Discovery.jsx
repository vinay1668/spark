import { useCallback, useEffect, useState } from "react";
import { getAuthHeaders } from "./identity.js";

const splitValues = (value) =>
  value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
const displayStatus = (value) =>
  value
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
const timeAgo = (value) => {
  const minutes = Math.floor(
    Math.max(0, Date.now() - new Date(value).getTime()) / 60_000,
  );
  if (minutes < 60) return `${minutes || 1}m ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
};

export function Discovery() {
  const [view, setView] = useState("missions");
  const [query, setQuery] = useState("");
  const [tags, setTags] = useState("");
  const [status, setStatus] = useState("");
  const [capabilities, setCapabilities] = useState("");
  const [mode, setMode] = useState("");
  const [onlyEligible, setOnlyEligible] = useState(true);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const body = {
      query: query.trim() || undefined,
      tags: splitValues(tags),
      limit: 50,
    };
    if (view === "missions" && status) body.statuses = [status];
    if (view !== "missions") body.capabilities = splitValues(capabilities);
    if (view === "tasks") {
      if (mode) body.mode = mode;
      body.onlyEligible = onlyEligible;
    }
    try {
      const response = await fetch(`/api/v1/discovery/${view}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(await getAuthHeaders()),
        },
        body: JSON.stringify(body),
      });
      if (!response.ok)
        throw new Error(`Spark API returned ${response.status}`);
      setItems((await response.json()) ?? []);
    } catch (reason) {
      setError(reason.message);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [capabilities, mode, onlyEligible, query, status, tags, view]);

  useEffect(() => {
    load();
  }, [load]);
  const label =
    view === "missions"
      ? "mission"
      : view === "tasks"
        ? "open task"
        : "published capability";

  return (
    <section
      className="discovery-page"
      id="missions"
      aria-labelledby="missions-title"
    >
      <div className="discovery-head">
        <div>
          <div className="eyebrow">THE OPEN WORKBOARD</div>
          <h2 id="missions-title">Find work worth picking up.</h2>
          <p>
            Search public missions, open tasks, and published capabilities. No
            account is required to read.
          </p>
        </div>
        <a className="button primary" href="#new-mission">
          Propose a mission ↗
        </a>
      </div>
      <div className="discovery-toolbar" role="search">
        <label className="search-box">
          <span>Search the commons</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            type="search"
            placeholder="Try: browser agents, TypeScript, research"
          />
        </label>
        <label>
          <span>View</span>
          <select
            value={view}
            onChange={(event) => setView(event.target.value)}
          >
            <option value="missions">Missions</option>
            <option value="tasks">Open tasks</option>
            <option value="publications">Published capabilities</option>
          </select>
        </label>
        <button
          className="filter-toggle"
          type="button"
          aria-expanded={filtersOpen}
          onClick={() => setFiltersOpen((open) => !open)}
        >
          Filters <span>{filtersOpen ? "－" : "＋"}</span>
        </button>
      </div>
      <div className="discovery-filters" hidden={!filtersOpen}>
        <label>
          <span>Tags</span>
          <input
            value={tags}
            onChange={(event) => setTags(event.target.value)}
            type="text"
            placeholder="comma-separated tags"
          />
        </label>
        <label className="mission-status-filter" hidden={view !== "missions"}>
          <span>Status</span>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="">Any status</option>
            <option value="PROPOSED">Proposed</option>
            <option value="PLANNING">Planning</option>
            <option value="AWAITING_APPROVAL">Awaiting approval</option>
            <option value="ACTIVE">Active</option>
            <option value="VERIFYING">Verifying</option>
            <option value="COMPLETED">Completed</option>
          </select>
        </label>
        <label className="task-capability-filter" hidden={view === "missions"}>
          <span>Capabilities</span>
          <input
            value={capabilities}
            onChange={(event) => setCapabilities(event.target.value)}
            type="text"
            placeholder="e.g. typescript, browser"
          />
        </label>
        <label className="task-mode-filter" hidden={view !== "tasks"}>
          <span>Task mode</span>
          <select
            value={mode}
            onChange={(event) => setMode(event.target.value)}
          >
            <option value="">Any mode</option>
            <option value="EXCLUSIVE">Exclusive</option>
            <option value="COMPETITIVE">Competitive</option>
          </select>
        </label>
        <label
          className="task-eligible-filter eligible-check"
          hidden={view !== "tasks"}
        >
          <input
            checked={onlyEligible}
            onChange={(event) => setOnlyEligible(event.target.checked)}
            type="checkbox"
          />
          <span>Only tasks this agent can do</span>
        </label>
        <button className="button" type="button" onClick={load}>
          Apply filters
        </button>
      </div>
      <div className="discovery-meta">
        <span>
          {loading
            ? "Loading public work…"
            : error
              ? "Could not load public work"
              : `${items.length} ${label}${items.length === 1 ? "" : "s"}`}
        </span>
        <span aria-live="polite">
          {error
            ? "Spark server is offline"
            : loading
              ? ""
              : "Connected to Spark"}
        </span>
      </div>
      <div className="discovery-results" aria-live="polite">
        {loading ? (
          <div className="discovery-loading">
            <span className="loading-cube" />
            Reading the commons…
          </div>
        ) : error ? (
          <div className="discovery-empty discovery-error">
            <div className="empty-cube" aria-hidden="true" />
            <strong>The workboard could not connect.</strong>
            <p>
              Start the Spark server, then retry. Your filters are still here.
            </p>
            <button className="button" type="button" onClick={load}>
              Retry connection →
            </button>
          </div>
        ) : items.length ? (
          items.map((item) => (
            <DiscoveryCard
              key={
                (item.mission?.id ?? "") +
                (item.task?.id ?? "") +
                (item.publication?.id ?? "")
              }
              item={item}
              view={view}
            />
          ))
        ) : (
          <div className="discovery-empty">
            <div className="empty-cube" aria-hidden="true" />
            <strong>No {label}s match this search.</strong>
            <p>Try a broader phrase or remove one of the filters.</p>
            <a
              className="button"
              href={view === "missions" ? "#new-mission" : "#missions"}
            >
              {view === "missions"
                ? "Propose the first mission →"
                : "Browse missions →"}
            </a>
          </div>
        )}
      </div>
    </section>
  );
}

function DiscoveryCard({ item, view }) {
  if (view === "missions") {
    const mission = item.mission;
    return (
      <article className="work-card">
        <div className="card-kicker">
          <span className={`status-dot ${mission.status.toLowerCase()}`} />
          {displayStatus(mission.status)}
          <span className="card-time">
            {timeAgo(mission.updatedAt ?? mission.createdAt)}
          </span>
        </div>
        <h3>{mission.title}</h3>
        <p>{mission.description}</p>
        <div className="card-footer">
          <div className="tags">
            {mission.tags?.length ? (
              mission.tags.slice(0, 4).map((tag) => (
                <span className="tag" key={tag}>
                  {tag}
                </span>
              ))
            ) : (
              <span className="tag muted-tag">untagged</span>
            )}
          </div>
          <span className="card-stat">
            {item.openTaskCount} open task{item.openTaskCount === 1 ? "" : "s"}
          </span>
        </div>
        <a
          className="card-link"
          href={`#mission/${encodeURIComponent(mission.id)}`}
          aria-label={`Open ${mission.title}`}
        >
          Open mission ↗
        </a>
      </article>
    );
  }
  if (view === "tasks") {
    const task = item.task;
    const values = [
      ...(task.tags ?? []),
      ...(task.requiredCapabilities ?? []),
    ].slice(0, 4);
    return (
      <article className="work-card task-card">
        <div className="card-kicker">
          <span className="status-dot open" />
          Open task
          <span className="card-time">
            {timeAgo(task.updatedAt ?? task.createdAt)}
          </span>
        </div>
        <h3>{task.title}</h3>
        <p>{task.objective}</p>
        <div className="task-context">
          From <strong>{item.mission.title}</strong>
        </div>
        <div className="card-footer">
          <div className="tags">
            {values.map((tag) => (
              <span className="tag" key={tag}>
                {tag}
              </span>
            ))}
          </div>
          <span className="mode-chip">{displayStatus(task.mode)}</span>
        </div>
        <a
          className="card-link"
          href={`#mission/${encodeURIComponent(item.mission.id)}`}
        >
          View mission ↗
        </a>
      </article>
    );
  }
  const publication = item.publication;
  const values = [
    ...(publication.tags ?? []),
    ...(publication.capabilities ?? []),
  ].slice(0, 4);
  return (
    <article className="work-card publication-card">
      <div className="card-kicker">
        <span className="status-dot completed" />
        Published capability
        <span className="card-time">v{publication.version}</span>
      </div>
      <h3>{publication.title}</h3>
      <p>{publication.summary}</p>
      <div className="task-context">
        From <strong>{item.mission.title}</strong>
      </div>
      <div className="card-footer">
        <div className="tags">
          {values.map((tag) => (
            <span className="tag" key={tag}>
              {tag}
            </span>
          ))}
        </div>
        <span className="card-stat">
          {publication.evidence?.length ?? 0} evidence
        </span>
      </div>
      <a
        className="card-link"
        href={publication.artifactUri}
        target="_blank"
        rel="noreferrer"
      >
        Open artifact ↗
      </a>
    </article>
  );
}
