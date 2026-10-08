import React, { useState } from "react";
import type { ElectionSummary, TallyResponse } from "../../types/api";
import { api } from "../../services/api";
import { useSubmit } from "../../hooks/useSubmit";
import { Button } from "../../components/common/Button";
import { Alert } from "../../components/common/Alert";
import { Field } from "../../components/common/Field";
import { HashBlock } from "../../components/common/CopyButton";
import { BinaryColumn } from "../../components/common/Hole";

/**
 * Tally an election and publish the result.
 *
 * Like Close Election, this renders inside the row that opened it, so there is
 * no election picker here: the row names the election and a free-text id field
 * beside an irreversible action is a field that exists to be typed wrong.
 */
export const TallyElection: React.FC<{
  election: ElectionSummary;
  onDone?: () => void | Promise<void>;
}> = ({ election, onDone }) => {
  const [passphrase, setPassphrase] = useState("");

  const { loading, result, error, run, clear } = useSubmit<TallyResponse>();

  // Tallying an election that is still open would decrypt ballots out from under
  // voters who are still voting. The row only offers this on a closed election,
  // and the server refuses it either way.
  const stillOpen = election.active;

  const canSubmit = passphrase.trim() !== "" && !stillOpen;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || loading) return;

    const answer = await run(() =>
      api.tallyElection(election.id, { master_passphrase: passphrase }),
    );
    if (answer) {
      setPassphrase("");
      void onDone?.();
    }
  };

  const sortedChoices = result
    ? Object.entries(result.choice_breakdown).sort(([, a], [, b]) => b - a)
    : [];

  if (result) {
    return (
      <div className="zv-receipt">
        <Alert
          type="success"
          title="Tally complete"
          message={`${election.ballots} ${election.ballots === 1 ? "ballot" : "ballots"} decrypted and counted. Results for ${election.name} are now published.`}
        />

        {result.rejected_ballots > 0 && (
          <Alert
            type="warning"
            title={`${result.rejected_ballots} ${result.rejected_ballots === 1 ? "ballot was" : "ballots were"} rejected`}
            message="These failed signature verification, would not decrypt, or named someone who is not on the candidate list. They are excluded from the total and recorded in the audit log."
          />
        )}

        {sortedChoices.length > 0 ? (
          <div className="zv-tally-breakdown zv-tally">
            {sortedChoices.map(([choice, count]) => {
              const pct =
                result.total_votes > 0
                  ? Math.round((count / result.total_votes) * 100)
                  : 0;
              return (
                <div key={choice} className="zv-tally-row">
                  <BinaryColumn value={count} />
                  <div className="zv-tally-row-header">
                    <span className="zv-tally-choice">{choice}</span>
                    <span className="zv-tally-count">
                      {count} {count === 1 ? "vote" : "votes"}
                    </span>
                    <span className="zv-tally-share">{pct}% of total</span>
                  </div>
                </div>
              );
            })}
            <p className="zv-bits-caption">
              binary column · most significant place at the top
            </p>
          </div>
        ) : (
          <Alert type="info" message="No votes were cast in this election." />
        )}

        <HashBlock label="Merkle root" value={result.merkle_root} tone="live" />

        <div className="zv-form-actions">
          <Button variant="outline" size="sm" onClick={clear}>
            Tally another election
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form className="zv-form" onSubmit={handleSubmit} noValidate>
      {error && <Alert type="error" title="Tally failed" message={error} />}

      {stillOpen ? (
        <Alert
          type="warning"
          title="This election is still open"
          message="Close it first — tallying now would publish a result while people are still voting."
        />
      ) : (
        <p className="zv-disclosure-note">
          {election.name} is closed with {election.ballots}{" "}
          {election.ballots === 1 ? "ballot" : "ballots"} from{" "}
          {election.registered} registered{" "}
          {election.registered === 1 ? "voter" : "voters"}.
        </p>
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
        disabled={loading || stillOpen}
        hint="Required even though you are signed in. Tallying decrypts every ballot in this election."
      />

      <div className="zv-form-actions">
        <Button
          type="submit"
          variant="primary"
          isLoading={loading}
          disabled={!canSubmit}
        >
          Tally and publish
        </Button>
      </div>
    </form>
  );
};
