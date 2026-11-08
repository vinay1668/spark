CREATE TABLE IF NOT EXISTS missions (
  id uuid PRIMARY KEY,
  status text NOT NULL,
  data jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);


CREATE TABLE IF NOT EXISTS plans (
  id uuid PRIMARY KEY,
  mission_id uuid NOT NULL REFERENCES missions(id),
  status text NOT NULL,
  data jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tasks (
  id uuid PRIMARY KEY,
  mission_id uuid NOT NULL REFERENCES missions(id),
  status text NOT NULL,
  data jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS claims (
  id uuid PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES tasks(id),
  status text NOT NULL,
  expires_at timestamptz,
  data jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE claims ADD COLUMN IF NOT EXISTS expires_at timestamptz;

CREATE TABLE IF NOT EXISTS contributions (
  id uuid PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES tasks(id),
  status text NOT NULL,
  data jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS decision_gates (
  id uuid PRIMARY KEY,
  mission_id uuid NOT NULL REFERENCES missions(id),
  status text NOT NULL,
  proposal_closes_at timestamptz NOT NULL,
  review_closes_at timestamptz NOT NULL,
  data jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS decision_proposals (
  id uuid PRIMARY KEY,
  gate_id uuid NOT NULL REFERENCES decision_gates(id),
  mission_id uuid NOT NULL REFERENCES missions(id),
  status text NOT NULL,
  proposer_id text NOT NULL,
  data jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS decision_ballots (
  id uuid PRIMARY KEY,
  gate_id uuid NOT NULL REFERENCES decision_gates(id),
  mission_id uuid NOT NULL REFERENCES missions(id),
  voter_id text NOT NULL,
  voter_type text NOT NULL,
  data jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (gate_id, voter_id)
);

CREATE TABLE IF NOT EXISTS reviews (
  id uuid PRIMARY KEY,
  contribution_id uuid NOT NULL REFERENCES contributions(id),
  reviewer_id text,
  status text NOT NULL,
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE reviews ADD COLUMN IF NOT EXISTS reviewer_id text;
UPDATE reviews SET reviewer_id = data->'reviewer'->>'id' WHERE reviewer_id IS NULL;
WITH duplicate_reviews AS (
  SELECT id, row_number() OVER (PARTITION BY contribution_id, reviewer_id ORDER BY created_at, id) AS position
  FROM reviews
  WHERE reviewer_id IS NOT NULL
)
UPDATE reviews SET reviewer_id = NULL
FROM duplicate_reviews
WHERE reviews.id = duplicate_reviews.id AND duplicate_reviews.position > 1;

CREATE TABLE IF NOT EXISTS human_requests (
  id uuid PRIMARY KEY,
  mission_id uuid NOT NULL REFERENCES missions(id),
  status text NOT NULL,
  data jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_delegations (
  id uuid PRIMARY KEY,
  mission_id uuid NOT NULL REFERENCES missions(id),
  status text NOT NULL,
  data jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS repository_bindings (
  id uuid PRIMARY KEY,
  mission_id uuid NOT NULL REFERENCES missions(id),
  status text NOT NULL,
  data jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (mission_id)
);

CREATE TABLE IF NOT EXISTS publications (
  id uuid PRIMARY KEY,
  mission_id uuid NOT NULL REFERENCES missions(id),
  status text NOT NULL,
  version text NOT NULL,
  data jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (mission_id, version)
);

CREATE TABLE IF NOT EXISTS domain_events (
  id uuid PRIMARY KEY,
  sequence bigint NOT NULL UNIQUE,
  mission_id uuid NOT NULL REFERENCES missions(id),
  event_type text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL,
  data jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS tasks_mission_status_idx ON tasks(mission_id, status);
CREATE INDEX IF NOT EXISTS claims_task_status_idx ON claims(task_id, status);
CREATE INDEX IF NOT EXISTS claims_active_expiry_idx ON claims(expires_at) WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS contributions_task_status_idx ON contributions(task_id, status);
CREATE INDEX IF NOT EXISTS decision_gates_mission_status_idx ON decision_gates(mission_id, status);
CREATE INDEX IF NOT EXISTS decision_gates_deadline_idx ON decision_gates(status, proposal_closes_at, review_closes_at);
CREATE INDEX IF NOT EXISTS decision_proposals_gate_status_idx ON decision_proposals(gate_id, status);
CREATE INDEX IF NOT EXISTS decision_ballots_gate_type_idx ON decision_ballots(gate_id, voter_type);
CREATE UNIQUE INDEX IF NOT EXISTS reviews_contribution_reviewer_idx
  ON reviews(contribution_id, reviewer_id) WHERE reviewer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS events_mission_sequence_idx ON domain_events(mission_id, sequence);
CREATE INDEX IF NOT EXISTS human_requests_mission_status_idx ON human_requests(mission_id, status);
CREATE INDEX IF NOT EXISTS agent_delegations_mission_status_idx ON agent_delegations(mission_id, status);
CREATE INDEX IF NOT EXISTS repository_bindings_mission_status_idx ON repository_bindings(mission_id, status);
CREATE INDEX IF NOT EXISTS publications_status_created_idx ON publications(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS board_entries (
  id uuid PRIMARY KEY,
  mission_id uuid NOT NULL REFERENCES missions(id),
  task_id uuid REFERENCES tasks(id),
  entry_type text NOT NULL,
  author_id text NOT NULL,
  created_at timestamptz NOT NULL,
  data jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS board_entries_mission_created_idx
  ON board_entries(mission_id, created_at DESC);
CREATE INDEX IF NOT EXISTS board_entries_task_created_idx
  ON board_entries(task_id, created_at DESC) WHERE task_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS board_entries_type_created_idx
  ON board_entries(entry_type, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS board_entries_idempotency_idx
  ON board_entries(mission_id, author_id, ((data->>'idempotencyKey')))
  WHERE data ? 'idempotencyKey';

CREATE TABLE IF NOT EXISTS identities (
  id text PRIMARY KEY,
  actor_type text NOT NULL CHECK (actor_type IN ('human', 'agent', 'system')),
  display_name text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REVOKED')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS api_keys (
  id uuid PRIMARY KEY,
  identity_id text NOT NULL REFERENCES identities(id),
  secret_hash char(64) NOT NULL,
  scopes text[] NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REVOKED')),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);

CREATE INDEX IF NOT EXISTS api_keys_identity_status_idx ON api_keys(identity_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS identities_display_name_unique
  ON identities (lower(display_name));
