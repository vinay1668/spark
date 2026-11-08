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
  events: DomainEvent[];
};

export class PostgresPersistence {
  private saveQueue: Promise<void> = Promise.resolve();

  constructor(private readonly pool: Pool) {}

  static connect(connectionString: string): PostgresPersistence {
    return new PostgresPersistence(new Pool({ connectionString, max: 5 }));
  }

  async migrate(): Promise<void> {
    for (const migration of ["001_initial.sql", "002_board_replies.sql"]) {
      const sql = await readFile(new URL(`../../migrations/${migration}`, import.meta.url), "utf8");
      await this.pool.query(sql);
    }
  }

  async load(store: MemoryStore, client?: PoolClient): Promise<void> {
    const database = client ?? this.pool;
    const [missions, plans, tasks, claims, contributions, decisionGates, decisionProposals, decisionBallots, reviews, humanRequests, delegations, repositoryBindings, publications, boardEntries, events] =
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
    store.events.length = 0;
    for (const { data } of missions.rows) store.missions.set(data.id, data);
    for (const { data } of plans.rows) store.plans.set(data.id, data);
    for (const { data } of tasks.rows) store.tasks.set(data.id, data);
    for (const { data } of claims.rows) store.claims.set(data.id, data);
    for (const { data } of contributions.rows) store.contributions.set(data.id, data);
    for (const { data } of decisionGates.rows) store.decisionGates.set(data.id, data);
    for (const { data } of decisionProposals.rows) store.decisionProposals.set(data.id, data);
    for (const { data } of decisionBallots.rows) store.decisionBallots.set(data.id, data);
    for (const { data } of reviews.rows) store.reviews.set(data.id, data);
    for (const { data } of humanRequests.rows) store.humanRequests.set(data.id, data);
    for (const { data } of delegations.rows) store.delegations.set(data.id, data);
    for (const { data } of repositoryBindings.rows) store.repositoryBindings.set(data.id, data);
    for (const { data } of publications.rows) store.publications.set(data.id, data);
    for (const { data } of boardEntries.rows) store.boardEntries.set(data.id, data);
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
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock($1, $2)", [8317, 2026]);
      await this.load(store, client);
      const result = action();
      await this.writeSnapshot(this.snapshot(store), client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      await this.load(store);
      throw error;
    } finally {
      client.release();
    }
  }

  private async writeSnapshot(snapshot: StoreSnapshot, transactionClient?: PoolClient): Promise<void> {
    const client = transactionClient ?? await this.pool.connect();
    const ownsTransaction = !transactionClient;
    try {
      if (ownsTransaction) await client.query("BEGIN");
      for (const value of snapshot.missions) {
        await this.upsert(client, "missions", value.id, ["status"], [value.status], value);
      }
      for (const value of snapshot.plans) {
        await this.upsert(client, "plans", value.id, ["mission_id", "status"], [value.missionId, value.status], value);
      }
      for (const value of snapshot.tasks) {
        await this.upsert(client, "tasks", value.id, ["mission_id", "status"], [value.missionId, value.status], value);
      }
      for (const value of snapshot.claims) {
        await this.upsert(
          client,
          "claims",
          value.id,
          ["task_id", "status", "expires_at"],
          [value.taskId, value.status, value.expiresAt],
          value,
        );
      }
      for (const value of snapshot.contributions) {
        await this.upsert(client, "contributions", value.id, ["task_id", "status"], [value.taskId, value.status], value);
      }
      for (const value of snapshot.decisionGates) {
        await this.upsert(
          client,
          "decision_gates",
          value.id,
          ["mission_id", "status", "proposal_closes_at", "review_closes_at"],
          [value.missionId, value.status, value.proposalClosesAt, value.reviewClosesAt],
          value,
        );
      }
      for (const value of snapshot.decisionProposals) {
        await this.upsert(
          client,
          "decision_proposals",
          value.id,
          ["gate_id", "mission_id", "status", "proposer_id"],
          [value.gateId, value.missionId, value.status, value.proposedBy.id],
          value,
        );
      }
      for (const value of snapshot.decisionBallots) {
        await this.upsert(
          client,
          "decision_ballots",
          value.id,
          ["gate_id", "mission_id", "voter_id", "voter_type"],
          [value.gateId, value.missionId, value.voter.id, value.voter.type],
          value,
        );
      }
      for (const value of snapshot.reviews) {
        await client.query(
          `INSERT INTO reviews (id, contribution_id, reviewer_id, status, data)
           VALUES ($1, $2, $3, $4, $5::jsonb)
           ON CONFLICT (id) DO NOTHING`,
          [value.id, value.contributionId, value.reviewer.id, value.status, JSON.stringify(value)],
        );
      }
      for (const value of snapshot.humanRequests) {
        await this.upsert(
          client,
          "human_requests",
          value.id,
          ["mission_id", "status"],
          [value.missionId, value.status],
          value,
        );
      }
      for (const value of snapshot.delegations) {
        await this.upsert(
          client,
          "agent_delegations",
          value.id,
          ["mission_id", "status"],
          [value.missionId, value.status],
          value,
        );
      }
      for (const value of snapshot.repositoryBindings) {
        await this.upsert(
          client,
          "repository_bindings",
          value.id,
          ["mission_id", "status"],
          [value.missionId, value.status],
          value,
        );
      }
      for (const value of snapshot.publications) {
        await this.upsert(
          client,
          "publications",
          value.id,
          ["mission_id", "status", "version"],
          [value.missionId, value.status, value.version],
          value,
        );
      }
      for (const value of snapshot.boardEntries) {
        await this.upsert(
          client,
          "board_entries",
          value.id,
          ["mission_id", "task_id", "entry_type", "author_id", "created_at"],
          [value.missionId, value.taskId ?? null, value.type, value.author.id, value.createdAt],
          value,
        );
      }
      for (const event of snapshot.events) {
        await client.query(
          `INSERT INTO domain_events
             (id, sequence, mission_id, event_type, entity_type, entity_id, occurred_at, data)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
           ON CONFLICT (id) DO NOTHING`,
          [
            event.id,
            event.sequence,
            event.missionId,
            event.type,
            event.entityType,
            event.entityId,
            event.occurredAt,
            JSON.stringify(event),
          ],
        );
      }
      if (ownsTransaction) await client.query("COMMIT");
    } catch (error) {
      if (ownsTransaction) await client.query("ROLLBACK");
      throw error;
    } finally {
      if (ownsTransaction) client.release();
    }
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
    const allColumns = ["id", ...columns, "data"];
    const parameters = [id, ...values, JSON.stringify(data)];
    const placeholders = parameters
      .map((_, index) => (index === parameters.length - 1 ? `$${index + 1}::jsonb` : `$${index + 1}`))
      .join(", ");
    const updates = [...columns, "data"].map((column) => `${column} = EXCLUDED.${column}`).join(", ");
    await client.query(
      `INSERT INTO ${table} (${allColumns.join(", ")})
       VALUES (${placeholders})
       ON CONFLICT (id) DO UPDATE SET ${updates}, updated_at = now()`,
      parameters,
    );
  }
}
