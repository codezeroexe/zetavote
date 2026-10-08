import type {
  AdminLoginRequest,
  ApiError,
  AuditEntry,
  AuditVerifyResponse,
  BootstrapStatus,
  ChallengeRequest,
  ChallengeResponse,
  CloseElectionResponse,
  ElectionCreateRequest,
  ElectionCreateResponse,
  ElectionDetail,
  ElectionSummary,
  HealthResponse,
  InclusionProof,
  MeResponse,
  MyElection,
  PassphraseRequest,
  PublishedResults,
  RotateSealRequest,
  SealedKeyResponse,
  TallyResponse,
  VerifyVoteResponse,
  VoteCastRequest,
  VoteCastResponse,
  VoterLoginRequest,
  AccountCreateRequest,
  AccountCreateResponse,
  BlockedAccount,
  UsernameAvailability,
  EnrolRequest,
  EnrolResponse,
} from "../types/api";

/**
 * Human-readable error message mapper for FastAPI responses.
 *
 * Keyed on the `detail` prose the server sends. That is a coupling, and it is
 * worth being honest about: reword a message on the server and the friendly
 * version silently stops applying, and the internal string reaches the user. It
 * is kept because the server's wording is stable and the alternative — a code
 * field on every one of thirty-odd error paths — is a larger change than the
 * problem. What matters is that the fallbacks below never lie, which is what the
 * single `status === 401` line used to do.
 */
function formatErrorMessage(status: number, detail?: unknown): string {
  const friendly: Record<string, string> = {
    "Election is not active": "This election is closed to new activity",
    "Voting has not opened yet": "Voting has not opened yet",
    "Voting has closed": "The voting window has closed",
    "Duplicate vote rejected": "You have already voted in this election",
    "Invalid ballot signature":
      "Signature check failed — the ballot was altered in transit",
    "Ballot id does not match its contents":
      "Ballot contents do not match its id",
    "Ballot public key does not match the enrolment":
      "That ballot key does not match the one you enrolled with",
    "Ballot timestamp outside the accepted window":
      "This ballot is too old to accept",
    "Malformed ballot timestamp": "This ballot carries an unreadable timestamp",
    "Not enrolled in this election":
      "You are not on this election's eligible list",
    "This account is blocked from this election":
      "An admin has blocked this account from this election",
    "Already enrolled in this election":
      "You have already joined this election",
    "That username is taken": "That username is already taken",
    "Unknown username": "No account with that username",
    "Election not found": "No election with that id",
    "That account is not blocked":
      "That account is not on this election's blocked list",
    "Election already exists": "An election with that id already exists",
    "At least one candidate is required":
      "This election needs at least one candidate",
    "Candidate names must be unique": "Two candidates share the same name",
    "Voter access required": "That needs a voter account, not an admin one",
    "Admin access required": "That needs an admin account",
    "Not signed in": "Your session has expired. Sign in again.",
    "Challenge is invalid or expired":
      "That sign-in attempt timed out. Try again.",
    "Signature does not verify": "That request could not be signed.",
    "Invalid credentials": "Incorrect name or passphrase.",
    "Incorrect first-run code": "That first-run code is not right.",
    "Too many attempts, wait a few minutes":
      "Too many attempts. Wait a few minutes and try again.",
    "An admin already exists":
      "An admin account already exists on this machine",
    "Name must not be blank": "Enter a name",
    "That admin name is taken": "That admin name is taken",
    "A voter challenge needs a username": "Enter a username",
  };
  if (typeof detail === "string") return friendly[detail] ?? detail;
  const first = Array.isArray(detail) ? detail[0] : undefined;
  if (typeof first === "object" && first !== null && "msg" in first) {
    return String((first as { msg: string }).msg);
  }
  // Status-only fallbacks. Each has to be true for every endpoint that can
  // produce it — the old 401 line said "Invalid master passphrase", which is a
  // lie on a voter sign-in and on an expired session.
  if (status === 401) return "That did not match. Check the details and try again.";
  if (status === 403) return "Not permitted";
  if (status === 404) return "Not found";
  if (status === 409) return "That conflicts with something already recorded";
  if (status === 429)
    return "Too many attempts. Wait a few minutes and try again.";
  if (status === 500) return "The server hit an error. Check its terminal.";
  if (status === 400) return "That request was not accepted. Check the details.";
  return `The server answered with status ${status}.`;
}

/**
 * Called when a request fails on an expired or absent session, so the shell can
 * return to sign-in instead of leaving the user on a page whose every button
 * fails the same way.
 */
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

/**
 * Generic fetch wrapper with error handling & response parsing.
 *
 * `credentials: "include"` carries the session cookie. The Vite proxy makes the
 * API same-origin in development, and in production the app is served from the
 * same host, so the cookie is never cross-site — which is what lets it be
 * SameSite=Strict and still work.
 */
async function request<T>(
  endpoint: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  let response: Response;
  try {
    response = await fetch(endpoint, {
      ...options,
      headers,
      credentials: "include",
    });
  } catch {
    throw { message: "Cannot reach the server. Is it still running?" } as ApiError;
  }

  // An unhandled server error answers with text/plain, not JSON. Calling
  // .json() unconditionally throws a SyntaxError that escapes this function
  // and surfaces as a raw parse error, so branch on the content type.
  const data: unknown = response.headers
    .get("content-type")
    ?.includes("application/json")
    ? await response.json()
    : await response.text();
  if (!response.ok) {
    const detail =
      typeof data === "object" && data !== null && "detail" in data
        ? (data as { detail: unknown }).detail
        : data;
    // A failed sign-in is a 401 by design — that is the answer to the question
    // being asked, not an expired session, and bouncing the user to the sign-in
    // page they are already on would wipe what they typed.
    const isAuthAttempt =
      endpoint.includes("/auth/login") ||
      endpoint.includes("/auth/challenge") ||
      endpoint.includes("/auth/bootstrap") ||
      endpoint.includes("/sealed-key");
    if (response.status === 401 && !isAuthAttempt) onUnauthorized?.();
    throw { message: formatErrorMessage(response.status, detail) } as ApiError;
  }
  return data as T;
}

export function toMessage(error: unknown, fallback: string): string {
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as ApiError).message);
  }
  return fallback;
}

export const api = {
  /** GET /api/health */
  async checkHealth(): Promise<HealthResponse> {
    return request<HealthResponse>("/api/health");
  },

  // ---------- auth ----------

  /** GET /api/auth/bootstrap */
  async bootstrapStatus(): Promise<BootstrapStatus> {
    return request<BootstrapStatus>("/api/auth/bootstrap");
  },

  /** POST /api/auth/bootstrap */
  async bootstrap(payload: {
    name: string;
    passphrase: string;
    code: string;
  }): Promise<{ name: string }> {
    return request<{ name: string }>("/api/auth/bootstrap", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  /** POST /api/auth/admin/login */
  async adminLogin(payload: AdminLoginRequest): Promise<{ name: string }> {
    return request<{ name: string }>("/api/auth/admin/login", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  /** POST /api/auth/challenge */
  async challenge(payload: ChallengeRequest): Promise<ChallengeResponse> {
    return request<ChallengeResponse>("/api/auth/challenge", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  /**
   * POST /api/auth/voter/login
   *
   * `sign` is injected rather than imported so this module stays free of any
   * dependency on the crypto layer: the caller signs the nonce with the account
   * key it already holds. No passphrase crosses the wire, and no election is
   * involved — an account outlives every election it votes in.
   */
  async accountLogin(
    username: string,
    sign: (challenge: string) => string,
  ): Promise<{ username: string }> {
    const { challenge } = await api.challenge({ role: "voter", username });
    const signature = await sign(challenge);
    const payload: VoterLoginRequest = { username, challenge, signature };
    return request<{ username: string }>("/api/auth/voter/login", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  /** GET /api/auth/me */
  async me(): Promise<MeResponse> {
    return request<MeResponse>("/api/auth/me");
  },

  /** POST /api/auth/logout */
  async logout(): Promise<void> {
    await request<{ status: string }>("/api/auth/logout", { method: "POST" });
  },

  /**
   * POST /api/auth/rotate-seal
   *
   * Re-encrypts the same private key under a new passphrase, so existing
   * ballots stay valid and the voter does not re-register. `sign` is injected
   * for the same reason as voterLogin: the request is signed with the key
   * already held, so a stolen session alone cannot rewrite the sealed blob.
   */
  async rotateSeal(
    username: string,
    sealedKey: RotateSealRequest["sealed_key"],
    sign: (challenge: string) => string,
  ): Promise<{ status: string }> {
    const { challenge } = await api.challenge({ role: "voter", username });
    const signature = await sign(challenge);
    return request<{ status: string }>("/api/auth/rotate-seal", {
      method: "POST",
      body: JSON.stringify({ sealed_key: sealedKey, challenge, signature }),
    });
  },

  // ---------- elections ----------

  /** POST /api/elections. Admin session required. */
  async createElection(
    payload: ElectionCreateRequest,
  ): Promise<ElectionCreateResponse> {
    return request<ElectionCreateResponse>("/api/elections", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  /** GET /api/elections. Admin session required. */
  async listElections(): Promise<{ elections: ElectionSummary[] }> {
    return request<{ elections: ElectionSummary[] }>("/api/elections");
  },

  /** GET /api/elections/{id}. Public. Counts appear only once voting closes. */
  async getElection(electionId: string): Promise<ElectionDetail> {
    return request<ElectionDetail>(
      `/api/elections/${encodeURIComponent(electionId)}`,
    );
  },

  /** GET /api/me/elections. Session required; scoped to the caller. */
  async myElections(): Promise<{ elections: MyElection[] }> {
    return request<{ elections: MyElection[] }>("/api/me/elections");
  },

  // ---------- accounts ----------

  /**
   * GET /api/accounts/available
   *
   * The slug is computed server-side so there is one implementation of the
   * rules. A collision comes back as alternatives rather than a refusal: two
   * people genuinely can share a name, which is what the four digits are for.
   */
  async checkUsername(
    name: string,
    digits: string,
  ): Promise<UsernameAvailability> {
    const query = new URLSearchParams({ name, digits });
    return request<UsernameAvailability>(
      `/api/accounts/available?${query.toString()}`,
    );
  },

  /** POST /api/accounts. Public: anyone may register. */
  async createAccount(
    payload: AccountCreateRequest,
  ): Promise<AccountCreateResponse> {
    return request<AccountCreateResponse>("/api/accounts", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  /**
   * GET /api/accounts/{username}/sealed-key
   *
   * Returns ciphertext only. Opening it needs the passphrase and happens in the
   * browser, so the server never learns it. This is how signing in works on a
   * device that does not hold the key.
   */
  async getSealedKey(username: string): Promise<SealedKeyResponse> {
    return request<SealedKeyResponse>(
      `/api/accounts/${encodeURIComponent(username)}/sealed-key`,
    );
  },

  /**
   * POST /api/elections/{id}/enrol
   *
   * Claims the roster line matching this account. The ballot key is minted and
   * sealed in the browser, and the request is signed with the *account* key: a
   * stolen session cookie alone must not be able to enrol someone, because the
   * attacker would supply a ballot key whose private half only they hold.
   */
  async enrol(
    electionId: string,
    username: string,
    payload: Omit<EnrolRequest, "challenge" | "signature">,
    sign: (challenge: string) => string,
  ): Promise<EnrolResponse> {
    const challenge = (await api.challenge({ role: "voter", username }))
      .challenge;
    return request<EnrolResponse>(
      `/api/elections/${encodeURIComponent(electionId)}/enrol`,
      {
        method: "POST",
        body: JSON.stringify({
          ...payload,
          challenge,
          signature: await sign(challenge),
        }),
      },
    );
  },

  /** GET /api/elections/{id}/blocks. Admin session required. */
  async listBlocks(electionId: string): Promise<{ blocks: BlockedAccount[] }> {
    return request<{ blocks: BlockedAccount[] }>(
      `/api/elections/${encodeURIComponent(electionId)}/blocks`,
    );
  },

  /** POST /api/elections/{id}/blocks. May name an account that does not exist yet. */
  async addBlock(
    electionId: string,
    username: string,
    reason?: string,
  ): Promise<{ username: string; created: boolean }> {
    return request<{ username: string; created: boolean }>(
      `/api/elections/${encodeURIComponent(electionId)}/blocks`,
      {
        method: "POST",
        body: JSON.stringify({ username, reason: reason || null }),
      },
    );
  },

  /** DELETE /api/elections/{id}/blocks/{username} */
  async removeBlock(
    electionId: string,
    username: string,
  ): Promise<{ username: string }> {
    return request<{ username: string }>(
      `/api/elections/${encodeURIComponent(electionId)}/blocks/${encodeURIComponent(username)}`,
      { method: "DELETE" },
    );
  },

  // ---------- voting ----------

  /** POST /api/elections/{id}/vote */
  async castVote(
    electionId: string,
    payload: VoteCastRequest,
  ): Promise<VoteCastResponse> {
    return request<VoteCastResponse>(
      `/api/elections/${encodeURIComponent(electionId)}/vote`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
    );
  },

  /** GET /api/elections/{id}/verify/{commitment} */
  async verifyVote(
    electionId: string,
    commitment: string,
  ): Promise<VerifyVoteResponse> {
    return request<VerifyVoteResponse>(
      `/api/elections/${encodeURIComponent(electionId)}/verify/${encodeURIComponent(commitment)}`,
    );
  },

  // ---------- closing and tallying ----------

  /** POST /api/elections/{id}/close */
  async closeElection(
    electionId: string,
    payload: PassphraseRequest,
  ): Promise<CloseElectionResponse> {
    return request<CloseElectionResponse>(
      `/api/elections/${encodeURIComponent(electionId)}/close`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
    );
  },

  /** POST /api/elections/{id}/tally */
  async tallyElection(
    electionId: string,
    payload: PassphraseRequest,
  ): Promise<TallyResponse> {
    return request<TallyResponse>(
      `/api/elections/${encodeURIComponent(electionId)}/tally`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
    );
  },

  /** GET /api/elections/{id}/results */
  async getResults(electionId: string): Promise<PublishedResults> {
    return request<PublishedResults>(
      `/api/elections/${encodeURIComponent(electionId)}/results`,
    );
  },

  /** GET /api/elections/{id}/results/{commitment}/proof */
  async inclusionProof(
    electionId: string,
    commitment: string,
  ): Promise<InclusionProof> {
    return request<InclusionProof>(
      `/api/elections/${encodeURIComponent(electionId)}/results/${encodeURIComponent(commitment)}/proof`,
    );
  },

  // ---------- audit ----------

  /** GET /api/audit */
  async getAudit(
    electionId?: string,
    limit = 50,
  ): Promise<{ entries: AuditEntry[] }> {
    const query = new URLSearchParams({ limit: String(limit) });
    if (electionId) query.set("election_id", electionId);
    return request<{ entries: AuditEntry[] }>(`/api/audit?${query.toString()}`);
  },

  /** GET /api/audit/verify */
  async verifyAudit(): Promise<AuditVerifyResponse> {
    return request<AuditVerifyResponse>("/api/audit/verify");
  },
};
