import React, { useState } from "react";
import { api } from "../../services/api";
import { useSession } from "../../auth/SessionContext";
import { useSubmit } from "../../hooks/useSubmit";
import {
  accountKeyInMemory,
  generateKeys,
  saveBallotSeal,
  sealPrivateKey,
  signRaw,
} from "../../services/crypto";
import { Card } from "../../components/common/Card";
import { CardStock } from "../../components/common/CardStock";
import { Button } from "../../components/common/Button";
import { Alert } from "../../components/common/Alert";
import { Field } from "../../components/common/Field";
import { downloadJson } from "../../services/download";

/** Mirrors the server's own floor; not enforced here. */
const MIN_BALLOT_PASSPHRASE = 8;

/**
 * Claim a place on one election's eligible list.
 *
 * This mints a *ballot* key, fresh for this election and never taken from the
 * account. That is the whole reason an account is worth having: one key signing
 * every election would put the same value in every audit log, and anyone holding
 * two of them could link one person's activity across elections that have
 * nothing else in common.
 *
 * The key is sealed under a passphrase chosen here and the request is signed
 * with the account key, so a stolen session cookie cannot enrol anyone — the
 * attacker would be supplying a ballot key whose private half only they hold.
 */
export const Enrol: React.FC<{
  electionId: string;
  electionName?: string;
  onDone: () => void | Promise<void>;
}> = ({ electionId, electionName, onDone }) => {
  const { subject } = useSession();
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [missing, setMissing] = useState(false);

  const { loading, result, error, run } = useSubmit<{ username: string }>();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    const username = subject ?? "";

    await run(async () => {
      // Unlocked by the passphrase at sign-in and held in memory, so a reload
      // since then is the only way to be here without it. Nothing is lost — the
      // fix is to sign in again, not to register again.
      const accountKey = accountKeyInMemory();
      if (!accountKey) {
        setMissing(true);
        throw new Error(
          "Your account key is not unlocked in this tab. Sign in again, then come back.",
        );
      }

      const keys = generateKeys();
      const sealedKey = await sealPrivateKey(keys.privateKey, passphrase);
      const response = await api.enrol(
        electionId,
        username,
        {
          ballot_public_key: keys.publicKey,
          sealed_ballot_key: sealedKey,
        },
        (challenge) => signRaw(challenge, accountKey),
      );

      // Only the ciphertext and the public key are kept. Casting the ballot
      // asks for this passphrase again rather than finding a cached private key.
      saveBallotSeal({
        electionId,
        username,
        publicKey: keys.publicKey,
        sealedKey,
      });
      return response;
    });
  };

  const mismatch = confirm !== "" && confirm !== passphrase;
  const ready =
    passphrase.length >= MIN_BALLOT_PASSPHRASE && confirm === passphrase;

  if (result) {
    return (
      <CardStock title="Enrolment receipt" id={electionId} sealed sealedSub="KEPT BY YOU">
        <div className="zv-card-print">
          {electionName
            ? `You are on ${electionName}'s eligible list. That is one ballot, in this election only.`
            : "You are on this election's eligible list. That is one ballot, in this election only."}
        </div>
        <div className="zv-form-actions">
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              downloadJson(
                {
                  election_id: electionId,
                  election_name: electionName ?? null,
                  username: subject,
                },
                `enrolment_${electionId}.json`,
              )
            }
          >
            Download receipt
          </Button>
          <Button variant="primary" size="sm" onClick={() => void onDone()}>
            Back to my ballots
          </Button>
        </div>
      </CardStock>
    );
  }

  return (
    <Card>
      <form className="zv-form" onSubmit={handleSubmit} noValidate>
        {error && (
          <Alert type="error" title="Could Not Enrol" message={error} />
        )}
        {missing && (
          <Alert
            type="info"
            title="Your account key is locked"
            message="Nothing is lost — your account is on the server. Sign in again and this page will find the key it just unlocked."
          />
        )}

        {/* The name and the id together. Voters recognise elections by name, and
            this page used to show only `election_2026`. */}
        <div className="zv-context-line">
          Enrolling in{" "}
          <strong>{electionName ?? electionId}</strong>
          {electionName && (
            <>
              {" "}
              (<code className="zv-mono">{electionId}</code>)
            </>
          )}{" "}
          as <code className="zv-mono">{subject}</code>
        </div>

        {/* Losing this one is worse than losing the account passphrase: it strands
            the enrolment, so the person can never vote in an election they were
            eligible for, and there is no reset for it either. */}
        <Alert
          type="warning"
          title="Write this passphrase down"
          message="This seals the ballot key for this one election. It is not stored anywhere the server can read and it cannot be reset — if you lose it you stay enrolled but can never vote here."
        />

        <Field
          label="Ballot Passphrase"
          required
          type="password"
          revealable
          placeholder={`At least ${MIN_BALLOT_PASSPHRASE} characters`}
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          autoComplete="new-password"
          disabled={loading}
          error={
            passphrase !== "" && passphrase.length < MIN_BALLOT_PASSPHRASE
              ? `Must be at least ${MIN_BALLOT_PASSPHRASE} characters`
              : undefined
          }
          hint="Different from your account passphrase on purpose — one unlocks your account everywhere, this one belongs to a single election."
        />

        <Field
          label="Confirm Ballot Passphrase"
          required
          type="password"
          revealable
          placeholder="Type it again"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          disabled={loading}
          error={mismatch ? "The two do not match" : undefined}
        />

        <span className="zv-form-hint">
          A new key is created for this election only. It is never reused from
          your account key, so your activity in one election cannot be linked to
          another.
        </span>

        <div className="zv-form-actions">
          <Button
            type="submit"
            variant="primary"
            isLoading={loading}
            disabled={!ready}
          >
            Join this election
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void onDone()}
            disabled={loading}
          >
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
};
