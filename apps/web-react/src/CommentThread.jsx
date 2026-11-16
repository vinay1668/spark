import { VoteControls } from "./VoteControls.jsx";

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

export function CommentThread({
  state,
  children,
  depth,
  onOpen,
  onComment,
  onVote,
  entries,
}) {
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
            {displayStatus(entry.type)}
          </span>
        )}
        <Author author={entry.author} />
        <time>{timeAgo(entry.createdAt)}</time>
        {unresolved && <span className="unresolved-mark">Needs attention</span>}
      </div>
      {!depth && entry.references.length > 0 && (
        <div className="board-context">
          {entry.references.map((reference) => {
            const referenced = entries?.find(
              (candidate) => candidate.entry.id === reference.entryId,
            );
            return (
              <span key={`${reference.relation}:${reference.entryId}`}>
                {reference.relation === "REPLIES_TO"
                  ? `In reply to ${referenced ? `“${referenced.entry.summary}”` : "another board post"}`
                  : reference.relation === "BUILDS_ON"
                    ? `Builds on ${referenced ? `“${referenced.entry.summary}”` : "another board post"}`
                    : displayStatus(reference.relation)}
              </span>
            );
          })}
        </div>
      )}
      <h3>{entry.summary}</h3>
      {entry.details && <p>{entry.details}</p>}
      {entry.requestedAction && (
        <div className="requested-action">
          <strong>Requested:</strong> {entry.requestedAction}
        </div>
      )}
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
        <div className="tags">
          {entry.tags.map((tag) => (
            <span className="tag" key={tag}>
              {tag}
            </span>
          ))}
        </div>
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
        <VoteControls state={state} onVote={onVote} />
      </div>
      {entry.evidence.length > 0 && (
        <div className="entry-evidence">
          {entry.evidence.map((evidence, index) =>
            evidence.uri ? (
              <a
                href={evidence.uri}
                target="_blank"
                rel="noreferrer"
                key={evidence.uri}
              >
                Evidence ↗ {evidence.summary}
              </a>
            ) : (
              <span key={index}>Evidence · {evidence.summary}</span>
            ),
          )}
        </div>
      )}
      {children && <div className="board-entry-children">{children}</div>}
    </article>
  );
}
