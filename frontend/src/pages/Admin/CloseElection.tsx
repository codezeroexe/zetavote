import React, { useState } from "react";
import type { CloseElectionResponse, ElectionSummary } from "../../types/api";
import { api } from "../../services/api";
import { useSubmit } from "../../hooks/useSubmit";
import { Button } from "../../components/common/Button";
import { Alert } from "../../components/common/Alert";
import { Field } from "../../components/common/Field";

/**
 * Step 1 of "Finish the election": close voting. Rendered by FinishElection,
 * which names the election and shows the consequences beside this form. The
 * election comes from the row that opened the flow, never from a typed id.
 */
export const CloseElection: React.FC<{
  election: ElectionSummary;
  onCancel: () => void;
  onDone?: () => void | Promise<void>;
}> = ({ election, onCancel, onDone }) => {
  const [passphrase, setPassphrase] = useState("");
  const [problem, setProblem] = useState<string | undefined>();
  const { loading, error, run } = useSubmit<CloseElectionResponse>();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    if (passphrase.trim() === "") {
      setProblem("Enter the master passphrase.");
      return;
    }
    setProblem(undefined);
    const answer = await run(() =>
      api.closeElection(election.id, { master_passphrase: passphrase }),
    );
    setPassphrase("");
    if (answer) void onDone?.();
  };

  return (
    <form className="zv-form" onSubmit={(e) => void handleSubmit(e)} noValidate>
      {error && <Alert type="error" title="Could not close voting" message={error} />}
      <Field
        label="Master passphrase"
        required
        type="password"
        revealable
        placeholder="Set when this election was created"
        value={passphrase}
        onChange={(e) => setPassphrase(e.target.value)}
        autoComplete="current-password"
        disabled={loading}
        error={problem}
        hint="Asked again so a stolen session can't end an election."
      />
      <div className="zv-form-actions">
        <Button type="button" variant="outline" onClick={onCancel} disabled={loading}>
          Cancel
        </Button>
        <Button type="submit" variant="danger" isLoading={loading}>
          Close voting
        </Button>
      </div>
    </form>
  );
};
