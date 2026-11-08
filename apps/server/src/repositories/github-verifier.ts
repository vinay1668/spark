const GITHUB_API = "https://api.github.com";
const PROOF_PATH = ".spark/mission.json" as const;

export class RepositoryVerificationError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "RepositoryVerificationError";
  }
}

export interface VerifiedPublicRepository {
  githubRepositoryId: number;
  owner: string;
  repository: string;
  repositoryUrl: string;
  defaultBranch: string;
  ownerType: "HUMAN" | "ORGANIZATION";
  proofPath: typeof PROOF_PATH;
}

export async function verifyPublicGitHubRepository(input: {
  owner: string;
  repository: string;
  missionId: string;
  registeredBy: string;
  expectedOwnerType: "HUMAN" | "ORGANIZATION";
}): Promise<VerifiedPublicRepository> {
  const repository = await githubRequest<RepositoryResponse>(
    `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repository)}`,
  );
  if (repository.private) {
    throw new RepositoryVerificationError("Spark missions require a public repository");
  }

  const ownerType = repository.owner.type === "Organization" ? "ORGANIZATION" : "HUMAN";
  if (ownerType !== input.expectedOwnerType) {
    throw new RepositoryVerificationError("The declared sponsor type does not match the GitHub owner");
  }

  const proof = await githubRequest<ContentResponse>(
    `/repos/${encodeURIComponent(repository.owner.login)}/${encodeURIComponent(repository.name)}`
      + `/contents/${PROOF_PATH}?ref=${encodeURIComponent(repository.default_branch)}`,
  );
  if (proof.type !== "file" || proof.encoding !== "base64" || typeof proof.content !== "string") {
    throw new RepositoryVerificationError(`Repository proof must be a file at ${PROOF_PATH}`);
  }

  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(proof.content.replace(/\n/g, ""), "base64").toString("utf8"));
  } catch {
    throw new RepositoryVerificationError(`Repository proof at ${PROOF_PATH} is not valid JSON`);
  }
  if (!isProof(value) || value.missionId !== input.missionId || value.registeredBy !== input.registeredBy) {
    throw new RepositoryVerificationError(
      `Repository proof must contain this missionId and the authenticated registeredBy identity`,
    );
  }

  return {
    githubRepositoryId: repository.id,
    owner: repository.owner.login,
    repository: repository.name,
    repositoryUrl: repository.html_url,
    defaultBranch: repository.default_branch,
    ownerType,
    proofPath: PROOF_PATH,
  };
}

async function githubRequest<T>(path: string): Promise<T> {
  const response = await fetch(`${GITHUB_API}${path}`, {
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": "spark-public-repository-verifier/0.1",
      "x-github-api-version": "2022-11-28",
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new RepositoryVerificationError(
      response.status === 404 ? "Public repository or proof file was not found" : "GitHub verification failed",
      response.status,
    );
  }
  return response.json() as Promise<T>;
}

interface RepositoryResponse {
  id: number;
  name: string;
  html_url: string;
  default_branch: string;
  private: boolean;
  owner: { login: string; type: "User" | "Organization" };
}

interface ContentResponse {
  type: string;
  encoding?: string;
  content?: string;
}

function isProof(value: unknown): value is { missionId: string; registeredBy: string } {
  if (!value || typeof value !== "object") return false;
  const proof = value as Record<string, unknown>;
  return typeof proof.missionId === "string" && typeof proof.registeredBy === "string";
}
