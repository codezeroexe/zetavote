/**
 * ZetaVote API Type Definitions
 * Strictly maps to backend FastAPI models (backend/app.py)
 */

export interface HealthResponse {
  status: string;
}

export interface ElectionCreateRequest {
  id: string;
  name: string;
  description?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  master_passphrase?: string | null;
}

export interface ElectionCreateResponse {
  id: string;
  name: string;
  description: string | null;
  starts_at: string | null;
  ends_at: string | null;
}

export interface VoterRegistrationRequest {
  voter_id: string;
  passphrase: string;
}

export interface RegistrationReceipt {
  voter_id_hash: string;
  election_id: string;
  timestamp: string;
  registration_commitment: string;
}

export interface VoterRegistrationResponse {
  election_id: string;
  voter_id: string;
  public_key: string;
  key_path: string;
  receipt: RegistrationReceipt;
}

export interface VoteCastRequest {
  voter_id: string;
  choice: string;
  vote_nonce: string;
  passphrase: string;
}

export interface VoteReceipt {
  ballot_commitment: string;
  vote_signature: string;
  timestamp: string;
}

export interface VoteCastResponse {
  election_id: string;
  voter_id: string;
  ballot_commitment: string;
  signature_valid: boolean;
  receipt: VoteReceipt;
}

export interface VerifyVoteResponse {
  valid: boolean;
  election_id: string;
  voter_id: string;
  timestamp: string;
  commitment: string;
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
  choice_breakdown: Record<string, number>;
  merkle_root: string;
}

export interface ApiError {
  message: string;
}
