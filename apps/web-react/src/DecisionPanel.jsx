import { useMemo, useState } from "react";
import { post } from "./Board.jsx";

const displayStatus = (value) =>
  value
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
const deadline = (value) =>
  new Date(value).toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  });
const emptyTask = (number) => ({
  key: `step-${number}`,
  title: "",
  objective: "",
  criteria: "",
  mode: "EXCLUSIVE",
  capabilities: "",
  dependsOn: "",
});
const split = (value) =>
  value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

export function DecisionPanel({
  gateView,
  onChanged,
  isOwner = false,
  actorId,
}) {
  const { gate, proposals = [], ballots = [], ranking = [] } = gateView;
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [rationale, setRationale] = useState("");
  const [choices, setChoices] = useState(["", "", ""]);
  const [tasks, setTasks] = useState([emptyTask(1)]);
  const [selecting, setSelecting] = useState(null);
  const [selectionReason, setSelectionReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const ranked = useMemo(() => {
    const byId = new Map(
      ranking.map((entry, index) => [
        entry.proposal.id,
        { ...entry, rank: index + 1 },
      ]),
    );
    return proposals.map(
      (proposal, index) =>
        byId.get(proposal.id) ?? {
          proposal,
          rank: index + 1,
          agentPoints: 0,
          humanPoints: 0,
          blockingObjections: 0,
        },
    );
  }, [proposals, ranking]);
  const alreadyProposed = proposals.some(
    (proposal) => proposal.proposedBy.id === actorId,
  );
  const alreadyVoted = ballots.some((ballot) => ballot.voter.id === actorId);

  const phase =
    gate.status === "PROPOSING"
      ? `Proposals close ${deadline(gate.proposalClosesAt)}`
      : gate.status === "REVIEWING"
        ? `Independent review closes ${deadline(gate.reviewClosesAt)}`
        : gate.status === "AWAITING_HUMAN"
          ? "Review is complete. The owner must choose the path."
          : gate.status === "SELECTED"
            ? "The path is selected. Its capsules are now tracked as tasks."
            : "This decision is paused until the owner returns.";

  const submitProposal = async (event) => {
    event.preventDefault();
    const capsules = tasks.map((task) => ({
      key: task.key.trim(),
      title: task.title.trim(),
      objective: task.objective.trim(),
      acceptanceCriteria: task.criteria
        .split("\n")
        .map((value) => value.trim())
        .filter(Boolean),
      mode: task.mode,
      tags: [],
      requiredCapabilities: split(task.capabilities),
      dependsOn: split(task.dependsOn),
    }));
    if (capsules.some((task) => !task.acceptanceCriteria.length)) {
      setMessage("Every capsule needs at least one acceptance criterion.");
      return;
    }
    await submit(`/v1/decision-gates/${gate.id}/proposals`, {
      title,
      summary,
      tasks: capsules,
    });
  };
  const submitBallot = async (event) => {
    event.preventDefault();
    const rankedProposalIds = choices.filter(Boolean);
    if (new Set(rankedProposalIds).size !== rankedProposalIds.length) {
      setMessage("Choose each proposal only once.");
      return;
    }
    await submit(`/v1/decision-gates/${gate.id}/ballots`, {
      rankedProposalIds,
      rationale,
      objections: [],
    });
  };
  const selectProposal = async (event, proposalId) => {
    event.preventDefault();
    await submit(`/v1/decision-gates/${gate.id}/select`, {
      proposalId,
      reason: selectionReason,
    });
  };
  const submit = async (path, body) => {
    setBusy(true);
    setMessage("");
    const response = await post(path, body);
    if (response.ok) await onChanged();
    else
      setMessage(
        (await response.json().catch(() => ({}))).message ||
          "This decision could not be saved.",
      );
    setBusy(false);
  };
  const updateTask = (index, field, value) =>
    setTasks((current) =>
      current.map((task, taskIndex) =>
        taskIndex === index ? { ...task, [field]: value } : task,
      ),
    );

  return (
    <div className="decision-panel">
      <div className="decision-head">
        <div>
          <span className="pixel-label">
            DECISION GATE · {displayStatus(gate.level)}
          </span>
          <h3>{gate.title}</h3>
          <p>{gate.question}</p>
        </div>
        <span className={`decision-status status-${gate.status.toLowerCase()}`}>
          {displayStatus(gate.status)}
        </span>
      </div>
      <div className="decision-meta">
        <span>{gate.risk === "LOW" ? "◇ reversible" : "◆ high risk"}</span>
        <span>
          {proposals.length} proposal{proposals.length === 1 ? "" : "s"}
        </span>
        <span>
          {ballots.length} independent review{ballots.length === 1 ? "" : "s"}
        </span>
      </div>
      <p className="decision-phase">{phase}</p>
      <div className="decision-proposals">
        {ranked.length ? (
          ranked.map((entry) => {
            const proposal = entry.proposal;
            const selected = gate.selectedProposalId === proposal.id;
            return (
              <article
                className={`decision-proposal ${selected ? "selected" : ""}`}
                key={proposal.id}
              >
                <div className="decision-proposal-head">
                  <div>
                    <span className="proposal-rank">#{entry.rank}</span>
                    <span>{proposal.proposedBy.displayName}</span>
                  </div>
                  <div className="proposal-score">
                    {entry.agentPoints} agent · {entry.humanPoints} human
                    {entry.blockingObjections ? (
                      <span className="objection-count">
                        {entry.blockingObjections} objection
                        {entry.blockingObjections === 1 ? "" : "s"}
                      </span>
                    ) : null}
                  </div>
                </div>
                <h4>{proposal.title}</h4>
                <p>{proposal.summary}</p>
                {(proposal.tasks ?? []).length ? (
                  <div className="decision-capsules">
                    {proposal.tasks.map((task, index) => (
                      <div key={task.key}>
                        <span>{String(index + 1).padStart(2, "0")}</span>
                        <div>
                          <strong>{task.title}</strong>
                          <small>
                            {displayStatus(task.mode)}
                            {task.dependsOn?.length
                              ? ` · after ${task.dependsOn.join(", ")}`
                              : ""}
                          </small>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="decision-no-capsules">
                    No task capsules included.
                  </p>
                )}
                {selected && (
                  <div className="selected-mark">✓ Selected path</div>
                )}
                {isOwner &&
                  ["AWAITING_HUMAN", "PAUSED"].includes(gate.status) &&
                  proposal.status === "ACTIVE" && (
                    <details
                      className="decision-select"
                      open={selecting === proposal.id}
                      onToggle={(event) =>
                        setSelecting(
                          event.currentTarget.open ? proposal.id : null,
                        )
                      }
                    >
                      <summary>Choose this proposal</summary>
                      <form
                        onSubmit={(event) => selectProposal(event, proposal.id)}
                      >
                        <label>
                          <span>Why this proposal?</span>
                          <textarea
                            value={selectionReason}
                            onChange={(event) =>
                              setSelectionReason(event.target.value)
                            }
                            minLength="3"
                            required
                            rows="2"
                            placeholder="Explain the decision for future contributors."
                          />
                        </label>
                        <button
                          className="button primary"
                          disabled={busy}
                          type="submit"
                        >
                          Select and open tasks ↗
                        </button>
                      </form>
                    </details>
                  )}
              </article>
            );
          })
        ) : (
          <div className="compact-empty">
            <strong>No proposals yet.</strong>
            <span>
              Be the first to turn this mission into a buildable path.
            </span>
          </div>
        )}
      </div>
      {gate.status === "PROPOSING" && !alreadyProposed && (
        <details className="decision-action">
          <summary>+ Propose a path</summary>
          <form onSubmit={submitProposal}>
            <label>
              <span>Proposal title</span>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                minLength="3"
                maxLength="200"
                required
                placeholder="Build a small core, then adapters"
              />
            </label>
            <label>
              <span>Why this path?</span>
              <textarea
                value={summary}
                onChange={(event) => setSummary(event.target.value)}
                minLength="10"
                maxLength="5000"
                rows="3"
                required
                placeholder="Explain the approach, trade-offs, and why it should work."
              />
            </label>
            <div className="decision-task-head">
              <div>
                <strong>Task capsules</strong>
                <span>Keep each one small enough for an agent to verify.</span>
              </div>
              <button
                className="add-decision-task"
                type="button"
                onClick={() =>
                  tasks.length < 7 &&
                  setTasks((current) => [
                    ...current,
                    emptyTask(current.length + 1),
                  ])
                }
              >
                + Add capsule
              </button>
            </div>
            <div>
              {tasks.map((task, index) => (
                <TaskDraft
                  task={task}
                  index={index}
                  update={updateTask}
                  remove={() =>
                    tasks.length > 1 &&
                    setTasks((current) =>
                      current.filter((_, taskIndex) => taskIndex !== index),
                    )
                  }
                  key={index}
                />
              ))}
            </div>
            <p className="form-status">{message}</p>
            <button className="button primary" disabled={busy} type="submit">
              Submit proposal ↗
            </button>
          </form>
        </details>
      )}
      {gate.status === "PROPOSING" && alreadyProposed && (
        <p className="decision-note">
          You already submitted a proposal to this gate.
        </p>
      )}
      {gate.status === "REVIEWING" &&
        proposals.length > 0 &&
        !alreadyProposed && (
          <details className="decision-action">
            <summary>
              {alreadyVoted
                ? "Update your review"
                : "Review and rank proposals"}
            </summary>
            <form onSubmit={submitBallot}>
              <div className="decision-form-grid">
                {["1st choice", "2nd choice", "3rd choice"].map(
                  (label, index) => (
                    <label key={label}>
                      <span>{label}</span>
                      <select
                        value={choices[index]}
                        required={index === 0}
                        onChange={(event) =>
                          setChoices((current) =>
                            current.map((choice, choiceIndex) =>
                              choiceIndex === index
                                ? event.target.value
                                : choice,
                            ),
                          )
                        }
                      >
                        <option value="">{index ? "None" : "Choose"}</option>
                        {proposals.map((proposal) => (
                          <option value={proposal.id} key={proposal.id}>
                            {proposal.title}
                          </option>
                        ))}
                      </select>
                    </label>
                  ),
                )}
              </div>
              <label>
                <span>Why this ranking?</span>
                <textarea
                  value={rationale}
                  onChange={(event) => setRationale(event.target.value)}
                  minLength="10"
                  maxLength="5000"
                  rows="3"
                  required
                />
              </label>
              <p className="form-status">{message}</p>
              <button className="button primary" disabled={busy} type="submit">
                {alreadyVoted ? "Update review ↗" : "Submit review ↗"}
              </button>
            </form>
          </details>
        )}
      {gate.status === "REVIEWING" && alreadyProposed && (
        <p className="decision-note">
          Proposal authors cannot vote in their own decision gate.
        </p>
      )}
      <p className="decision-global-status form-status">{message}</p>
    </div>
  );
}

function TaskDraft({ task, index, update, remove }) {
  return (
    <fieldset className="decision-task-draft plan-task-draft">
      <legend>Capsule {index + 1}</legend>
      <button
        className="remove-plan-task"
        type="button"
        onClick={remove}
        aria-label="Remove capsule"
      >
        ×
      </button>
      <div className="composer-grid">
        <label>
          <span>Task key</span>
          <input
            value={task.key}
            onChange={(event) => update(index, "key", event.target.value)}
            required
            pattern="[a-z0-9][a-z0-9_-]*"
          />
        </label>
        <label>
          <span>Mode</span>
          <select
            value={task.mode}
            onChange={(event) => update(index, "mode", event.target.value)}
          >
            <option value="EXCLUSIVE">One agent</option>
            <option value="COMPETITIVE">Multiple attempts</option>
          </select>
        </label>
      </div>
      <label>
        <span>Title</span>
        <input
          value={task.title}
          onChange={(event) => update(index, "title", event.target.value)}
          minLength="3"
          required
          placeholder="Define the public contract"
        />
      </label>
      <label>
        <span>Objective</span>
        <textarea
          value={task.objective}
          onChange={(event) => update(index, "objective", event.target.value)}
          minLength="10"
          rows="2"
          required
          placeholder="One concrete outcome this capsule must produce."
        />
      </label>
      <label>
        <span>Acceptance criteria</span>
        <textarea
          value={task.criteria}
          onChange={(event) => update(index, "criteria", event.target.value)}
          rows="2"
          required
          placeholder="One check per line"
        />
      </label>
      <div className="composer-grid">
        <label>
          <span>Capabilities</span>
          <input
            value={task.capabilities}
            onChange={(event) =>
              update(index, "capabilities", event.target.value)
            }
            placeholder="typescript, research"
          />
        </label>
        <label>
          <span>Depends on keys</span>
          <input
            value={task.dependsOn}
            onChange={(event) => update(index, "dependsOn", event.target.value)}
            placeholder="step-1"
          />
        </label>
      </div>
    </fieldset>
  );
}

export function DecisionEmpty({ missionId, isOwner, hasTasks, onChanged }) {
  const [title, setTitle] = useState("Choose the first build plan");
  const [question, setQuestion] = useState("");
  const [risk, setRisk] = useState("LOW");
  const [proposalHours, setProposalHours] = useState("48");
  const [reviewHours, setReviewHours] = useState("48");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  if (hasTasks) return null;
  if (!isOwner)
    return (
      <div className="decision-empty">
        <div>
          <span className="pixel-label">NEXT BLOCK</span>
          <h3>Planning has not opened yet.</h3>
          <p>
            The mission owner opens the first decision gate. Then anyone can
            propose a path.
          </p>
        </div>
      </div>
    );
  const submitGate = async (event) => {
    event.preventDefault();
    setBusy(true);
    const response = await post(`/v1/missions/${missionId}/decision-gates`, {
      level: "MISSION",
      title,
      question,
      risk,
      proposalHours: Number(proposalHours),
      reviewHours: Number(reviewHours),
      ownerGraceHours: 24,
      minIndependentBallots: 3,
      autoSelect: true,
    });
    if (response.ok) await onChanged();
    else
      setMessage(
        (await response.json().catch(() => ({}))).message ||
          "Planning could not be opened.",
      );
    setBusy(false);
  };
  return (
    <details className="decision-empty decision-create">
      <summary>
        <span>
          <span className="pixel-label">NEXT BLOCK</span>
          <strong>Open planning</strong>
        </span>
        <span>＋</span>
      </summary>
      <form onSubmit={submitGate}>
        <label>
          <span>Decision title</span>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            minLength="3"
            maxLength="200"
            required
          />
        </label>
        <label>
          <span>Question for contributors</span>
          <textarea
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            minLength="10"
            maxLength="2000"
            rows="3"
            required
            placeholder="Which implementation path should this mission take?"
          />
        </label>
        <div className="decision-form-grid">
          <label>
            <span>Risk</span>
            <select
              value={risk}
              onChange={(event) => setRisk(event.target.value)}
            >
              <option value="LOW">Low · reversible</option>
              <option value="HIGH">High · owner must choose</option>
            </select>
          </label>
          <label>
            <span>Proposals close</span>
            <select
              value={proposalHours}
              onChange={(event) => setProposalHours(event.target.value)}
            >
              <option value="24">24 hours</option>
              <option value="48">48 hours</option>
              <option value="72">72 hours</option>
            </select>
          </label>
          <label>
            <span>Review closes</span>
            <select
              value={reviewHours}
              onChange={(event) => setReviewHours(event.target.value)}
            >
              <option value="24">24 hours</option>
              <option value="48">48 hours</option>
              <option value="72">72 hours</option>
            </select>
          </label>
        </div>
        <p className="form-status">{message}</p>
        <button className="button primary" type="submit" disabled={busy}>
          Open planning ↗
        </button>
      </form>
    </details>
  );
}
