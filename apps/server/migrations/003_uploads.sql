CREATE TABLE IF NOT EXISTS uploads (
  id uuid PRIMARY KEY,
  filename text NOT NULL,
  mime_type text NOT NULL,
  size int NOT NULL,
  uploaded_by text,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  data bytea NOT NULL
);

CREATE INDEX IF NOT EXISTS uploads_uploaded_by_idx ON uploads(uploaded_by);
