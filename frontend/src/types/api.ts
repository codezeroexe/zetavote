/**
 * Wire types. These map to the FastAPI models in backend/app.py.
 *
 * Note what is absent from VoteCastRequest: the choice, the passphrase, and any
 * private key. The browser encrypts the ballot to the election's public key and
 * signs it with the voter's own key, so the server only ever handles ciphertext.
 */

// ---------- health ----------

export interface HealthResponse {
  status: string;
  /** The server's own passphrase rule, so the browser validates against it. */
  min_passphrase?: string;
}

// ---------- auth ----------

export interface BootstrapStatus {
  needs_bootstrap: boolean;
  /** Only present while no admin exists. */
  code?: string;
}

export interface BootstrapRequest {
  name: string;
  passphrase: string;
  code: string;
}

export interface AdminLoginRequest {
  name: string;
  passphrase: string;
}

export interface SessionResponse {
  role: "admin" | "voter";
  /** Admin name, or account username. */
  subject?: string;
  name?: string;
  username?: string;
}

export interface MeResponse {
  signed_in: boolean;
  role?: "admin" | "voter";
  subject?: string;
}

export interface ChallengeRequest {
  role: "voter" | "admin";
  /** Required for an account challenge, so a nonce cannot be reused across accounts. */
  username?: string;
}

export interface ChallengeResponse {
  challenge: string;
  expires_in: number;
}

export interface VoterLoginRequest {
  username: string;
  challenge: string;
  signature: string;
}

// ---------- accounts ----------

export interface AccountCreateRequest {
  /** A slug of the legal name plus four digits the person picks. */
  username: string;
  name: string;
  dob: string;
  public_key: string;
  sealed_key: SealedBlob;
}

export interface AccountCreateResponse {
  username: string;
  created_at: string;
  suggestions: string[];
  /** Set when another account already uses this name and date of birth. */
  warning: string | null;
}

export interface UsernameAvailability {
  username: string;
  available: boolean;
  suggestions: string[];
}

export interface SealedBlob {
  salt: string;
  nonce: string;
  ciphertext: string;
}

export interface RotateSealRequest {
  sealed_key: SealedBlob;
  challenge: string;
  signature: string;
}

// ---------- elections ----------

export interface ElectionCreateRequest {
  id: string;
  name: string;
  description?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  master_passphrase: string;
  /** Fixed at creation and never editable. */
  candidates: string[];
  /** Who may vote, as a rule. Either may be null, meaning no bound on that side. */
  min_age?: number | null;
  max_age?: number | null;
}

export interface ElectionCreateResponse {
  id: string;
  name: string;
  description: string | null;
  starts_at: string | null;
  ends_at: string | null;
  /** X25519 public key. The browser seals ballots to this. */
  public_key: string;
  candidates: string[];
  criteria: AgeCriteria;
}

/** The eligibility rule. Published with the results so a reader can see what was
 * hashed into `criteria_hash` — which nobody could do with the old roster hash. */
export interface AgeCriteria {
  min_age: number | null;
  max_age: number | null;
}

export interface BlockedAccount {
  username: string;
  reason: string | null;
  created_at: string;
}

export interface ElectionSummary {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
  registered: number;
  ballots: number;
  turnout: number | null;
}

/** Public, count-free. */
export interface OpenElection {
  id: string;
  name: string;
  description: string | null;
  starts_at: string | null;
  ends_at: string | null;
  accepting_votes: boolean;
}

export interface ElectionDetail {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
  public_key: string;
  candidates: string[];
  accepting_votes: boolean;
  /** The age rule, so a voter can see whether they are eligible before joining. */
  criteria?: AgeCriteria;
  /** Absent while voting is open, present once it closes. */
  registered?: number;
  ballots?: number;
  turnout?: number | null;
}

export interface EnrolRequest {
  /** Minted for this election, never reused from the account. */
  ballot_public_key: string;
  sealed_ballot_key: SealedBlob;
  /** Signed with the *account* key, so a stolen session cannot enrol anyone. */
  challenge: string;
  signature: string;
}

export interface EnrolResponse {
  election_id: string;
  username: string;
}

export interface SealedKeyResponse {
  username: string;
  sealed_key: SealedBlob;
}

// ---------- the voter's own view ----------

export interface MyElection {
  id: string;
  name: string;
  description: string | null;
  starts_at: string | null;
  ends_at: string | null;
  /** Has this account joined this election? */
  registered: boolean;
  /** Does this account meet the election's age rule? Judged server-side, so the
   *  browser never has to know this account's date of birth. */
  eligible: boolean;
  /** Has a ballot from this account landed? */
  voted: boolean;
  accepting_votes: boolean;
  /** Absent while voting is open, present once it closes. */
  counts?: { registered: number; ballots: number; turnout: number | null };
}

// ---------- voting ----------

/**
 * Built entirely in the browser by services/crypto.ts:buildVote.
 *
 * `voter_id` is the account username and `voter_pubkey` is that account's ballot
 * key *for this election*. The field names are older than that split.
 */
export interface VoteCastRequest {
  voter_id: string;
  voter_pubkey: string;
  ballot_id: string;
  commitment: string;
  vote_nonce: string;
  timestamp: string;
  ephemeral_pub: string;
  nonce: string;
  ciphertext: string;
  signature: string;
}

export interface VoteReceipt {
  ballot_commitment: string;
  vote_signature: string;
  timestamp: string;
}

export interface VoteCastResponse {
  election_id: string;
  ballot_commitment: string;
  signature_valid: boolean;
  receipt: VoteReceipt;
}

export interface VerifyChecks {
  signature_valid: boolean;
  ballot_id_consistent: boolean;
  in_audit_chain: boolean;
  audit_chain_valid: boolean;
}

/** Deliberately carries no voter id: verification is public. */
export interface VerifyVoteResponse {
  valid: boolean;
  election_id: string;
  commitment: string;
  recorded_at: string;
  checks: VerifyChecks;
}

export interface PassphraseRequest {
  master_passphrase: string;
}

export interface CloseElectionResponse {
  status: string;
  election_id: string;
}

export interface TallyResponse {
  election_id: string;
  status: string;
  total_votes: number;
  rejected_ballots: number;
  choice_breakdown: Record<string, number>;
  merkle_root: string;
}

export interface PublishedResults {
  election_id: string;
  total_votes: number;
  choice_breakdown: Record<string, number>;
  merkle_root: string;
  published_at: string;
  /** The rule, and a hash of it, published so the rule cannot have been altered
   *  after the fact. */
  criteria: AgeCriteria;
  criteria_hash: string;
}

// ---------- proving a ballot was counted ----------

export interface InclusionProof {
  election_id: string;
  commitment: string;
  included: boolean;
  merkle_root?: string;
  siblings?: { hash: string; side: "left" | "right" }[];
  total_votes?: number;
  published_at?: string;
}

// ---------- audit ----------

export interface AuditEntry {
  timestamp: string;
  election_id: string;
  actor: string;
  action: string;
  detail: string;
  status: string;
  prev_hash: string;
  entry_hash: string;
}

export interface AuditVerifyResponse {
  valid: boolean;
  entries: number;
  broken_at: number | null;
  genesis: string;
}

export interface ApiError {
  message: string;
}
