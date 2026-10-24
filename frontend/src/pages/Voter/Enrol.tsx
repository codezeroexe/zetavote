import React, { useState } from "react";
import { Stepper } from "../../components/common/Stepper";
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
import { Button } from "../../components/common/Button";
import { Alert } from "../../components/common/Alert";
import { Field } from "../../components/common/Field";
import { useToast } from "../../components/common/Toast";
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
  const { show } = useToast();
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [missing, setMissing] = useState(false);
  const [attempted, setAttempted] = useState(false);

  const { loading, result, error, run } = useSubmit<{ username: string }>();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    // Checked here, not by disabling the button, so the problem is named inline.
    setAttempted(true);
    if (passphrase.length < MIN_BALLOT_PASSPHRASE || confirm !== passphrase) return;
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

  if (result) {
    return (
      <Card>
        <h2 className="zv-stub-title">You joined</h2>
        <p>
          {electionName
            ? `You are on ${electionName}'s eligible list. That is one vote, in this election only.`
            : "You are on this election's eligible list. That is one vote, in this election only."}
        </p>
        <div className="zv-form-actions">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              downloadJson(
                {
                  election_id: electionId,
                  election_name: electionName ?? null,
                  username: subject,
                },
                `enrolment_${electionId}.json`,
              );
              show("Confirmation downloaded", "ok");
            }}
          >
            Download confirmation
          </Button>
          <Button variant="primary" size="sm" onClick={() => void onDone()}>
            Back to my ballots
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <>
      <Stepper steps={["Account", "Join", "Vote", "Receipt"]} current={1} />
      <div className="zv-voter-pair">
        <Card>
          <form className="zv-form" onSubmit={handleSubmit} noValidate>
            {error && (
              <Alert type="error" title="Could not join" message={error} />
            )}
            {missing && (
              <Alert
                type="info"
                title="Your account key is locked"
                message="Nothing is lost. Your account is on the server. Sign in again and this page will find the key it just unlocked."
              />
            )}

            <div className="zv-context-line">
              Joining <strong>{electionName ?? electionId}</strong>
              {electionName && (
                <>
                  {" "}
                  (<code className="zv-mono">{electionId}</code>)
                </>
              )}{" "}
              as <code className="zv-mono">{subject}</code>
            </div>

            <Field
              label="Passphrase for this election"
              required
              type="password"
              revealable
              placeholder={`At least ${MIN_BALLOT_PASSPHRASE} characters`}
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              autoComplete="new-password"
              disabled={loading}
              error={
                attempted && passphrase.length < MIN_BALLOT_PASSPHRASE
                  ? `Use at least ${MIN_BALLOT_PASSPHRASE} characters`
                  : undefined
              }
            />

            <Field
              label="Confirm"
              required
              type="password"
              revealable
              placeholder="Type it again"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              disabled={loading}
              error={
                (attempted || mismatch) && confirm !== passphrase
                  ? "The two do not match"
                  : undefined
              }
              hint={
                confirm !== "" && confirm === passphrase ? "✓ Matches" : undefined
              }
            />

            <div className="zv-form-actions">
              <Button type="submit" variant="primary" isLoading={loading}>
                Join election
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

        <aside className="zv-why-card">
          <h3 className="zv-stub-title">Why a second passphrase?</h3>
          <p>
            It keeps this vote separate from your account. You will need it
            once, when you vote. Write it down now.
          </p>
          <p>
            It is not stored anywhere we can read, and it cannot be reset. If
            you lose it you stay joined but can never vote in this election.
          </p>
        </aside>
      </div>
    </>
  );
};
