/**
 * Client-side cryptography. Everything secret is created here and never sent:
 * the Ed25519 private keys, the passphrase that seals them, and the reveal salt
 * that keeps a commitment from being brute-forced.
 *
 * The byte-for-byte contract with backend/crypto.py is what makes ballots
 * verifiable. If canonicalJson or the scrypt parameters drift, every signature
 * silently stops verifying.
 */

import * as ed25519 from "@noble/ed25519";
import { gcm } from "@noble/ciphers/aes.js";
import { x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { scryptAsync } from "@noble/hashes/scrypt.js";
import { sha256, sha512 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

// noble's ed25519 expects its hash to be injected rather than bundled.
ed25519.hashes.sha512 = sha512;

/**
 * Must match SCRYPT_* in backend/crypto.py, or the derived keys diverge and
 * every sealed key fails to open.
 *
 * Raised from 2**14 in v3. Login fetches the sealed blob over HTTP, so an
 * attacker can take that ciphertext home and grind it offline indefinitely —
 * rate limiting does not help against that, only the cost does. At 2**14 a
 * 6-character passphrase is hours of GPU time; at 2**16 it is out of reach.
 * Voter keys unseal on every login, which is why this is the cheaper tier and
 * the election key (unsealed only at close and tally) uses 2**18 server-side.
 */
const SCRYPT = { N: 65536, r: 8, p: 1, dkLen: 32 } as const;
const SALT_BYTES = 16;
const NONCE_BYTES = 12;
const HKDF_INFO = "zetavote/ballot/v1";
const BALLOT_PREFIX = "zetavote.ballot-seal";

/** Exactly the fields backend/app.py:signing_payload hashes. */
export const SIGNED_FIELDS = [
  "election_id",
  "voter_id",
  "voter_pubkey",
  "ballot_id",
  "commitment",
  "vote_nonce",
  "timestamp",
  "ephemeral_pub",
  "nonce",
  "ciphertext",
] as const;

export type SealedBlob = { salt: string; nonce: string; ciphertext: string };

export type BallotRow = {
  election_id: string;
  voter_id: string;
  voter_pubkey: string;
  ballot_id: string;
  commitment: string;
  vote_nonce: string;
  timestamp: string;
  ephemeral_pub: string;
  nonce: string;
  ciphertext: string;
};

export type BallotPayload = BallotRow & { signature: string };

const encoder = new TextEncoder();

export function b64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function unb64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function randomBytes(count: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(count));
}

/**
 * Stable serialisation matching Python's
 * json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False).
 *
 * JSON.stringify cannot be used directly: it does not sort keys, and it escapes
 * differently. Key ordering compares by code point, which agrees with Python for
 * the ASCII field names used here.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([a], [b]) => (a < b ? -1 : a > b ? 1 : 0),
    );
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256Hex(value: string): string {
  return bytesToHex(sha256(utf8ToBytes(value)));
}

function signingBytes(row: BallotRow): Uint8Array {
  const subset = Object.fromEntries(
    SIGNED_FIELDS.map((field) => [field, row[field]]),
  );
  return utf8ToBytes(canonicalJson(subset));
}

// ---------- key generation ----------

export type Keypair = { privateKey: string; publicKey: string };

/**
 * An Ed25519 pair, used for two unrelated things: the account key, which signs
 * login and enrolment challenges, and each enrolment's ballot key, which signs
 * and opens that one election's ballots. The ballot key is minted fresh per
 * election and never reused from the account, which is what keeps one person's
 * activity in two elections unlinkable.
 */
export function generateKeys(): Keypair {
  const privateKey = ed25519.utils.randomSecretKey();
  return {
    privateKey: b64(privateKey),
    publicKey: b64(ed25519.getPublicKey(privateKey)),
  };
}

/** Signs an arbitrary string with a base64 Ed25519 key. Used for login nonces. */
export function signRaw(message: string, privateKeyB64: string): string {
  return b64(ed25519.sign(utf8ToBytes(message), unb64(privateKeyB64)));
}

export async function sealPrivateKey(
  privateKey: string,
  passphrase: string,
): Promise<SealedBlob> {
  const salt = randomBytes(SALT_BYTES);
  const kek = await scryptAsync(utf8ToBytes(passphrase), salt, SCRYPT);
  const nonce = randomBytes(NONCE_BYTES);
  return {
    salt: b64(salt),
    nonce: b64(nonce),
    ciphertext: b64(gcm(kek, nonce).encrypt(unb64(privateKey))),
  };
}

export async function openPrivateKey(
  sealed: SealedBlob,
  passphrase: string,
): Promise<string> {
  const kek = await scryptAsync(
    utf8ToBytes(passphrase),
    unb64(sealed.salt),
    SCRYPT,
  );
  return b64(gcm(kek, unb64(sealed.nonce)).decrypt(unb64(sealed.ciphertext)));
}

// ---------- ballot sealing ----------

function ballotKey(secret: Uint8Array, publicKey: Uint8Array): Uint8Array {
  return hkdf(
    sha256,
    x25519.getSharedSecret(secret, publicKey),
    undefined,
    utf8ToBytes(HKDF_INFO),
    32,
  );
}

/** Encrypt to the election's public key. The private key never leaves the admin side. */
export function sealBallot(electionPublicKey: string, plaintext: string) {
  const ephemeralPrivate = x25519.utils.randomSecretKey();
  const key = ballotKey(ephemeralPrivate, unb64(electionPublicKey));
  const nonce = randomBytes(NONCE_BYTES);
  return {
    ephemeral_pub: b64(x25519.getPublicKey(ephemeralPrivate)),
    nonce: b64(nonce),
    ciphertext: b64(gcm(key, nonce).encrypt(encoder.encode(plaintext))),
  };
}

// ---------- commitments ----------

export function computeCommitment(
  electionId: string,
  voterPublicKey: string,
  revealSalt: string,
  choice: string,
): string {
  return sha256Hex(
    canonicalJson({
      election_id: electionId,
      voter_pubkey: voterPublicKey,
      reveal_salt: revealSalt,
      choice,
    }),
  );
}

export function computeBallotId(
  electionId: string,
  voterPublicKey: string,
  voteNonce: string,
): string {
  return sha256Hex(
    canonicalJson({
      election_id: electionId,
      voter_pubkey: voterPublicKey,
      vote_nonce: voteNonce,
    }),
  );
}

/**
 * Post-close reveal. The voter supplies their salt and checks each candidate
 * locally — no server, no admin key, no network.
 */
export function revealChoice(
  electionId: string,
  voterPublicKey: string,
  revealSalt: string,
  commitment: string,
  candidates: string[],
): string | null {
  const match = candidates.find(
    (candidate) =>
      computeCommitment(electionId, voterPublicKey, revealSalt, candidate) ===
      commitment,
  );
  return match ?? null;
}

// ---------- building a vote ----------

export type BuildVoteInput = {
  electionId: string;
  electionPublicKey: string;
  /** The account username, which is what a ballot is recorded against. */
  accountId: string;
  /** The enrolment's ballot key, never the account key. */
  ballotKeys: Keypair;
  choice: string;
  revealSalt?: string;
  voteNonce?: string;
  timestamp?: string;
};

export type BuiltVote = {
  payload: BallotPayload;
  revealSalt: string;
  revealNonce: string;
};

export function buildVote(input: BuildVoteInput): BuiltVote {
  const { electionId, electionPublicKey, accountId, ballotKeys, choice } =
    input;
  const revealSalt = input.revealSalt ?? b64(randomBytes(32));
  const voteNonce = input.voteNonce ?? b64(randomBytes(16));
  const timestamp = input.timestamp ?? new Date().toISOString();

  const plaintext = canonicalJson({
    election_id: electionId,
    voter_id: accountId,
    voter_pubkey: ballotKeys.publicKey,
    choice,
    vote_nonce: voteNonce,
    timestamp,
  });
  const sealed = sealBallot(electionPublicKey, plaintext);

  const row: BallotRow = {
    election_id: electionId,
    voter_id: accountId,
    voter_pubkey: ballotKeys.publicKey,
    ballot_id: computeBallotId(electionId, ballotKeys.publicKey, voteNonce),
    commitment: computeCommitment(
      electionId,
      ballotKeys.publicKey,
      revealSalt,
      choice,
    ),
    vote_nonce: voteNonce,
    timestamp,
    ephemeral_pub: sealed.ephemeral_pub,
    nonce: sealed.nonce,
    ciphertext: sealed.ciphertext,
  };

  return {
    payload: {
      ...row,
      signature: b64(
        ed25519.sign(signingBytes(row), unb64(ballotKeys.privateKey)),
      ),
    },
    revealSalt,
    revealNonce: voteNonce,
  };
}

export function signRow(row: BallotRow, privateKey: string): string {
  return b64(ed25519.sign(signingBytes(row), unb64(privateKey)));
}

// ---------- keys, and where they are allowed to live ----------

/**
 * Nothing private is ever written to localStorage.
 *
 * Both private keys are credentials: the account key authorises sign-in and
 * enrolment, and the ballot key is the *only* thing that admits a ballot to
 * `cast_vote`, which checks a signature and no session at all. A private key in
 * localStorage would make "password every sign-in" a sentence the user reads
 * rather than a property the code has — any script on the page, and any
 * extension, would have it.
 *
 * So there are exactly two places a key can be:
 *
 *  - in memory, for this tab, once a passphrase has unlocked it. It is dropped
 *    on reload and on sign-out, which is what makes every sign-in ask again.
 *  - nowhere else.
 *
 * The sealed blob is a different matter: it is ciphertext, and the server already
 * holds the same blob. Storing it locally just saves a round trip, so it is what
 * a new device fetches from `/api/accounts/{username}/sealed-key` instead.
 */

/** The account key, unlocked by the account passphrase. Memory only. */
let sessionAccountKey: string | null = null;

export function holdAccountKey(privateKey: string): void {
  sessionAccountKey = privateKey;
}

export function accountKeyInMemory(): string | null {
  return sessionAccountKey;
}

export function forgetAccountKey(): void {
  sessionAccountKey = null;
}

/** What is kept for one enrolment. Every field here is public or ciphertext. */
export type StoredSeal = {
  electionId: string;
  username: string;
  publicKey: string;
  sealedKey: SealedBlob;
  /**
   * Filled in once a ballot is cast. Neither is a secret *from the server* — the
   * commitment is published and the salt only drives the local reveal — so
   * keeping them here is what lets the receipt, the inclusion proof and the
   * reveal be filled in instead of typed. The salt is still private in the sense
   * that matters: anyone holding it can read this person's choice.
   */
  commitment?: string;
  revealSalt?: string;
};

function ballotSealKeyFor(electionId: string, username: string): string {
  return `${BALLOT_PREFIX}.${electionId}.${username}`;
}

export function saveBallotSeal(seal: StoredSeal): void {
  const key = ballotSealKeyFor(seal.electionId, seal.username);
  try {
    // Merged rather than overwritten: enrolment writes publicKey + sealedKey,
    // and voting later writes commitment + revealSalt for the same enrolment.
    const existing = localStorage.getItem(key);
    const merged = existing
      ? { ...(JSON.parse(existing) as StoredSeal), ...seal }
      : seal;
    localStorage.setItem(key, JSON.stringify(merged));
  } catch {
    // Nothing useful to do — the server holds the same blob
  }
}

export function loadBallotSeal(
  electionId: string,
  username: string,
): StoredSeal | null {
  try {
    const raw = localStorage.getItem(ballotSealKeyFor(electionId, username));
    return raw ? (JSON.parse(raw) as StoredSeal) : null;
  } catch {
    return null;
  }
}

export function clearBallotSeal(electionId: string, username: string): void {
  try {
    localStorage.removeItem(ballotSealKeyFor(electionId, username));
  } catch {
    // nothing to do
  }
}

// ---------- Merkle inclusion ----------

/**
 * Recompute a Merkle path locally, mirroring backend/merkle.py.
 *
 * `side` is where the sibling sits, so "right" means this digest is the left
 * child. A proof that does not reproduce the published root means the ballot was
 * not counted in this tally — which the voter learns without trusting the server
 * to have said so.
 */
export function verifyInclusion(
  commitment: string,
  siblings: { hash: string; side: "left" | "right" }[],
  root: string,
): boolean {
  let digest = commitment;
  for (const { hash, side } of siblings) {
    digest =
      side === "right"
        ? sha256Hex(`${digest}|${hash}`)
        : sha256Hex(`${hash}|${digest}`);
  }
  return digest === root;
}
