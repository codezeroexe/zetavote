import React, { useState } from "react";
import type { ElectionSummary, TallyResponse } from "../../types/api";
import { api } from "../../services/api";
import { useSubmit } from "../../hooks/useSubmit";
import { Button } from "../../components/common/Button";
import { Alert } from "../../components/common/Alert";
import { Field } from "../../components/common/Field";

/**
 * Step 2 of "Finish the election": count votes. FinishElection shows the
 * outcome once `onCounted` fires. The election is closed before this renders.
 */
export const TallyElection: React.FC<{
  election: ElectionSummary;
  onCounted: (result: TallyResponse) => void;
}> = ({ election, onCounted }) => {
  const [passphrase, setPassphrase] = useState("");
  const [problem, setProblem] = useState<string | undefined>();
  const { loading, error, run } = useSubmit<TallyResponse>();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    if (passphrase.trim() === "") {
      setProblem("Enter the master passphrase.");
      return;
    }
    setProblem(undefined);
    const answer = await run(() =>
      api.tallyElection(election.id, { master_passphrase: passphrase }),
    );
    if (answer) {
      setPassphrase("");
      onCounted(answer);
    }
  };

  return (
    <form className="zv-form" onSubmit={(e) => void handleSubmit(e)} noValidate>
      {error && <Alert type="error" title="Could not count votes" message={error} />}
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
        hint="Asked again because counting opens every ballot in this election."
      />
      <div className="zv-form-actions">
        <Button type="submit" variant="primary" isLoading={loading}>
          Count votes
        </Button>
      </div>
    </form>
  );
};
