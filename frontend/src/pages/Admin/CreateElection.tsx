import React, { useEffect, useState } from "react";
import { api } from "../../services/api";
import { useSubmit } from "../../hooks/useSubmit";
import { describeLocalInput } from "../../services/format";
import { Card } from "../../components/common/Card";
import { Button } from "../../components/common/Button";
import { Alert } from "../../components/common/Alert";
import { Field } from "../../components/common/Field";
import {
  CopyButton,
  HashBlock,
} from "../../components/common/CopyButton";
import { describeCriteria } from "../../services/ageRule";

/** Fallback; the server's own value arrives on /api/health. */
const FALLBACK_MIN_PASSPHRASE = 8;

/**
 * Candidates are fixed here and never change afterwards. A list that could be
 * edited while voting was open would be indistinguishable from manipulation,
 * however well the change was logged.
 */
function parseCandidates(raw: string): {
  names: string[];
  error: string | null;
} {
  const names = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (names.length === 0) {
    return { names: [], error: "Add at least one candidate." };
  }
  const seen = new Set<string>();
  for (const name of names) {
    if (seen.has(name))
      return { names: [], error: `"${name}" is listed twice.` };
    seen.add(name);
  }
  return { names, error: null };
}

export const CreateElection: React.FC = () => {
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [masterPassphrase, setMasterPassphrase] = useState("");
  const [masterConfirm, setMasterConfirm] = useState("");
  const [candidates, setCandidates] = useState("");
  const [minAge, setMinAge] = useState("");
  const [maxAge, setMaxAge] = useState("");
  const [minPassphrase, setMinPassphrase] = useState(FALLBACK_MIN_PASSPHRASE);
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const { loading, result, error, run, clear } = useSubmit<{
    id: string;
    public_key: string;
    candidates: string[];
  }>();

  useEffect(() => {
    void api
      .checkHealth()
      .then((health) => {
        if (health.min_passphrase) setMinPassphrase(Number(health.min_passphrase));
      })
      .catch(() => undefined);
  }, []);

  const parsed = parseCandidates(candidates);

  // Age inversion. The server would refuse this, but only after a round trip and
  // with a message about a rule rather than about the two fields.
  const low = minAge.trim() === "" ? null : Number(minAge);
  const high = maxAge.trim() === "" ? null : Number(maxAge);
  const agesInverted = low !== null && high !== null && low > high;
  const agesNonsense =
    low !== null && (!Number.isFinite(low) || low < 0) ||
    high !== null && (!Number.isFinite(high) || high < 0);

  // Window inversion. Same reasoning, and worse here: an election that closes
  // before it opens can never be joined, and the admin finds out at close time.
  const startMs = startsAt ? new Date(startsAt).getTime() : null;
  const endMs = endsAt ? new Date(endsAt).getTime() : null;
  const windowInverted =
    startMs !== null && endMs !== null && !Number.isNaN(startMs) && !Number.isNaN(endMs) && endMs <= startMs;

  const masterMismatch = masterConfirm !== "" && masterConfirm !== masterPassphrase;

  const problems: Record<string, string | undefined> = {
    candidates:
      candidates.trim() !== "" ? parsed.error ?? undefined : undefined,
    master:
      masterPassphrase !== "" && masterPassphrase.length < minPassphrase
        ? `Must be at least ${minPassphrase} characters`
        : undefined,
    confirm: masterMismatch ? "The two do not match" : undefined,
    ages: agesInverted
      ? `Minimum age ${low} is above maximum age ${high}`
      : agesNonsense
        ? "Ages must be whole numbers, 0 or more"
        : undefined,
    window: windowInverted
      ? "The end time is at or before the start time"
      : undefined,
  };

  const canSubmit =
    id.trim() !== "" &&
    name.trim() !== "" &&
    parsed.names.length > 0 &&
    parsed.error === null &&
    masterPassphrase.length >= minPassphrase &&
    masterConfirm === masterPassphrase &&
    !agesInverted &&
    !agesNonsense &&
    !windowInverted;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || loading) return;
    setTouched({});

    await run(
      () =>
        api.createElection({
          id: id.trim(),
          name: name.trim(),
          description: description.trim() || null,
          starts_at: startsAt ? new Date(startsAt).toISOString() : null,
          ends_at: endsAt ? new Date(endsAt).toISOString() : null,
          master_passphrase: masterPassphrase,
          candidates: parsed.names,
          min_age: low,
          max_age: high,
        }),
      { onSuccess: () => setMasterPassphrase("") },
    );
  };

  const handleReset = () => {
    setId("");
    setName("");
    setDescription("");
    setStartsAt("");
    setEndsAt("");
    setMasterPassphrase("");
    setMasterConfirm("");
    setCandidates("");
    setMinAge("");
    setMaxAge("");
    setTouched({});
    clear();
  };

  // Errors only once the field has been left, so an empty form is not a list of
  // complaints about itself.
  const errorFor = (key: string) =>
    touched[key] ? problems[key] : undefined;

  return (
    <Card>
      {result ? (
        <div className="zv-receipt">
          <Alert
            type="success"
            title="Election Created"
            message="Now open for voters. Share the id below — that is how they find it."
          />
          <div className="zv-id-callout">
            <span className="zv-id-callout-label">Election ID</span>
            <span className="zv-id-callout-value">{result.id}</span>
            <CopyButton value={result.id} label="Election id" />
            <span className="zv-id-callout-hint">
              Voters find this election by its id. It cannot be changed.
            </span>
          </div>
          <div className="zv-result-details">
            <div className="zv-result-row">
              <span className="zv-result-label">Candidates</span>
              <span className="zv-result-value">
                {result.candidates.join(", ")}
              </span>
            </div>
            <div className="zv-result-row">
              <span className="zv-result-label">Eligibility</span>
              <span className="zv-result-value">
                {describeCriteria({ min_age: low, max_age: high })}
              </span>
            </div>
          </div>
          <HashBlock
            label="Election public key"
            value={result.public_key}
            hint="Ballots are encrypted to this key. It is public by design."
          />

          {/* This warning used to appear only here, after the election already
              existed and could not be closed or tallied without it. */}
          <Alert
            type="warning"
            title="Keep the master passphrase — you cannot get it back"
            message="Closing and tallying both need it, and neither can be done without it. The server does not store it. If you lose it this election can never be closed or tallied, and there is no reset."
          />
          <div className="zv-form-actions">
            <Button variant="primary" size="sm" onClick={handleReset}>
              Create Another Election
            </Button>
          </div>
        </div>
      ) : (
        <form className="zv-form" onSubmit={(e) => void handleSubmit(e)} noValidate>
          {error && (
            <Alert type="error" title="Creation Failed" message={error} />
          )}

          <Field
            label="Election id"
            required
            placeholder="e.g. election_2026"
            value={id}
            onChange={(e) => setId(e.target.value)}
            controlClassName="zv-mono"
            autoComplete="off"
            onBlur={() => setTouched((t) => ({ ...t, id: true }))}
          />

          <Field
            label="Election Name"
            required
            placeholder="e.g. Student Council Election 2026"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="off"
          />

          <Field
            as="textarea"
            label="Description"
            placeholder="Optional description of this election"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
          />

          <Field
            as="textarea"
            label="Candidates"
            required
            placeholder={"Alice\nBob\nCarol"}
            value={candidates}
            onChange={(e) => setCandidates(e.target.value)}
            rows={4}
            error={errorFor("candidates")}
            hint="One per line. Fixed once the election exists — voters pick from this list, and a typo here would split a candidate's votes."
          />

          <div className="zv-form-row">
            <Field
              label="Minimum Age"
              type="number"
              min={0}
              max={150}
              placeholder="18"
              value={minAge}
              onChange={(e) => setMinAge(e.target.value)}
              disabled={loading}
              onBlur={() => setTouched((t) => ({ ...t, ages: true }))}
              hint="Leave empty for no lower bound."
            />
            <Field
              label="Maximum Age"
              type="number"
              min={0}
              max={150}
              placeholder="25"
              value={maxAge}
              onChange={(e) => setMaxAge(e.target.value)}
              disabled={loading}
              onBlur={() => setTouched((t) => ({ ...t, ages: true }))}
              hint="Leave empty for no upper bound."
            />
          </div>
          {errorFor("ages") && (
            <span className="zv-form-error-hint">{errorFor("ages")}</span>
          )}
          <div className="zv-context-line">
            {describeCriteria({ min_age: low, max_age: high })}
          </div>

          <div className="zv-form-row">
            <Field
              label="Start Date/Time"
              type="datetime-local"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, window: true }))}
              hint={describeLocalInput(startsAt) ?? "Leave empty to open immediately."}
            />
            <Field
              label="End Date/Time"
              type="datetime-local"
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, window: true }))}
              hint={describeLocalInput(endsAt) ?? "Leave empty to never close on its own."}
            />
          </div>
          {errorFor("window") && (
            <span className="zv-form-error-hint">{errorFor("window")}</span>
          )}

          {/* Stated above the field, not in the success panel afterwards. */}
          <Alert
            type="warning"
            title="This passphrase is the election's only key"
            message="It is used to close the election and to decrypt the ballots when tallying. It is never stored and it cannot be reset — if it is lost, this election can never be closed or tallied."
          />

          <Field
            label="Master Passphrase"
            required
            type="password"
            revealable
            placeholder={`At least ${minPassphrase} characters`}
            value={masterPassphrase}
            onChange={(e) => setMasterPassphrase(e.target.value)}
            autoComplete="new-password"
            error={errorFor("master")}
            onBlur={() => setTouched((t) => ({ ...t, master: true }))}
            hint="Required to close and to tally. Never stored, never sent anywhere except this server."
          />

          <Field
            label="Confirm Master Passphrase"
            required
            type="password"
            revealable
            placeholder="Type it again"
            value={masterConfirm}
            onChange={(e) => setMasterConfirm(e.target.value)}
            autoComplete="new-password"
            error={errorFor("confirm")}
            onBlur={() => setTouched((t) => ({ ...t, confirm: true }))}
          />

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
