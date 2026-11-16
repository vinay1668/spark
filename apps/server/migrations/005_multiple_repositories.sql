-- A long-running mission can span multiple independently owned codebases.
ALTER TABLE repository_bindings DROP CONSTRAINT IF EXISTS repository_bindings_mission_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS repository_bindings_mission_github_unique
  ON repository_bindings (mission_id, (data->>'githubRepositoryId'));
