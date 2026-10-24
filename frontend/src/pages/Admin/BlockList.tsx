import React, { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../services/api";
import { useSubmit } from "../../hooks/useSubmit";
import { formatTimestamp } from "../../services/format";
import type { BlockedAccount } from "../../types/api";
import { Button } from "../../components/common/Button";
import { Alert } from "../../components/common/Alert";
import { Field } from "../../components/common/Field";

/**
 * The admin's deny-list for one election.
 *
 * Be honest in the copy about what this is: it stops an account the admin has
 * already identified, and nothing else. With the roster gone there is no line for
 * a duplicate to collide with, so a determined person can register again — this
 * list is the only lever available, and pretending otherwise would be worse than
 * saying so plainly to the person who has to use it.
 */
export const BlockList: React.FC<{
  electionId: string;
  onDone?: () => void;
}> = ({ electionId, onDone }) => {
  const [blocks, setBlocks] = useState<BlockedAccount[] | null>(null);
  const [username, setUsername] = useState("");
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState<string | undefined>();
  const { loading, error, run } = useSubmit<{ username: string }>();
  // Blocking is destructive, so it opens as a sheet from the list rather than as
  // a form beneath it. Cancel is the default way out.
  const sheetRef = useRef<HTMLDialogElement>(null);

  const load = useCallback(async () => {
    try {
      setBlocks((await api.listBlocks(electionId)).blocks);
    } catch {
      setBlocks([]);
    }
  }, [electionId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    if (username.trim() === "") {
      setProblem("Enter the username to block.");
      return;
    }
    setProblem(undefined);
    await run(async () => {
      const added = await api.addBlock(
        electionId,
        username.trim(),
        reason.trim() || undefined,
      );
      setUsername("");
      setReason("");
      sheetRef.current?.close();
      await load();
      onDone?.();
      return added;
    });
  };

  // Unblocking is one click and there is no undo, so it asks first. Reversing a
  // block is easy; re-adding one after a duplicate gets back in is not.
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const handleRemove = async (target: string) => {
    if (loading) return;
    setConfirmRemove(null);
    await run(async () => {
      await api.removeBlock(electionId, target);
      await load();
      onDone?.();
      return { username: target };
    });
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => sheetRef.current?.showModal()}>
        Block an account
      </Button>

      <dialog ref={sheetRef} className="zv-sheet zv-glass zv-a-sheet" aria-labelledby="zv-block-title">
      <form className="zv-form" onSubmit={(e) => void handleAdd(e)} noValidate>
        <h2 id="zv-block-title" className="zv-sheet-title">
          Block {username.trim() || "this account"}?
        </h2>
        <p className="zv-sheet-body">
          This stops {username.trim() || "the account"} from joining or voting in this
          election. It does not affect any other account or election, and it does not
          retract a ballot already cast.
        </p>

        {error && (
          <Alert type="error" title="Could not update" message={error} />
        )}

        <Field
          label="Username"
          required
          placeholder="asharao0142"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          controlClassName="zv-mono"
          autoComplete="off"
          disabled={loading}
          error={problem}
          hint="The account to bar. It does not have to exist yet."
        />

        <Field
          label="Reason"
          placeholder="Duplicate account"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          disabled={loading}
          hint="Kept for your own record and the activity record."
        />

        <div className="zv-form-actions">
          {/* autoFocus on Cancel: a quick Return must never block anyone. */}
          <Button
            type="button"
            variant="outline"
            autoFocus
            onClick={() => sheetRef.current?.close()}
          >
            Cancel <kbd className="zv-kbd" aria-hidden="true">Esc</kbd>
          </Button>
          <Button type="submit" variant="danger" isLoading={loading}>
            Block account
          </Button>
        </div>
      </form>
      </dialog>

      {blocks !== null && blocks.length === 0 && (
        <p className="zv-form-hint">
          No accounts are blocked in this election.
        </p>
      )}

      {blocks !== null && blocks.length > 0 && (
        <div className="zv-blocked-list">
          {blocks.map((block) => (
            <article key={block.username} className="zv-blocked-row">
              <div className="zv-blocked-row-main">
                <span className="zv-blocked-row-name zv-mono">
                  {block.username}
                </span>
                <span className="zv-blocked-row-reason">
                  {block.reason || "No reason recorded"}
                </span>
                <span className="zv-blocked-row-since">
                  blocked {formatTimestamp(block.created_at)}
                </span>
              </div>
              <div className="zv-election-card-actions">
                {confirmRemove === block.username ? (
                  <>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => void handleRemove(block.username)}
                      disabled={loading}
                    >
                      Unblock {block.username}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setConfirmRemove(null)}
                      disabled={loading}
                    >
                      Cancel
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setConfirmRemove(block.username)}
                  >
                    Unblock
                  </Button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
};
