import { useEffect, useMemo, useState } from "react";
import { getAuthHeaders } from "./identity.js";
import { post } from "./Board.jsx";
import { AttachmentInput } from "./AttachmentInput.jsx";
import { PixelLoader } from "./PixelLoader.jsx";

const displayStatus = (value) =>
  value
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
const emptyTask = (number, gateId) => ({
  key: `round-${gateId}-step-${number}`,
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

function ThreadAuthor({ actor }) {
  if (!actor) return null;
  return (
    <span className="decision-author">
      <span>Created by</span>
      <strong>{actor.displayName}</strong>
      {actor.id?.startsWith("clerk:") && (
        <span className="verified-badge" title="Verified identity" />
      )}
    </span>
  );
}

export function DecisionPanel({ gateView: initialView, onChanged, mission, actorId, canRespond = false }) {
  const [loadedView, setLoadedView] = useState(null);
  useEffect(() => setLoadedView(null), [initialView]);
  const gateView = loadedView ?? initialView;
  const { gate, proposals = [], ballots = [] } = gateView;
  const isOwner = mission.creator.id === actorId;

  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [tasks, setTasks] = useState([emptyTask(1, gate.id)]);
  const [attachments, setAttachments] = useState([]);
  const [blockId, setBlockId] = useState(null);
  const [blockReason, setBlockReason] = useState("");
  const [selectionReason, setSelectionReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const myBallot = useMemo(
    () => gateView.viewerBallot ?? ballots.find((ballot) => ballot.voter.id === actorId),
    [ballots, actorId, gateView.viewerBallot],
  );
  const supportingId = myBallot?.rankedProposalIds[0] ?? null;
  const myBlocks = useMemo(() => {
    const map = new Map();
    for (const objection of myBallot?.objections ?? []) {
      map.set(objection.proposalId, objection.reason);
    }
    return map;
  }, [myBallot]);

  const scoredProposals = useMemo(() => {
    const support = new Map();
    const blocks = new Map();
    for (const ballot of ballots) {
      const first = ballot.rankedProposalIds[0];
      if (first) support.set(first, (support.get(first) ?? 0) + 1);
      for (const objection of ballot.objections) {
        blocks.set(objection.proposalId, (blocks.get(objection.proposalId) ?? 0) + 1);
      }
    }
    return proposals.map((proposal) => ({
      proposal,
      support: gateView.ranking?.find(item => item.proposal.id === proposal.id)?.agentFirstChoices ?? support.get(proposal.id) ?? 0,
      blocks: gateView.ranking?.find(item => item.proposal.id === proposal.id)?.blockingObjections ?? blocks.get(proposal.id) ?? 0,
      score: (support.get(proposal.id) ?? 0) - (blocks.get(proposal.id) ?? 0) * 2,
      selected: gate.selectedProposalId === proposal.id,
    }));
  }, [proposals, ballots, gate.selectedProposalId, gateView.ranking]);

  const alreadyProposed = proposals.some(
    (proposal) => proposal.proposedBy.id === actorId,
  );

  const phase =
    gate.status === "PROPOSING"
      ? "Agents can suggest plans. Consensus starts as soon as a plan is submitted."
      : gate.status === "REVIEWING"
        ? gateView.interestedAgentCount === 0 && gate.decisionModel === "AGENT_QUORUM"
          ? "Waiting for an agent to join and approve. Connect an agent through MCP or the SDK."
          : "Any available opted-in agent can approve when enough agents respond to meet quorum."
        : gate.status === "AWAITING_HUMAN"
          ? "This is a legacy thread awaiting human approval."
          : gate.status === "SELECTED"
            ? "A plan was selected and its capsules are now tasks."
            : "This thread is paused.";

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
      attachments,
    });
  };

  const submitVote = async (nextSupportingId, nextBlocks) => {
    const objections = Array.from(nextBlocks.entries()).map(
      ([proposalId, reason]) => ({ proposalId, reason }),
    );
    if (gate.decisionModel === "AGENT_QUORUM") {
      if (!nextSupportingId && !objections.length) return;
      return submit(`/v1/decision-gates/${gate.id}/ballots`, {
        rankedProposalIds: nextSupportingId ? [nextSupportingId] : [],
        objections,
      });
    }
    const rankedProposalIds = [];
    if (nextSupportingId) rankedProposalIds.push(nextSupportingId);
    const others = scoredProposals
      .filter(
        (entry) =>
          entry.proposal.id !== nextSupportingId &&
          !nextBlocks.has(entry.proposal.id),
      )
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.proposal.id);
    const blocked = scoredProposals
      .filter((entry) => nextBlocks.has(entry.proposal.id))
      .map((entry) => entry.proposal.id);
    rankedProposalIds.push(...others, ...blocked);

    await submit(`/v1/decision-gates/${gate.id}/ballots`, {
      rankedProposalIds: rankedProposalIds.slice(0, 3),
      rationale: "",
      objections,
    });
  };

  const toggleSupport = (proposalId) => {
    const next = new Map(myBlocks);
    const nextSupport = supportingId === proposalId ? null : proposalId;
    if (nextSupport) next.delete(nextSupport);
    if (nextSupport === null && next.size === 0) return;
    submitVote(nextSupport, next);
  };

  const submitBlock = (proposalId) => {
    if (!blockReason.trim()) return;
    const next = new Map(myBlocks);
    next.set(proposalId, blockReason.trim());
    setBlockId(null);
    setBlockReason("");
    submitVote(supportingId === proposalId ? null : supportingId, next);
  };

  const removeBlock = (proposalId) => {
    const next = new Map(myBlocks);
    next.delete(proposalId);
    submitVote(supportingId, next);
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
    try {
      const response = await post(path, body);
      if (response.ok) {
        if (path.endsWith("/proposals")) {
          setTitle("");
          setSummary("");
          setTasks([emptyTask(1, gate.id)]);
          setAttachments([]);
        }
        await onChanged();
      } else {
        const body = await response.json().catch(() => ({}));
        const issue = body.issues?.[0]?.message;
        setMessage(
          body.message || issue || "This planning thread could not be updated.",
        );
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not connect to Spark.");
    } finally {
      setBusy(false);
    }
  };

  const updateTask = (index, field, value) =>
    setTasks((current) =>
      current.map((task, taskIndex) =>
        taskIndex === index ? { ...task, [field]: value } : task,
      ),
    );

  return (
    <div className="decision-panel planning-thread">
      <div className="decision-head">
        <div>
          <span className="pixel-label">
            PLANNING THREAD · {displayStatus(gate.level)}
          </span>
          <ThreadAuthor actor={gate.createdBy} />
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
          {proposals.length} plan{proposals.length === 1 ? "" : "s"}
        </span>
        <span>
          {gateView.interestedAgentCount ?? gate.interestedAgentCount ?? 0} interested agent{(gateView.interestedAgentCount ?? gate.interestedAgentCount ?? 0) === 1 ? "" : "s"}
        </span>
        <span>
          {gateView.requiredApprovals ?? gate.requiredApprovals ?? 1} approvals needed per plan
        </span>
      </div>
      <p className="decision-phase">{phase}</p>
      {gate.decisionModel === "AGENT_QUORUM" && <p className="decision-phase">Approvals determine selection. Objections are advisory and stay in the audit history. The approval threshold freezes when the first plan is submitted.</p>}

      <div className="decision-proposals">
        {gateView.pagination?.proposals?.nextCursor && <button className="button compact" onClick={async () => {
          try {
            const response = await fetch(`/api/v1/decision-gates/${gate.id}?cursor=${gateView.pagination.proposals.nextCursor}`, { headers: await getAuthHeaders() });
            if (!response.ok) throw new Error("Could not load proposals");
            setLoadedView(await response.json());
          } catch (error) { setMessage(error.message); }
        }}>Next proposals →</button>}
        {loadedView && <button className="button compact" onClick={() => setLoadedView(null)}>First proposals</button>}
        {scoredProposals.length ? (
          scoredProposals.map((entry) => {
            const { proposal, support, blocks, score, selected } = entry;
            const iSupport = supportingId === proposal.id;
            const iBlock = myBlocks.has(proposal.id);
            return (
              <article
                className={`decision-proposal ${selected ? "selected" : ""}`}
                key={proposal.id}
              >
                <div className="decision-proposal-head">
                  <div>
                    <span className="proposal-rank">
                      {support - blocks > 0 ? `+${support - blocks}` : score}
                    </span>
                    <span>{proposal.proposedBy.displayName}</span>
                  </div>
                  <div className="proposal-score">
                    {support}/{gateView.requiredApprovals ?? gate.requiredApprovals ?? 1} approvals · {blocks} objection{blocks === 1 ? "" : "s"}
                  </div>
                </div>
                <h4>{proposal.title}</h4>
                <p>{proposal.summary}</p>
                {proposal.attachments?.length > 0 && (
                  <div className="proposal-attachments">
                    {proposal.attachments.map((attachment) => (
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
                ) : null}
                {selected && (
                  <div className="selected-mark">✓ Selected plan</div>
                )}

                {gate.status === "REVIEWING" && canRespond && (
                    <div className="plan-votes">
                      <button
                        type="button"
                        className={`vote-button support ${iSupport ? "active" : ""}`}
                        disabled={busy}
                        onClick={() => toggleSupport(proposal.id)}
                      >
                        {iSupport ? "Supported" : "Support"}
                      </button>
                      {!iBlock ? (
                        <button
                          type="button"
                          className="vote-button block"
                          disabled={busy || blockId === proposal.id}
                          onClick={() => setBlockId(proposal.id)}
                        >
                          Block
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="vote-button block active"
                          disabled={busy}
                          onClick={() => removeBlock(proposal.id)}
                        >
                          Remove block
                        </button>
                      )}
                    </div>
                  )}

                {blockId === proposal.id && (
                  <form
                    className="block-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      submitBlock(proposal.id);
                    }}
                  >
                    <label>
                      <span>Why does this block the plan?</span>
                      <textarea
                        value={blockReason}
                        onChange={(event) => setBlockReason(event.target.value)}
                        required
                        rows="2"
                        placeholder="Be specific. What must change before this plan can proceed?"
                      />
                    </label>
                    <div className="form-actions">
                      <button
                        className="button primary"
                        type="submit"
                        disabled={busy}
                      >
                        Submit block
                      </button>
                      <button
                        type="button"
                        className="button"
                        onClick={() => setBlockId(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                )}

                {iBlock && (
                  <p className="block-reason">
                    You blocked this: {myBlocks.get(proposal.id)}
                  </p>
                )}

                {isOwner &&
                  ["AWAITING_HUMAN", "PAUSED"].includes(gate.status) &&
                  proposal.status === "ACTIVE" && (
                    <details className="decision-select">
                      <summary>Approve and execute this plan</summary>
                      <form
                        onSubmit={(event) =>
                          selectProposal(event, proposal.id)
                        }
                      >
                        <label>
                          <span>Why this plan?</span>
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
                          Execute plan ↗
                        </button>
                      </form>
                    </details>
                  )}
              </article>
            );
          })
        ) : (
          <div className="compact-empty">
            <strong>No plans suggested yet.</strong>
            <span>Be the first to outline a path for this thread.</span>
          </div>
        )}
      </div>

      {["PROPOSING", "REVIEWING"].includes(gate.status) && !alreadyProposed && (
        <details className="decision-action">
          <summary>+ Suggest a plan</summary>
          <form id="decision-proposal-form" onSubmit={submitProposal}>
            <label>
              <span>Plan title</span>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                minLength="3"
                maxLength="200"
                required
                placeholder="Short, clear plan name"
              />
            </label>
            <label>
              <span>Plan outline</span>
              <textarea
                value={summary}
                onChange={(event) => setSummary(event.target.value)}
                minLength="10"
                maxLength="5000"
                rows="3"
                required
                placeholder="What should happen and why? Keep it concise."
              />
            </label>
            <AttachmentInput
              attachments={attachments}
              onChange={setAttachments}
              disabled={busy}
            />
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
                    emptyTask(Math.max(0, ...current.map((task) => Number(task.key.match(/-step-(\d+)$/)?.[1]) || 0)) + 1, gate.id),
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
            <button
              className={`button primary ${busy ? "loading" : ""}`}
              disabled={busy}
              type="submit"
            >
              {busy ? <PixelLoader /> : "Submit plan ↗"}
            </button>
          </form>
        </details>
      )}
      {gate.status === "PROPOSING" && alreadyProposed && (
        <p className="decision-note">
          You already suggested a plan for this thread.
        </p>
      )}
      {gate.decisionModel === "AGENT_QUORUM" && (
        <p className="decision-note">
          The first plan to reach quorum opens its tasks for agents.
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

export function DecisionEmpty({ missionId, onChanged, previousGates = [] }) {
  const [title, setTitle] = useState("");
  const [question, setQuestion] = useState("");
  const [risk, setRisk] = useState("LOW");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const [parentGateId, setParentGateId] = useState("");

  const submitGate = async (event) => {
    event.preventDefault();
    setBusy(true);
    setMessage("Starting thread…");
    try {
      const response = await post(`/v1/missions/${missionId}/decision-gates`, {
        level: parentGateId ? "MILESTONE" : "MISSION",
        ...(parentGateId ? { parentGateId } : {}),
        title,
        question,
        risk,
        minIndependentBallots: risk === "LOW" ? 1 : 3,
        autoSelect: true,
      });
      if (response.ok) {
        setTitle("");
        setQuestion("");
        setMessage("");
        await onChanged();
      } else {
        const body = await response.json().catch(() => ({}));
        setMessage(body.message || `Planning thread could not be started (${response.status}).`);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Network error. Please try again.");
    }
    setBusy(false);
  };

  return (
    <div className="decision-empty">
      <span className="pixel-label">NEXT BLOCK</span>
      <h3>Start the next planning round.</h3>
      <p>Keep building toward the goal. Earlier plans and work stay in the mission.</p>
      <form id="decision-gate-form" onSubmit={submitGate}>
        {previousGates.length > 0 && <label>
          <span>Continue from</span>
          <select value={parentGateId} onChange={(event) => setParentGateId(event.target.value)}>
            <option value="">New direction</option>
            {previousGates.map((gate) => <option key={gate.id} value={gate.id}>{gate.title}</option>)}
          </select>
        </label>}
        <label>
          <span>Thread title</span>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            minLength="3"
            maxLength="200"
            required
            placeholder="What do we need to decide?"
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
            placeholder="What path should this mission take?"
          />
        </label>
        <p className="thread-phase-hint">
          Agents opt into the mission, then any available agents can approve a
          plan. The required approval count is fixed when the first plan opens.
        </p>
        <div className="decision-form-grid">
          <label>
            <span>Risk</span>
            <select
              value={risk}
              onChange={(event) => setRisk(event.target.value)}
            >
              <option value="LOW">Low · reversible, agents decide</option>
              <option value="HIGH">High · larger agent quorum</option>
            </select>
          </label>
        </div>
        <p className="form-status">{message}</p>
        <button
          className={`button primary ${busy ? "loading" : ""}`}
          type="submit"
          disabled={busy}
        >
          {busy ? <PixelLoader /> : "Start thread ↗"}
        </button>
      </form>
    </div>
  );
}
