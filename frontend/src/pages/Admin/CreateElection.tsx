import React, { useEffect, useRef, useState } from "react";
import { api } from "../../services/api";
import { useSubmit } from "../../hooks/useSubmit";
import { describeLocalInput } from "../../services/format";
import { Card } from "../../components/common/Card";
import { Stepper } from "../../components/common/Stepper";
import { useSubmitShortcut } from "../../hooks/useSubmitShortcut";
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

export const CreateElection: React.FC<{ onDone?: () => void }> = ({ onDone }) => {
  const [step, setStep] = useState(0);
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
  // Problems appear once a field was left or a step was submitted; never by
  // disabling the button.
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [attempted, setAttempted] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  useSubmitShortcut(formRef);

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

  const low = minAge.trim() === "" ? null : Number(minAge);
  const high = maxAge.trim() === "" ? null : Number(maxAge);
  const agesInverted = low !== null && high !== null && low > high;
  const agesNonsense =
    (low !== null && (!Number.isFinite(low) || low < 0)) ||
    (high !== null && (!Number.isFinite(high) || high < 0));

  // An election that closes before it opens can never be joined.
  const startMs = startsAt ? new Date(startsAt).getTime() : null;
  const endMs = endsAt ? new Date(endsAt).getTime() : null;
  const windowInverted =
    startMs !== null && endMs !== null && !Number.isNaN(startMs) && !Number.isNaN(endMs) && endMs <= startMs;

  const problems: Record<string, string | undefined> = {
    id: id.trim() === "" ? "Enter an election ID." : undefined,
    name: name.trim() === "" ? "Enter a name." : undefined,
    candidates: parsed.error ?? undefined,
    ages: agesInverted
      ? `Minimum age ${low} is above maximum age ${high}`
      : agesNonsense
        ? "Ages must be whole numbers, 0 or more"
        : undefined,
    window: windowInverted ? "The end time is at or before the start time" : undefined,
    master:
      masterPassphrase.length < minPassphrase
        ? `Use at least ${minPassphrase} characters`
        : undefined,
    confirm:
      masterConfirm !== masterPassphrase ? "The two do not match" : undefined,
  };
  const STEP1 = ["id", "name", "candidates", "ages", "window"];
  const STEP2 = ["master", "confirm"];

  const errorFor = (key: string) =>
    touched[key] || attempted ? problems[key] : undefined;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    if (step === 0) {
      if (STEP1.some((k) => problems[k])) {
        setAttempted(true);
        return;
      }
      setAttempted(false);
      setStep(1);
      return;
    }
    if (STEP1.concat(STEP2).some((k) => problems[k])) {
      setAttempted(true);
      return;
    }
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
    setStep(0);
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
    setAttempted(false);
    clear();
  };

  const blur = (k: string) => () => setTouched((t) => ({ ...t, [k]: true }));

  if (result) {
    return (
      <Card>
        <div className="zv-receipt">
          <Alert
            type="success"
            title="Election created"
            message="Now open for voters. Share the ID below so they can find it."
          />
          <div className="zv-id-callout">
            <span className="zv-id-callout-label">Election ID</span>
            <span className="zv-id-callout-value">{result.id}</span>
            <CopyButton value={result.id} label="Election ID" />
            <span className="zv-id-callout-hint">
              Voters find this election by its ID. It can't be changed.
            </span>
          </div>
          <div className="zv-result-details">
            <div className="zv-result-row">
              <span className="zv-result-label">Choices</span>
              <span className="zv-result-value">{result.candidates.join(", ")}</span>
            </div>
            <div className="zv-result-row">
              <span className="zv-result-label">Who can join</span>
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
          <Alert
            type="warning"
            title="Keep the master passphrase. You can't get it back."
            message="Closing voting and counting votes both need it. The server does not store it. If you lose it, this election can never be counted."
          />
          <div className="zv-form-actions">
            <Button variant="outline" onClick={handleReset}>
              Create another election
            </Button>
            <Button variant="primary" onClick={onDone}>
              Back to elections
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <div className="zv-a-flow">
      <Stepper steps={["Rules", "Master passphrase"]} current={step} />
      <form
        ref={formRef}
        onSubmit={(e) => void handleSubmit(e)}
        noValidate
        className={step === 1 ? "zv-a-grid" : "zv-a-narrow"}
      >
        {step === 0 ? (
          <Card>
            <div className="zv-form">
              <Field
                label="Election ID"
                required
                placeholder="e.g. election_2026"
                value={id}
                onChange={(e) => setId(e.target.value)}
                controlClassName="zv-mono"
                autoComplete="off"
                error={errorFor("id")}
                onBlur={blur("id")}
                hint="Voters use this to find the election. It can't be changed."
              />
              <Field
                label="Election name"
                required
                placeholder="e.g. Student council 2026"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="off"
                error={errorFor("name")}
                onBlur={blur("name")}
              />
              <Field
                as="textarea"
                label="Description"
                placeholder="Optional"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
              />
              <Field
                as="textarea"
                label="Choices"
                required
                placeholder={"Alice\nBob\nCarol"}
                value={candidates}
                onChange={(e) => setCandidates(e.target.value)}
                rows={4}
                error={errorFor("candidates")}
                onBlur={blur("candidates")}
                hint="One per line. Fixed once the election exists, so check the spelling."
              />
              <div className="zv-form-row">
                <Field
                  label="Minimum age"
                  type="number"
                  min={0}
                  max={150}
                  placeholder="18"
                  value={minAge}
                  onChange={(e) => setMinAge(e.target.value)}
                  onBlur={blur("ages")}
                  hint="Leave empty for no lower limit."
                />
                <Field
                  label="Maximum age"
                  type="number"
                  min={0}
                  max={150}
                  placeholder="25"
                  value={maxAge}
                  onChange={(e) => setMaxAge(e.target.value)}
                  onBlur={blur("ages")}
                  hint="Leave empty for no upper limit."
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
                  label="Opens"
                  type="datetime-local"
                  value={startsAt}
                  onChange={(e) => setStartsAt(e.target.value)}
                  onBlur={blur("window")}
                  hint={describeLocalInput(startsAt) ?? "Leave empty to open now."}
                />
                <Field
                  label="Closes"
                  type="datetime-local"
                  value={endsAt}
                  onChange={(e) => setEndsAt(e.target.value)}
                  onBlur={blur("window")}
                  hint={describeLocalInput(endsAt) ?? "Leave empty to close by hand."}
                />
              </div>
              {errorFor("window") && (
                <span className="zv-form-error-hint">{errorFor("window")}</span>
              )}
              <div className="zv-form-actions">
                <Button type="submit" variant="primary">
                  Next
                </Button>
              </div>
            </div>
          </Card>
        ) : (
          <>
            <Card>
              <div className="zv-form">
                {error && (
                  <Alert type="error" title="Could not create the election" message={error} />
                )}
                <Field
                  label="Master passphrase"
                  required
                  type="password"
                  revealable
                  placeholder={`At least ${minPassphrase} characters`}
                  value={masterPassphrase}
                  onChange={(e) => setMasterPassphrase(e.target.value)}
                  autoComplete="new-password"
                  disabled={loading}
                  error={errorFor("master")}
                  onBlur={blur("master")}
                />
                <Field
                  label="Confirm"
                  required
                  type="password"
                  revealable
                  placeholder="Type it again"
                  value={masterConfirm}
                  onChange={(e) => setMasterConfirm(e.target.value)}
                  autoComplete="new-password"
                  disabled={loading}
                  error={errorFor("confirm")}
                  onBlur={blur("confirm")}
                />
                <div className="zv-form-actions">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setStep(0)}
                    disabled={loading}
                  >
                    Back
                  </Button>
                  <Button type="submit" variant="primary" isLoading={loading} shortcut="submit">
                    Create election
                  </Button>
                </div>
              </div>
            </Card>
            <aside className="zv-card zv-a-side zv-a-danger-card">
              <h2 className="zv-a-side-title">This passphrase is never stored</h2>
              <p className="zv-a-lede">
                You need it to close and count this election. Lose it and the
                votes can never be counted.
              </p>
              <dl className="zv-a-kv">
                <dt>Election</dt>
                <dd>{name.trim() || "Not named"}</dd>
                <dt>Choices</dt>
                <dd>{parsed.names.length}</dd>
                <dt>Who can join</dt>
                <dd>{describeCriteria({ min_age: low, max_age: high })}</dd>
              </dl>
            </aside>
          </>
        )}
      </form>
    </div>
  );
};
