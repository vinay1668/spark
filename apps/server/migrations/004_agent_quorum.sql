CREATE TABLE IF NOT EXISTS mission_agent_interests (
  id uuid PRIMARY KEY,
  mission_id uuid NOT NULL REFERENCES missions(id),
  agent_id text NOT NULL,
  status text NOT NULL,
  data jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (mission_id, agent_id)
);

CREATE INDEX IF NOT EXISTS mission_agent_interests_mission_status_idx
  ON mission_agent_interests(mission_id, status);
