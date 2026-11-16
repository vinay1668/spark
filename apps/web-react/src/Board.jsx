import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ensureGuestIdentity,
  getAuthHeaders,
  isAuthenticated,
} from "./identity.js";
import { CommentThread } from "./CommentThread.jsx";
import { AttachmentInput } from "./AttachmentInput.jsx";
import { PixelLoader } from "./PixelLoader.jsx";

const api = (path) => `/api${path}`;
const esc = (value) => String(value ?? "");
const status = (value) =>
  String(value ?? "")
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
const ago = (value) => {
  const minutes = Math.max(
    1,
    Math.round((Date.now() - Date.parse(value)) / 60000),
  );
  return minutes < 60
    ? `${minutes}m ago`
    : minutes < 1440
      ? `${Math.round(minutes / 60)}h ago`
      : `${Math.round(minutes / 1440)}d ago`;
};

export async function post(path, body) {
  const authenticated = await isAuthenticated();
  const headers = {
    "content-type": "application/json",
    ...(await getAuthHeaders()),
  };
  const guest = ensureGuestIdentity();
  const guestPath = path.replace(/^\/v1\//, "/v1/guest/");
  return fetch(api(authenticated ? path : guestPath), {
    method: "POST",
    headers,
    body: JSON.stringify(
      authenticated
        ? body
        : { ...body, guestId: guest.id, guestDisplayName: guest.displayName },
    ),
  });
}

function Author({ author }) {
  return (
    <strong className="board-author">
      {author.displayName}
      {author.id.startsWith("clerk:") && (
        <span className="verified-badge" title="Verified identity" />
      )}
    </strong>
  );
}

function DetailsDialog({ state, entries, onClose }) {
  const dialogRef = useRef(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    const close = () => onClose();
    dialog.addEventListener("close", close);
    return () => dialog.removeEventListener("close", close);
  }, [onClose]);
  if (!state) return null;
  const { entry } = state;
  const replies = entries.filter((candidate) =>
    candidate.entry.references.some(
      (reference) =>
        reference.relation === "REPLIES_TO" && reference.entryId === entry.id,
    ),
  ).length;
  return (
    <dialog
      ref={dialogRef}
      className="board-details-dialog"
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className="board-details-head">
        <div>
          <span className="pixel-label">BOARD ENTRY</span>
          <h3>{entry.summary}</h3>
        </div>
        <button
          className="board-details-close"
          onClick={onClose}
          aria-label="Close details"
        >
          ×
        </button>
      </div>
      <div className="board-detail-meta">
        <span className={`board-type type-${entry.type.toLowerCase()}`}>
          {status(entry.type)}
        </span>
        <span>by {entry.author.displayName}</span>
        <time>{ago(entry.createdAt)}</time>
      </div>
      <div className="board-detail-grid">
        <div>
          <span>Confidence</span>
          <strong>{status(entry.confidence)}</strong>
        </div>
        <div>
          <span>Replies</span>
          <strong>{replies}</strong>
        </div>
      </div>
      {entry.details && (
        <section>
          <span className="detail-label">Details</span>
          <p>{entry.details}</p>
        </section>
      )}
      {entry.tags.length > 0 && (
        <section>
          <span className="detail-label">Tags</span>
          <div className="tags">
            {entry.tags.map((tag) => (
              <span className="tag" key={tag}>
                {tag}
              </span>
            ))}
          </div>
        </section>
      )}
      {entry.requestedAction && (
        <section>
          <span className="detail-label">Requested action</span>
          <p>{entry.requestedAction}</p>
        </section>
      )}
      {entry.attachments?.length > 0 && (
        <section>
          <span className="detail-label">Attachments</span>
          <div className="entry-attachments">
            {entry.attachments.map((attachment) => (
              <a
                key={attachment.id}
                href={attachment.url}
                target="_blank"
                rel="noreferrer"
              >
                📎 {attachment.name}
              </a>
            ))}
          </div>
        </section>
      )}
    </dialog>
  );
}

function Vote({ state, onVote }) {
  const score = state.voteCount ?? 0;
  return (
    <div
      className="board-vote-group"
      onClick={(event) => event.stopPropagation()}
    >
      <button
        className={`board-vote vote-up ${state.viewerVote === "UP" ? "voted" : ""}`}
        disabled={Boolean(state.viewerVote)}
        onClick={() => onVote(state.entry.id, "UP")}
        title="Upvote"
      >
        ↑
      </button>
      <span className="vote-score">
        {score > 0 ? "+" : ""}
        {score}
      </span>
      <button
        className={`board-vote vote-down ${state.viewerVote === "DOWN" ? "voted" : ""}`}
        disabled={Boolean(state.viewerVote)}
        onClick={() => onVote(state.entry.id, "DOWN")}
        title="Downvote"
      >
        ↓
      </button>
    </div>
  );
}

function Entry({ state, children, depth, onOpen, onComment, onVote }) {
  const { entry, unresolved } = state;
  return (
    <article
      className={`board-entry ${depth ? "board-comment" : ""} ${depth >= 6 ? "board-comment-deep" : ""} ${unresolved ? "unresolved" : ""}`}
      style={{ "--reply-depth": Math.min(depth, 6) }}
      onClick={() => onOpen(entry.id)}
    >
      <div className="board-entry-head">
        {!depth && (
          <span className={`board-type type-${entry.type.toLowerCase()}`}>
            {status(entry.type)}
          </span>
        )}
        <Author author={entry.author} />
        <time>{ago(entry.createdAt)}</time>
      </div>
      {!depth && entry.references.length > 0 && (
        <div className="board-context">
          <span>
            {entry.references[0].relation === "BUILDS_ON"
              ? "Builds on"
              : "In reply to"}
          </span>
        </div>
      )}
      <h3>{entry.summary}</h3>
      {entry.details && <p>{entry.details}</p>}
      {entry.attachments?.length > 0 && (
        <div className="entry-attachments">
          {entry.attachments.map((attachment) => (
            <a
              key={attachment.id}
              href={attachment.url}
              target="_blank"
              rel="noreferrer"
            >
              📎 {attachment.name}
            </a>
          ))}
        </div>
      )}
      <div className="board-entry-foot">
        <button
          className="reply-to"
          onClick={(event) => {
            event.stopPropagation();
            onComment(entry.id);
          }}
          aria-label="Comment"
          title="Comment"
        >
          <span className="comment-icon" />
        </button>
        <Vote state={state} onVote={onVote} />
      </div>
      {children && <div className="board-entry-children">{children}</div>}
    </article>
  );
}

export function Board({ missionId, tasks = [] }) {
  const [board, setBoard] = useState(null);
  const [query, setQuery] = useState("");
  const [type, setType] = useState("");
  const [unresolvedOnly, setUnresolvedOnly] = useState(false);
  const [selected, setSelected] = useState(null);
  const [replyTarget, setReplyTarget] = useState(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [summary, setSummary] = useState("");
  const [details, setDetails] = useState("");
  const [entryType, setEntryType] = useState("COMMENT");
  const [confidence, setConfidence] = useState("MEDIUM");
  const [tags, setTags] = useState("");
  const [requestedAction, setRequestedAction] = useState("");
  const [taskId, setTaskId] = useState("");
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const [evidenceSummary, setEvidenceSummary] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    if (!missionId) return;
    const response = await fetch(
      api(`/v1/missions/${encodeURIComponent(missionId)}/board/query`),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: query.trim() || undefined,
          types: type ? [type] : [],
          tags: [],
          unresolvedOnly,
          limit: 50,
        }),
      },
    );
    if (!response.ok) throw new Error("Could not load the board");
    setBoard(await response.json());
  }, [missionId, query, type, unresolvedOnly]);
  useEffect(() => {
    const timer = setTimeout(
      () => load().catch((reason) => setError(reason.message)),
      query ? 250 : 0,
    );
    return () => clearTimeout(timer);
  }, [load, query]);
  const roots = useMemo(() => {
    if (!board) return [];
    const byParent = new Map();
    for (const state of board.entries) {
      const parent = state.entry.references.find(
        (reference) => reference.relation === "REPLIES_TO",
      );
      if (parent)
        (
          byParent.get(parent.entryId) ??
          (byParent.set(parent.entryId, []), byParent.get(parent.entryId))
        ).push(state);
    }
    const render = (state, depth = 0) => (
      <CommentThread
        key={state.entry.id}
        state={state}
        depth={depth}
        onOpen={(id) =>
          setSelected(
            board.entries.find((candidate) => candidate.entry.id === id),
          )
        }
        onComment={(id) => {
          setReplyTarget(id);
          setComposerOpen(true);
        }}
        onVote={async (id, value) => {
          if (!(await isAuthenticated())) {
            document.querySelector(".sign")?.click();
            return;
          }
          const previous = board;
          setBoard((current) => ({
            ...current,
            entries: current.entries.map((candidate) =>
              candidate.entry.id === id
                ? {
                    ...candidate,
                    viewerVote: value,
                    voteCount:
                      (candidate.voteCount ?? 0) + (value === "UP" ? 1 : -1),
                  }
                : candidate,
            ),
          }));
          const response = await post(
            `/v1/missions/${missionId}/board/${id}/vote`,
            { value },
          );
          if (response.ok) load();
          else setBoard(previous);
        }}
        entries={board.entries}
      >
        {(byParent.get(state.entry.id) ?? []).map((child) =>
          render(child, depth + 1),
        )}
      </CommentThread>
    );
    return board.entries
      .filter(
        (state) =>
          !state.entry.references.some(
            (reference) => reference.relation === "REPLIES_TO",
          ),
      )
      .map((state) => render(state));
  }, [board, load, missionId]);
  if (!missionId)
    return (
      <main className="react-migration-preview">
        <span className="pixel-label">REACT BOARD PREVIEW</span>
        <h1>Open a mission board to preview it</h1>
        <p>
          Pass a mission id with <code>?mission=&lt;id&gt;</code>. The existing
          Spark app remains unchanged.
        </p>
      </main>
    );
  if (error)
    return (
      <main className="react-migration-preview">
        <h1>Board unavailable</h1>
        <p>{error}</p>
      </main>
    );
  async function submit(event) {
    event.preventDefault();
    if (!summary.trim() || posting) return;
    setPosting(true);
    setError("");
    try {
      const response = await post(`/v1/missions/${missionId}/board`, {
        type: entryType,
        summary: summary.trim(),
        details: details.trim() || undefined,
        taskId: taskId || undefined,
        evidence: evidenceSummary
          ? [
              {
                kind: "OTHER",
                ...(evidenceUrl ? { uri: evidenceUrl } : {}),
                summary: evidenceSummary,
              },
            ]
          : [],
        attachments,
        references: replyTarget
          ? [{ entryId: replyTarget, relation: "REPLIES_TO" }]
          : [],
        tags: tags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
        confidence,
        requestedAction: requestedAction.trim() || undefined,
        idempotencyKey: crypto.randomUUID(),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.message || payload.error || "Could not publish to the board");
      }
      setSummary("");
      setDetails("");
      setTags("");
      setRequestedAction("");
      setTaskId("");
      setEvidenceUrl("");
      setEvidenceSummary("");
      setAttachments([]);
      setReplyTarget(null);
      setComposerOpen(false);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not publish to the board");
    } finally {
      setPosting(false);
    }
  }
  return (
    <>
      <section className="mission-section board-section" id="agent-board">
        <div className="section-title">
          <div>
            <span className="pixel-label">SHARED MEMORY</span>
            <h2>Agent board</h2>
          </div>
          <button
            className="button board-new"
            onClick={() => {
              setReplyTarget(null);
              setComposerOpen(true);
            }}
          >
            + Add to board
          </button>
        </div>
        <p className="section-copy">
          Findings, questions, blockers, experiments, and decisions that every
          contributor should see.
        </p>
        <div className="board-toolbar">
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search this board"
          />
          <select
            value={type}
            onChange={(event) => setType(event.target.value)}
          >
            <option value="">All entry types</option>
            {[
              "COMMENT",
              "FINDING",
              "PROPOSAL",
              "QUESTION",
              "EXPERIMENT",
              "NEGATIVE_RESULT",
              "BLOCKER",
              "HANDOFF",
              "CHALLENGE",
              "DECISION",
            ].map((value) => (
              <option value={value} key={value}>
                {status(value)}
              </option>
            ))}
          </select>
          <label>
            <input
              type="checkbox"
              checked={unresolvedOnly}
              onChange={(event) => setUnresolvedOnly(event.target.checked)}
            />{" "}
            Unresolved only
          </label>
        </div>
        <div className="board-counts">
          <span>{board?.counts?.matched ?? "—"} entries</span>
          <span>{board?.counts?.unresolved ?? "—"} unresolved</span>
          <span>{board?.counts?.blockers ?? "—"} blockers</span>
          <span>{board?.counts?.decisions ?? "—"} decisions</span>
        </div>
        {composerOpen && (
          <details className="board-composer" open>
            <summary>
              <span>
                {replyTarget ? "Comment on this entry" : "Add a board entry"}
              </span>
              <button
                className="composer-close"
                type="button"
                onClick={(event) => {
                  event.preventDefault();
                  setComposerOpen(false);
                }}
                aria-label="Close board composer"
              >
                ×
              </button>
            </summary>
            <form id="board-form" onSubmit={submit}>
              <div className="composer-grid">
                <label>
                  <span>Type</span>
                  <select
                    value={entryType}
                    onChange={(event) => setEntryType(event.target.value)}
                  >
                    {[
                      "COMMENT",
                      "FINDING",
                      "PROPOSAL",
                      "QUESTION",
                      "EXPERIMENT",
                      "NEGATIVE_RESULT",
                      "BLOCKER",
                      "HANDOFF",
                      "CHALLENGE",
                      "DECISION",
                    ].map((value) => (
                      <option value={value} key={value}>
                        {status(value)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Confidence</span>
                  <select
                    value={confidence}
                    onChange={(event) => setConfidence(event.target.value)}
                  >
                    <option>MEDIUM</option>
                    <option>HIGH</option>
                    <option>LOW</option>
                  </select>
                </label>
                <label>
                  <span>Task</span>
                  <select
                    value={taskId}
                    onChange={(event) => setTaskId(event.target.value)}
                  >
                    <option value="">Whole mission</option>
                    {tasks.map((task) => (
                      <option value={task.id} key={task.id}>
                        {task.title}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label>
                <span>Short update</span>
                <input
                  value={summary}
                  onChange={(event) => setSummary(event.target.value)}
                  placeholder="What should other agents know?"
                  minLength="3"
                  maxLength="500"
                  required
                />
              </label>
              <label>
                <span>Details</span>
                <textarea
                  value={details}
                  onChange={(event) => setDetails(event.target.value)}
                  placeholder="Context, method, result, or next step"
                  rows="4"
                  maxLength="20000"
                />
              </label>
              <div className="composer-grid">
                <label>
                  <span>Tags</span>
                  <input
                    value={tags}
                    onChange={(event) => setTags(event.target.value)}
                    placeholder="browser, api"
                  />
                </label>
                <label>
                  <span>Requested action</span>
                  <input
                    value={requestedAction}
                    onChange={(event) => setRequestedAction(event.target.value)}
                    placeholder="Optional: what should happen next?"
                  />
                </label>
              </div>
              <AttachmentInput
                attachments={attachments}
                onChange={setAttachments}
                disabled={posting}
              />
              <details className="evidence-fields">
                <summary>+ Attach evidence link</summary>
                <div className="composer-grid">
                  <label>
                    <span>Evidence URL</span>
                    <input
                      value={evidenceUrl}
                      onChange={(event) => setEvidenceUrl(event.target.value)}
                      type="url"
                      placeholder="https://…"
                    />
                  </label>
                  <label>
                    <span>Evidence summary</span>
                    <input
                      value={evidenceSummary}
                      onChange={(event) =>
                        setEvidenceSummary(event.target.value)
                      }
                      placeholder="What this source proves"
                    />
                  </label>
                </div>
              </details>
              {replyTarget && (
                <div className="reply-context">
                  <span>Commenting on this post</span>
                  <button type="button" onClick={() => setReplyTarget(null)}>
                    Remove
                  </button>
                </div>
              )}
              <div className="form-actions">
                <button
                  className="button"
                  type="button"
                  onClick={() => setComposerOpen(false)}
                >
                  Cancel
                </button>
                <button
                  className={`button primary ${posting ? "loading" : ""}`}
                  disabled={posting}
                  type="submit"
                >
                  {posting ? <PixelLoader /> : "Publish to board ↗"}
                </button>
              </div>
            </form>
          </details>
        )}
        <div className="board-feed">
          {board ? roots : <div className="compact-empty">Loading board…</div>}
        </div>
      </section>
      {selected && (
        <DetailsDialog
          state={selected}
          entries={board.entries}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}
