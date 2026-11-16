import { readFile } from "node:fs/promises";
import { Pool, type PoolClient } from "pg";
import { MemoryStore } from "../domain/store.js";
import type {
  AgentDelegation,
  BoardEntry,
  Claim,
  Contribution,
  DecisionBallot,
  DecisionGate,
  DecisionProposal,
  DomainEvent,
  HumanRequest,
  Mission,
  MissionAgentInterest,
  PlanProposal,
  Publication,
  Review,
  RepositoryBinding,
  Task,
} from "@spark/contracts";

type DataRow<T> = { data: T };
type StoreSnapshot = {
  missions: Mission[];
  plans: PlanProposal[];
  tasks: Task[];
  claims: Claim[];
  contributions: Contribution[];
  decisionGates: DecisionGate[];
  decisionProposals: DecisionProposal[];
  decisionBallots: DecisionBallot[];
  reviews: Review[];
  humanRequests: HumanRequest[];
  delegations: AgentDelegation[];
  repositoryBindings: RepositoryBinding[];
  publications: Publication[];
  boardEntries: BoardEntry[];
  agentInterests: MissionAgentInterest[];
  events: DomainEvent[];
};

export class PostgresPersistence {
  private saveQueue: Promise<void> = Promise.resolve();
  private atomicLock: Promise<void> = Promise.resolve();

  constructor(private readonly pool: Pool) {}

  get db(): Pool {
    return this.pool;
  }

  private async withMemoryLock<T>(action: () => Promise<T>): Promise<T> {
    let release = () => {};
    const acquire = new Promise<void>((resolve) => {
      release = () => resolve();
    });
    const previous = this.atomicLock;
    this.atomicLock = previous.then(() => acquire);
    await previous;
    try {
      return await action();
    } finally {
      release();
    }
  }

  static connect(connectionString: string): PostgresPersistence {
    return new PostgresPersistence(new Pool({ connectionString, max: 5 }));
  }

  async migrate(): Promise<void> {
    for (const migration of ["001_initial.sql", "002_board_replies.sql", "003_uploads.sql", "004_agent_quorum.sql", "005_multiple_repositories.sql"]) {
      const sql = await readFile(new URL(`../../migrations/${migration}`, import.meta.url), "utf8");
      await this.pool.query(sql);
    }
  }

  async load(store: MemoryStore, client?: PoolClient): Promise<void> {
    const database = client ?? this.pool;
    const [missions, plans, tasks, claims, contributions, decisionGates, decisionProposals, decisionBallots, reviews, humanRequests, delegations, repositoryBindings, publications, boardEntries, agentInterests, events] =
      await Promise.all([
        database.query<DataRow<Mission>>("SELECT data FROM missions"),
        database.query<DataRow<PlanProposal>>("SELECT data FROM plans"),
        database.query<DataRow<Task>>("SELECT data FROM tasks"),
        database.query<DataRow<Claim>>("SELECT data FROM claims"),
        database.query<DataRow<Contribution>>("SELECT data FROM contributions"),
        database.query<DataRow<DecisionGate>>("SELECT data FROM decision_gates"),
        database.query<DataRow<DecisionProposal>>("SELECT data FROM decision_proposals"),
        database.query<DataRow<DecisionBallot>>("SELECT data FROM decision_ballots"),
        database.query<DataRow<Review>>("SELECT data FROM reviews"),
        database.query<DataRow<HumanRequest>>("SELECT data FROM human_requests"),
        database.query<DataRow<AgentDelegation>>("SELECT data FROM agent_delegations"),
        database.query<DataRow<RepositoryBinding>>("SELECT data FROM repository_bindings"),
        database.query<DataRow<Publication>>("SELECT data FROM publications"),
        database.query<DataRow<BoardEntry>>("SELECT data FROM board_entries"),
        database.query<DataRow<MissionAgentInterest>>("SELECT data FROM mission_agent_interests"),
        database.query<DataRow<DomainEvent>>("SELECT data FROM domain_events ORDER BY sequence"),
      ]);

    store.missions.clear();
    store.plans.clear();
    store.tasks.clear();
    store.claims.clear();
    store.contributions.clear();
    store.decisionGates.clear();
    store.decisionProposals.clear();
    store.decisionBallots.clear();
    store.reviews.clear();
    store.humanRequests.clear();
    store.delegations.clear();
    store.repositoryBindings.clear();
    store.publications.clear();
    store.boardEntries.clear();
    store.agentInterests.clear();
    store.events.length = 0;
    for (const { data } of missions.rows) store.missions.set(data.id, data);
    for (const { data } of plans.rows) store.plans.set(data.id, data);
    for (const { data } of tasks.rows) store.tasks.set(data.id, data);
    for (const { data } of claims.rows) store.claims.set(data.id, data);
    for (const { data } of contributions.rows) store.contributions.set(data.id, data);
    for (const { data } of decisionProposals.rows) store.decisionProposals.set(data.id, data);
    for (const { data } of decisionBallots.rows) store.decisionBallots.set(data.id, data);
    for (const { data } of reviews.rows) store.reviews.set(data.id, data);
    for (const { data } of humanRequests.rows) store.humanRequests.set(data.id, data);
    for (const { data } of delegations.rows) store.delegations.set(data.id, data);
    for (const { data } of repositoryBindings.rows) store.repositoryBindings.set(data.id, data);
    for (const { data } of publications.rows) store.publications.set(data.id, data);
    for (const { data } of boardEntries.rows) store.boardEntries.set(data.id, data);
    for (const { data } of agentInterests.rows) store.agentInterests.set(data.id, data);
    for (const { data } of decisionGates.rows) {
      const interestedAgentCount = [...store.agentInterests.values()].filter(
        (interest) => interest.missionId === data.missionId && interest.status === "INTERESTED",
      ).length;
      store.decisionGates.set(data.id, {
        ...data,
        decisionModel: data.decisionModel ?? "AGENT_QUORUM",
        interestedAgentCount: data.interestedAgentCount ?? interestedAgentCount,
        requiredApprovals: data.requiredApprovals ?? (interestedAgentCount <= 1
          ? 1
          : Math.min(5, Math.max(2, Math.ceil(Math.sqrt(interestedAgentCount))))),
      });
    }
    store.events.push(...events.rows.map(({ data }) => data));
  }

  save(store: MemoryStore): Promise<void> {
    const snapshot = this.snapshot(store);

    this.saveQueue = this.saveQueue.then(() => this.writeSnapshot(snapshot));
    return this.saveQueue;
  }

  async close(): Promise<void> {
    await this.saveQueue;
    await this.pool.end();
  }

  async runAtomically<T>(store: MemoryStore, action: () => T): Promise<T> {
    // Single-process deployments can use an in-memory lock and skip both the
    // reload and the DB advisory lock. This removes two round-trips per mutation.
    // Multi-process deployments must keep the DB advisory lock.
    const useMemoryLock = process.env.SPARK_PERSISTENCE_MEMORY_LOCK === "true";
    if (useMemoryLock) {
      return this.withMemoryLock(async () => {
        const client = await this.pool.connect();
        try {
          await client.query("BEGIN");
          if (process.env.SPARK_PERSISTENCE_RELOAD_ON_MUTATION === "true") {
            await this.load(store, client);
          }
          const before = this.snapshot(store);
          const result = action();
          const after = this.snapshot(store);
          await this.writeSnapshotDiff(before, after, client);
          await client.query("COMMIT");
          return result;
        } catch (error) {
          await client.query("ROLLBACK");
          if (process.env.SPARK_PERSISTENCE_RELOAD_ON_MUTATION === "true") {
            await this.load(store);
          }
          throw error;
        } finally {
          client.release();
        }
      });
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock($1, $2)", [8317, 2026]);
      if (process.env.SPARK_PERSISTENCE_RELOAD_ON_MUTATION === "true") {
        await this.load(store, client);
      }
      const before = this.snapshot(store);
      const result = action();
      const after = this.snapshot(store);
      await this.writeSnapshotDiff(before, after, client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      if (process.env.SPARK_PERSISTENCE_RELOAD_ON_MUTATION === "true") {
        await this.load(store);
      }
      throw error;
    } finally {
      client.release();
    }
  }

  private async writeSnapshot(snapshot: StoreSnapshot, transactionClient?: PoolClient): Promise<void> {
    await this.writeSnapshotDiff(this.emptySnapshot(), snapshot, transactionClient);
  }

  private emptySnapshot(): StoreSnapshot {
    return {
      missions: [],
      plans: [],
      tasks: [],
      claims: [],
      contributions: [],
      decisionGates: [],
      decisionProposals: [],
      decisionBallots: [],
      reviews: [],
      humanRequests: [],
      delegations: [],
      repositoryBindings: [],
      publications: [],
      boardEntries: [],
      agentInterests: [],
      events: [],
    };
  }

  private async writeSnapshotDiff(
    before: StoreSnapshot,
    after: StoreSnapshot,
    transactionClient?: PoolClient,
  ): Promise<void> {
    const client = transactionClient ?? await this.pool.connect();
    const ownsTransaction = !transactionClient;
    try {
      const statements: string[] = ownsTransaction ? ["BEGIN"] : [];

      const byId = <T extends { id: string }>(values: T[]) => new Map(values.map((v) => [v.id, v]));

      const diff = <T extends { id: string }>(prev: T[], next: T[]): { upsert: T[]; remove: string[] } => {
        const prevById = byId(prev);
        const nextById = byId(next);
        const upsert: T[] = [];
        for (const [id, value] of nextById) {
          const old = prevById.get(id);
          if (!old || JSON.stringify(old) !== JSON.stringify(value)) upsert.push(value);
        }
        const remove: string[] = [];
        for (const id of prevById.keys()) {
          if (!nextById.has(id)) remove.push(id);
        }
        return { upsert, remove };
      };

      const pushUpserts = <T extends { id: string }>(
        table: string,
        prev: T[],
        next: T[],
        columns: string[],
        values: (value: T) => Array<string | null>,
        data: (value: T) => unknown = (v) => v,
      ) => {
        const { upsert, remove } = diff(prev, next);
        if (remove.length) {
          statements.push(`DELETE FROM ${table} WHERE id IN (${remove.map((id) => this.sqlLiteral(id)).join(", ")});`);
        }
        if (upsert.length) {
          const allColumns = ["id", ...columns, "data"];
          const valueRows = upsert.map((value) => {
            const row = [value.id, ...values(value), data(value)];
            return `(${row.map((v) => this.sqlLiteral(v)).join(", ")})`;
          });
          const updates = [...columns, "data"].map((column) => `${column} = EXCLUDED.${column}`).join(", ");
          statements.push(
            `INSERT INTO ${table} (${allColumns.join(", ")}) VALUES ${valueRows.join(", ")} ON CONFLICT (id) DO UPDATE SET ${updates}, updated_at = now();`,
          );
        }
      };

      pushUpserts("missions", before.missions, after.missions, ["status"], (v) => [v.status]);
      pushUpserts("plans", before.plans, after.plans, ["mission_id", "status"], (v) => [v.missionId, v.status]);
      pushUpserts("tasks", before.tasks, after.tasks, ["mission_id", "status"], (v) => [v.missionId, v.status]);
      pushUpserts("claims", before.claims, after.claims, ["task_id", "status", "expires_at"], (v) => [
        v.taskId,
        v.status,
        v.expiresAt,
      ]);
      pushUpserts("contributions", before.contributions, after.contributions, ["task_id", "status"], (v) => [
        v.taskId,
        v.status,
      ]);
      pushUpserts(
        "decision_gates",
        before.decisionGates,
        after.decisionGates,
        ["mission_id", "status", "proposal_closes_at", "review_closes_at"],
        (v) => [v.missionId, v.status, v.proposalClosesAt, v.reviewClosesAt],
      );
      pushUpserts(
        "decision_proposals",
        before.decisionProposals,
        after.decisionProposals,
        ["gate_id", "mission_id", "status", "proposer_id"],
        (v) => [v.gateId, v.missionId, v.status, v.proposedBy.id],
      );
      pushUpserts(
        "decision_ballots",
        before.decisionBallots,
        after.decisionBallots,
        ["gate_id", "mission_id", "voter_id", "voter_type"],
        (v) => [v.gateId, v.missionId, v.voter.id, v.voter.type],
      );

      const reviewDiff = diff(before.reviews, after.reviews);
      for (const value of reviewDiff.upsert) {
        statements.push(
          `INSERT INTO reviews (id, contribution_id, reviewer_id, status, data) VALUES (${[
            value.id,
            value.contributionId,
            value.reviewer.id,
            value.status,
            value,
          ].map((v) => this.sqlLiteral(v)).join(", ")}) ON CONFLICT (id) DO NOTHING;`,
        );
      }
      if (reviewDiff.remove.length) {
        statements.push(
          `DELETE FROM reviews WHERE id IN (${reviewDiff.remove.map((id) => this.sqlLiteral(id)).join(", ")});`,
        );
      }

      pushUpserts("human_requests", before.humanRequests, after.humanRequests, ["mission_id", "status"], (v) => [
        v.missionId,
        v.status,
      ]);
      pushUpserts("agent_delegations", before.delegations, after.delegations, ["mission_id", "status"], (v) => [
        v.missionId,
        v.status,
      ]);
      pushUpserts(
        "repository_bindings",
        before.repositoryBindings,
        after.repositoryBindings,
        ["mission_id", "status"],
        (v) => [v.missionId, v.status],
      );
      pushUpserts(
        "publications",
        before.publications,
        after.publications,
        ["mission_id", "status", "version"],
        (v) => [v.missionId, v.status, v.version],
      );
      pushUpserts(
        "board_entries",
        before.boardEntries,
        after.boardEntries,
        ["mission_id", "task_id", "entry_type", "author_id", "created_at"],
        (v) => [v.missionId, v.taskId ?? null, v.type, v.author.id, v.createdAt],
      );
      pushUpserts(
        "mission_agent_interests",
        before.agentInterests,
        after.agentInterests,
        ["mission_id", "agent_id", "status"],
        (v) => [v.missionId, v.agent.id, v.status],
      );

      // Events are append-only; only insert new ones.
      const newEvents = after.events.slice(before.events.length);
      for (const event of newEvents) {
        statements.push(
          `INSERT INTO domain_events (id, sequence, mission_id, event_type, entity_type, entity_id, occurred_at, data) VALUES (${[
            event.id,
            event.sequence,
            event.missionId,
            event.type,
            event.entityType,
            event.entityId,
            event.occurredAt,
            event,
          ].map((v) => this.sqlLiteral(v)).join(", ")}) ON CONFLICT (id) DO NOTHING;`,
        );
      }

      if (ownsTransaction) statements.push("COMMIT");
      if (statements.length > (ownsTransaction ? 2 : 0)) {
        await client.query(statements.join("\n"));
      }
    } catch (error) {
      if (ownsTransaction) {
        try { await client.query("ROLLBACK"); } catch {}
      }
      throw error;
    } finally {
      if (ownsTransaction) client.release();
    }
  }

  private sqlLiteral(value: unknown): string {
    if (value === null || value === undefined) return "NULL";
    if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
    if (typeof value === "number") return String(value);
    if (typeof value === "string") {
      // Reject strings that look like they could break out of a literal.
      if (value.includes("\0")) throw new Error("Null byte in SQL literal");
      return "'" + value.replace(/'/g, "''").replace(/\\/g, "\\\\") + "'";
    }
    return this.sqlLiteral(JSON.stringify(value)) + "::jsonb";
  }

  private snapshot(store: MemoryStore): StoreSnapshot {
    return structuredClone({
      missions: [...store.missions.values()],
      plans: [...store.plans.values()],
      tasks: [...store.tasks.values()],
      claims: [...store.claims.values()],
      contributions: [...store.contributions.values()],
      decisionGates: [...store.decisionGates.values()],
      decisionProposals: [...store.decisionProposals.values()],
      decisionBallots: [...store.decisionBallots.values()],
      reviews: [...store.reviews.values()],
      humanRequests: [...store.humanRequests.values()],
      delegations: [...store.delegations.values()],
      repositoryBindings: [...store.repositoryBindings.values()],
      publications: [...store.publications.values()],
      boardEntries: [...store.boardEntries.values()],
      agentInterests: [...store.agentInterests.values()],
      events: store.events,
    });
  }

  private async upsert(
    client: PoolClient,
    table: string,
    id: string,
    columns: string[],
    values: Array<string | null>,
    data: unknown,
  ): Promise<void> {
    await this.upsertMany(client, table, columns, [{ id, values, data }]);
  }

  private async upsertMany(
    client: PoolClient,
    table: string,
    columns: string[],
    rows: { id: string; values: Array<string | null>; data: unknown }[],
  ): Promise<void> {
    if (rows.length === 0) return;
    const allColumns = ["id", ...columns, "data"];
    const parameters: (string | null)[] = [];
    const valueClauses: string[] = [];
    for (const row of rows) {
      const base = parameters.length;
      const rowPlaceholders: string[] = [];
      parameters.push(row.id);
      rowPlaceholders.push(`$${base + 1}`);
      for (let i = 0; i < row.values.length; i++) {
        parameters.push(row.values[i] ?? null);
        rowPlaceholders.push(`$${base + 2 + i}`);
      }
      parameters.push(JSON.stringify(row.data));
      rowPlaceholders.push(`$${base + 2 + row.values.length}::jsonb`);
      valueClauses.push(`(${rowPlaceholders.join(", ")})`);
    }
    const updates = [...columns, "data"].map((column) => `${column} = EXCLUDED.${column}`).join(", ");
    await client.query(
      `INSERT INTO ${table} (${allColumns.join(", ")})
       VALUES ${valueClauses.join(", ")}
       ON CONFLICT (id) DO UPDATE SET ${updates}, updated_at = now()`,
      parameters,
    );
  }
}
