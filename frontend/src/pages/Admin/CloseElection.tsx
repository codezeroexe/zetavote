import React, { useState } from "react";
import type { CloseElectionResponse, ElectionSummary } from "../../types/api";
import { api } from "../../services/api";
import { useSubmit } from "../../hooks/useSubmit";
import { Button } from "../../components/common/Button";
import { Alert } from "../../components/common/Alert";
import { Field } from "../../components/common/Field";

/**
 * Close an election.
 *
 * It renders inside the row that opened it, so the election is named by that
 * row rather than picked from a list. There used to be a hand-typed election id
 * field here, which meant two ways to reach the same irreversible action and a
 * typo in one of them reading only as "Election not found".
 */
export const CloseElection: React.FC<{
  election: ElectionSummary;
  onDone?: () => void | Promise<void>;
}> = ({ election, onDone }) => {
  const [passphrase, setPassphrase] = useState("");
  const [confirming, setConfirming] = useState(false);

  const { loading, result, error, run, clear } =
    useSubmit<CloseElectionResponse>();

  const canSubmit = passphrase.trim() !== "";

  // The first submit only stages the confirmation; the request fires on the
  // second. Nothing irreversible is one click away.
  const handleRequestClose = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    clear();
    setConfirming(true);
  };

  const handleConfirmClose = async () => {
    setConfirming(false);
    await run(() =>
      api.closeElection(election.id, { master_passphrase: passphrase }),
    );
    setPassphrase("");
    void onDone?.();
  };

  if (result) {
    return (
      <div className="zv-receipt">
        <Alert
          type="success"
          title="Election closed"
          message={`${election.name} (${election.id}) is permanently closed. No further ballots will be accepted.`}
        />
        <div className="zv-form-actions">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setConfirming(false);
              clear();
            }}
          >
            Close another election
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form className="zv-form" onSubmit={handleRequestClose} noValidate>
      {error && <Alert type="error" title="Close failed" message={error} />}

      {confirming && (
        <div className="zv-confirm-box" role="alert">
          <div className="zv-confirm-header">
            <svg
              className="zv-confirm-icon"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                clipRule="evenodd"
              />
            </svg>
            <span className="zv-confirm-title">
              Close {election.name} permanently?
            </span>
          </div>
          {/* The counts at the moment of the decision. An admin with four open
              elections is being asked which one they are about to end, and the
              number of ballots already in it is the thing to check. */}
          <p className="zv-confirm-text">
            {election.registered} registered, {election.ballots}{" "}
            {election.ballots === 1 ? "ballot" : "ballots"} cast. After this,
            no further ballots are accepted and it cannot be undone.
          </p>
          <div className="zv-confirm-actions">
            <Button
              type="button"
              variant="danger"
              isLoading={loading}
              onClick={() => void handleConfirmClose()}
            >
              Close this election
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setConfirming(false)}
              disabled={loading}
            >
              Go back
            </Button>
          </div>
        </div>
      )}

      <Field
        label="Master passphrase"
        required
        type="password"
        revealable
        placeholder="The passphrase set when this election was created"
        value={passphrase}
        onChange={(e) => setPassphrase(e.target.value)}
        autoComplete="current-password"
        disabled={loading}
        hint="Required even though you are signed in. A stolen session should not be enough to end an election."
      />

      {!confirming && (
        <div className="zv-form-actions">
          <Button
            type="submit"
            variant="danger"
            isLoading={loading}
            disabled={!canSubmit}
          >
            Close election
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void onDone?.()}
            disabled={loading}
          >
            Cancel
          </Button>
        </div>
      )}
    </form>
  );
};
