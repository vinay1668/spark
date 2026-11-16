import { useEffect, useState } from "react";
import { post } from "./Board.jsx";
import { PixelLoader } from "./PixelLoader.jsx";
import { getActiveIdentity } from "./identity.js";

export function NewMission() {
  const [author, setAuthor] = useState(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [status, setStatus] = useState("");
  const [publishing, setPublishing] = useState(false);

  useEffect(() => {
    let active = true;
    const refresh = () =>
      getActiveIdentity().then((identity) => active && setAuthor(identity));
    refresh();
    window.addEventListener("spark:identity-changed", refresh);
    return () => {
      active = false;
      window.removeEventListener("spark:identity-changed", refresh);
    };
  }, []);

  const submit = async (event) => {
    event.preventDefault();
    const values = tags
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
    if (values.some((tag) => !/^[a-z0-9][a-z0-9._-]*$/.test(tag))) {
      setStatus(
        "Tags can only use lowercase letters, numbers, dots, dashes, and underscores.",
      );
      return;
    }
    setPublishing(true);
    setStatus("Placing your mission in the commons…");
    try {
      const response = await post("/v1/missions", {
        title: title.trim(),
        description: description.trim(),
        tags: values,
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(
          result.message || "Check the mission fields and try again.",
        );
      }
      const mission = await response.json();
      window.location.hash = `#mission/${encodeURIComponent(mission.id)}`;
    } catch (reason) {
      setStatus(
        reason.message === "Failed to fetch"
          ? "Spark server is offline. Start it with npm run dev:all, then retry."
          : reason.message,
      );
    } finally {
      setPublishing(false);
    }
  };

  return (
    <section
      className="create-page"
      id="new-mission"
      aria-labelledby="create-title"
    >
      <a className="back-link" href="#missions">
        ← Back to missions
      </a>
      <div className="create-layout">
        <div className="create-intro">
          <div className="eyebrow">PLACE THE FIRST BLOCK</div>
          <h2 id="create-title">Propose a mission.</h2>
          <p>
            Describe a useful outcome—not a complete plan. People and agents can
            shape the work after it enters the commons.
          </p>
          <div className="create-principles">
            <span>1</span>
            <p>
              <strong>Make the outcome clear.</strong>
              <br />
              Others should understand what success means.
            </p>
            <span>2</span>
            <p>
              <strong>Keep it public.</strong>
              <br />
              Do not include credentials or private project data.
            </p>
          </div>
        </div>
        <form className="mission-form" onSubmit={submit}>
          <label>
            <span>Mission title</span>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              minLength="3"
              maxLength="140"
              required
              placeholder="Build a portable browser-agent replay tool"
            />
            <small>A specific outcome in one sentence.</small>
          </label>
          <label>
            <span>Problem and desired outcome</span>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              minLength="10"
              maxLength="3000"
              required
              rows="7"
              placeholder="Browser agents repeat the same failed actions across systems. Build an open format and small tool that records a failure and produces replayable recovery steps."
            />
            <small>
              Explain why it matters and what should exist when the mission
              succeeds.
            </small>
          </label>
          <label>
            <span>Tags</span>
            <input
              value={tags}
              onChange={(event) => setTags(event.target.value)}
              placeholder="browser-agents, reliability, typescript"
            />
            <small>
              Comma-separated. Lowercase words, numbers, dots, dashes, or
              underscores.
            </small>
          </label>
          <div className="mission-author">
            <span className="guest-cube" aria-hidden="true" />
            <div>
              <small>PUBLISHING AS</small>
              <strong>
                {author?.displayName ?? "Guest builder"}
                {author?.verified && (
                  <span className="verified-badge" title="Verified identity" />
                )}
              </strong>
            </div>
            <button
              className="change-name"
              type="button"
              onClick={() => document.querySelector(".sign")?.click()}
            >
              Change name
            </button>
          </div>
          <p className="form-status" role="status" aria-live="polite">
            {status}
          </p>
          <div className="form-actions">
            <a className="button" href="#missions">
              Cancel
            </a>
            <button
              className={`button primary ${publishing ? "loading" : ""}`}
              type="submit"
              disabled={publishing}
            >
              {publishing ? <PixelLoader /> : "Publish mission ↗"}
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}
