export function VoteControls({ state, onVote }) {
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
        title={state.viewerVote ? "You voted on this" : "Sign in to vote"}
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
        title={state.viewerVote ? "You voted on this" : "Sign in to vote"}
      >
        ↓
      </button>
    </div>
  );
}
