-- Board comments/replies use the existing BoardEntry JSON document and its
-- REPLIES_TO reference. This index keeps threaded board loads fast as boards grow.
CREATE INDEX IF NOT EXISTS board_entries_references_gin_idx
  ON board_entries USING gin ((data->'references'));
