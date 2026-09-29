import type {
  ApiError,
  CloseElectionResponse,
  ElectionCreateRequest,
  ElectionCreateResponse,
  HealthResponse,
  PassphraseRequest,
  TallyResponse,
  VerifyVoteResponse,
  VoteCastRequest,
  VoteCastResponse,
  VoterRegistrationRequest,
  VoterRegistrationResponse,
} from "../types/api";

/**
 * Human-readable error message mapper for FastAPI responses.
 */
function formatErrorMessage(status: number, detail?: unknown): string {
  const friendly: Record<string, string> = {
    "Election is not active": "Inactive election",
    "Duplicate vote rejected": "Duplicate vote",
    "Invalid ballot signature": "Invalid signature",
    "Voter not registered for this election": "Voter not registered",
  };
  if (typeof detail === "string") return friendly[detail] ?? detail;
  const first = Array.isArray(detail) ? detail[0] : undefined;
  if (typeof first === "object" && first !== null && "msg" in first) {
    return String((first as { msg: string }).msg);
  }
  if (status === 401) return "Invalid master passphrase";
  if (status === 404) return "Resource not found";
  if (status === 500) return "Internal server error";
  if (status === 400) return "Bad request. Please check input parameters.";
  return `HTTP error ${status}`;
}

/**
 * Generic fetch wrapper with error handling & response parsing.
 */
async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  let response: Response;
  try {
    response = await fetch(endpoint, { ...options, headers });
  } catch (error: unknown) {
    throw { message: "Backend unavailable" } as ApiError;
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
    throw { message: formatErrorMessage(response.status, detail) } as ApiError;
  }

  return data as T;
}

export function toMessage(error: unknown, fallback: string): string {
  return (error as ApiError).message || fallback;
}

/**
 * ZetaVote API Client
 * Supports actual backend endpoints
 */
export const api = {
  /**
   * GET /health or GET /api/health
   */
  async checkHealth(): Promise<HealthResponse> {
    return request<HealthResponse>("/api/health");
  },

  /**
   * POST /api/elections
   */
  async createElection(
    payload: ElectionCreateRequest
  ): Promise<ElectionCreateResponse> {
    return request<ElectionCreateResponse>("/api/elections", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  /**
   * POST /api/elections/{id}/register
   */
  async registerVoter(
    electionId: string,
    payload: VoterRegistrationRequest
  ): Promise<VoterRegistrationResponse> {
    return request<VoterRegistrationResponse>(
      `/api/elections/${encodeURIComponent(electionId)}/register`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      }
    );
  },

  /**
   * POST /api/elections/{id}/vote
   */
  async castVote(
    electionId: string,
    payload: VoteCastRequest
  ): Promise<VoteCastResponse> {
    return request<VoteCastResponse>(
      `/api/elections/${encodeURIComponent(electionId)}/vote`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      }
    );
  },

  /**
   * GET /api/elections/{id}/verify/{commitment}
   */
  async verifyVote(
    electionId: string,
    commitment: string
  ): Promise<VerifyVoteResponse> {
    return request<VerifyVoteResponse>(
      `/api/elections/${encodeURIComponent(electionId)}/verify/${encodeURIComponent(commitment)}`
    );
  },

  /**
   * POST /api/elections/{id}/close
   */
  async closeElection(
    electionId: string,
    payload: PassphraseRequest
  ): Promise<CloseElectionResponse> {
    return request<CloseElectionResponse>(
      `/api/elections/${encodeURIComponent(electionId)}/close`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      }
    );
  },

  /**
   * POST /api/elections/{id}/tally
   */
  async tallyElection(
    electionId: string,
    payload: PassphraseRequest
  ): Promise<TallyResponse> {
    return request<TallyResponse>(
      `/api/elections/${encodeURIComponent(electionId)}/tally`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      }
    );
  },
};
