import { readFileSync } from "node:fs";
import type { Actor } from "@spark/contracts";
import { agentScopes, type ApiScope, type AuthContext, type Authenticator } from "./authenticator.js";

export interface TestAgentCredential {
  key: string;
  id: string;
  displayName: string;
}

function bearerToken(header: string | undefined): string | null {
  const match = /^Bearer ([^\s]+)$/.exec(header ?? "");
  return match?.[1] ?? null;
}

function equalText(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let different = 0;
  for (let index = 0; index < left.length; index += 1) {
    different |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return different === 0;
}

/**
 * Deliberately file-backed and test-only. It must never be enabled in production.
 * Each credential resolves to a distinct authenticated agent actor.
 */
export class TestAgentsAuthenticator implements Authenticator {
  private readonly credentials: readonly TestAgentCredential[];
  private readonly scopes: ReadonlySet<ApiScope> = agentScopes;

  constructor(filePath: string) {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== 5) {
      throw new Error("Test agent credential file must contain exactly five agents");
    }
    const credentials = parsed.map((value, index) => {
      if (!value || typeof value !== "object") throw new Error(`Invalid test agent ${index + 1}`);
      const item = value as Partial<TestAgentCredential>;
      if (!item.key || !item.id || !item.displayName) {
        throw new Error(`Test agent ${index + 1} must include key, id, and displayName`);
      }
      return { key: item.key, id: item.id, displayName: item.displayName };
    });
    if (new Set(credentials.map((agent) => agent.key)).size !== credentials.length) {
      throw new Error("Test agent keys must be unique");
    }
    this.credentials = credentials;
  }

  async authenticate(header: string | undefined): Promise<AuthContext | null> {
    const token = bearerToken(header);
    if (!token) return null;
    const credential = this.credentials.find((candidate) => equalText(candidate.key, token));
    if (!credential) return null;
    const actor: Actor = { id: credential.id, type: "agent", displayName: credential.displayName };
    return { actor, scopes: this.scopes };
  }

  async close(): Promise<void> {}
}
