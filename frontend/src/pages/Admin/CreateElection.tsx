import React, { useState } from "react";
import type { ElectionCreateResponse } from "../../types/api";
import { api, toMessage } from "../../services/api";
import { Card } from "../../components/common/Card";
import { Button } from "../../components/common/Button";
import { Alert } from "../../components/common/Alert";

export const CreateElection: React.FC = () => {
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [masterPassphrase, setMasterPassphrase] = useState("");

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ElectionCreateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = id.trim() !== "" && name.trim() !== "";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || loading) return;

    setLoading(true);
    setResult(null);
    setError(null);

    try {
      const res = await api.createElection({
        id: id.trim(),
        name: name.trim(),
        description: description.trim() || null,
        starts_at: startsAt ? new Date(startsAt).toISOString() : null,
        ends_at: endsAt ? new Date(endsAt).toISOString() : null,
        master_passphrase: masterPassphrase || null,
      });
      setResult(res);
      // Clear sensitive field
      setMasterPassphrase("");
    } catch (err: unknown) {
      setError(toMessage(err, "Failed to create election"));
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setId("");
    setName("");
    setDescription("");
    setStartsAt("");
    setEndsAt("");
    setMasterPassphrase("");
    setResult(null);
    setError(null);
  };

  return (
    <Card>
      {result ? (
        <div className="zv-admin-result">
          <Alert
            type="success"
            title="Election Created"
            message={`Election "${result.name}" has been successfully initialized.`}
          />
          <div className="zv-result-details">
            <div className="zv-result-row">
              <span className="zv-result-label">Election ID</span>
              <code className="zv-result-value">{result.id}</code>
            </div>
            <div className="zv-result-row">
              <span className="zv-result-label">Name</span>
              <span className="zv-result-value">{result.name}</span>
            </div>
            {result.description && (
              <div className="zv-result-row">
                <span className="zv-result-label">Description</span>
                <span className="zv-result-value">{result.description}</span>
              </div>
            )}
            {result.starts_at && (
              <div className="zv-result-row">
                <span className="zv-result-label">Starts At</span>
                <span className="zv-result-value">
                  {new Date(result.starts_at).toLocaleString()}
                </span>
              </div>
            )}
            {result.ends_at && (
              <div className="zv-result-row">
                <span className="zv-result-label">Ends At</span>
                <span className="zv-result-value">
                  {new Date(result.ends_at).toLocaleString()}
                </span>
              </div>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={handleReset}>
            Create Another Election
          </Button>
        </div>
      ) : (
        <form className="zv-form" onSubmit={(e) => void handleSubmit(e)}>
          {error && <Alert type="error" title="Creation Failed" message={error} />}

          <label className="zv-form-label">
            <span className="zv-label-text">
              Election ID <span className="zv-required">*</span>
            </span>
            <input
              type="text"
              className="zv-input"
              placeholder="e.g. election_2026"
              value={id}
              onChange={(e) => setId(e.target.value)}
              required
              autoComplete="off"
            />
          </label>

          <label className="zv-form-label">
            <span className="zv-label-text">
              Election Name <span className="zv-required">*</span>
            </span>
            <input
              type="text"
              className="zv-input"
              placeholder="e.g. Student Council Election 2026"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoComplete="off"
            />
          </label>

          <label className="zv-form-label">
            <span className="zv-label-text">Description</span>
            <textarea
              className="zv-input zv-textarea"
              placeholder="Optional description of this election"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </label>

          <div className="zv-form-row">
            <label className="zv-form-label">
              <span className="zv-label-text">Start Date/Time</span>
              <input
                type="datetime-local"
                className="zv-input"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
              />
            </label>
            <label className="zv-form-label">
              <span className="zv-label-text">End Date/Time</span>
              <input
                type="datetime-local"
                className="zv-input"
                value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)}
              />
            </label>
          </div>

          <label className="zv-form-label">
            <span className="zv-label-text">Master Passphrase</span>
            <input
              type="password"
              className="zv-input"
              placeholder="Used to close and tally this election"
              value={masterPassphrase}
              onChange={(e) => setMasterPassphrase(e.target.value)}
              autoComplete="new-password"
            />
            <span className="zv-form-hint">
              Required for closing and tallying. Store securely — it cannot be recovered.
            </span>
          </label>

          <div className="zv-form-actions">
            <Button
              type="submit"
              variant="primary"
              isLoading={loading}
              disabled={!canSubmit}
            >
              Create Election
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
};
