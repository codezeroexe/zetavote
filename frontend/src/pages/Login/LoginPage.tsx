import React, { useEffect, useRef, useState } from "react";
import { api } from "../../services/api";
import { useSubmit } from "../../hooks/useSubmit";
import { useSubmitShortcut } from "../../hooks/useSubmitShortcut";
import { useSession } from "../../auth/SessionContext";
import {
  generateKeys,
  holdAccountKey,
  openPrivateKey,
  sealPrivateKey,
  signRaw,
} from "../../services/crypto";
import { FrontDoor } from "./FrontDoor";
import { Card } from "../../components/common/Card";
import { Button } from "../../components/common/Button";
import { Alert } from "../../components/common/Alert";
import { Field } from "../../components/common/Field";

/**
 * Fallback only. The real value comes from GET /api/health, which publishes the
 * server's own rule — it was hardcoded as 8 here and in CreateElection, each with
 * a comment saying it had to match backend/app.py.
 */
const FALLBACK_MIN_PASSPHRASE = 8;

export type EntryRole = "voter" | "admin";
export type EntryMode = "signin" | "register";

/**
 * The front page: the fields for the way in that is currently chosen.
 *
 * Which *role* is a navbar toggle — that choice is about which half of the app
 * you are in, so it belongs with the other navigation. Which of the two account
 * flows is not: it belongs directly above the fields it switches between, so the
 * choice and its consequence are read together rather than hunted for in the
 * chrome.
 */
export const LoginPage: React.FC<{ role: EntryRole }> = ({ role }) => {
  const { signInAsAdmin, signInAsAccount, expiredNotice } = useSession();
  const [mode, setMode] = useState<EntryMode>("signin");
  const [minPassphrase, setMinPassphrase] = useState(FALLBACK_MIN_PASSPHRASE);

  // Admin has no register flow, so leaving the voter side starts a fresh form.
  useEffect(() => setMode("signin"), [role]);

  useEffect(() => {
    void api
      .checkHealth()
      .then((health) => {
        if (health.min_passphrase) {
          setMinPassphrase(Number(health.min_passphrase));
        }
      })
      .catch(() => {
        // The fallback is the current server value, so a failed check is harmless.
      });
  }, []);

  return (
    <div className="zv-page-container zv-acct-page">
      <Alert
        type="info"
        title="Prototype, not for real elections"
        message="ZetaVote is an academic proof-of-concept for local cryptographic voting. It is not intended for binding, governmental or commercial elections."
        live={false}
      />

      {/* An expired session used to look exactly like a page that had stopped
          working: every action failed and nothing said why. */}
      {expiredNotice && (
        <Alert
          type="warning"
          title="Signed out"
          message={expiredNotice}
          live={false}
        />
      )}

      {role === "admin" ? (
        <AdminSignIn onSignIn={signInAsAdmin} minPassphrase={minPassphrase} />
      ) : mode === "signin" ? (
        <AccountSignIn
          onSignIn={signInAsAccount}
          onCreate={() => setMode("register")}
        />
      ) : (
        <RegisterAccount
          onSignIn={signInAsAccount}
          minPassphrase={minPassphrase}
          onBack={() => setMode("signin")}
        />
      )}
    </div>
  );
};

type Errors = Record<string, string | undefined>;

/** Admin credentials are a normal login, or on first run the one-time setup. */
const AdminSignIn: React.FC<{
  onSignIn: (name: string, passphrase: string) => Promise<void>;
  minPassphrase: number;
}> = ({ onSignIn, minPassphrase }) => {
  const [name, setName] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [needsBootstrap, setNeedsBootstrap] = useState(false);
  const [code, setCode] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const formRef = useRef<HTMLFormElement>(null);
  useSubmitShortcut(formRef);

  const { loading, error, run } = useSubmit<{
    status?: string;
    name?: string;
  }>();

  useEffect(() => {
    void api
      .bootstrapStatus()
      .then((status) => setNeedsBootstrap(status.needs_bootstrap))
      .catch(() => setNeedsBootstrap(false));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    const next: Errors = {};
    if (name.trim() === "") next.name = "Enter the admin name.";
    if (needsBootstrap && code.trim() === "") next.code = "Enter the setup code.";
    if (passphrase === "") next.passphrase = "Enter a passphrase.";
    else if (needsBootstrap && passphrase.length < minPassphrase)
      next.passphrase = `Use at least ${minPassphrase} characters.`;
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    if (needsBootstrap) {
      await run(() =>
        api.bootstrap({ name: name.trim(), passphrase, code: code.trim() }),
      );
      // The code is single-use, so the next step is a normal sign-in.
      setNeedsBootstrap(false);
      setPassphrase("");
      setCode("");
      return;
    }
    await run(async () => {
      await onSignIn(name.trim(), passphrase);
      return {};
    });
  };

  return (
    <div className={needsBootstrap ? "zv-acct zv-acct--setup" : "zv-acct zv-acct--solo"}>
      <Card>
        <form
          ref={formRef}
          className="zv-form"
          onSubmit={(e) => void handleSubmit(e)}
          noValidate
        >
          <h1 className="zv-acct-title">
            {needsBootstrap ? "Set up this computer" : "Admin sign in"}
          </h1>

          {error && (
            <Alert
              type="error"
              title={needsBootstrap ? "Setup failed" : "Sign in failed"}
              message={error}
            />
          )}

          <Field
            label="Admin name"
            required
            placeholder="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="username"
            disabled={loading}
            error={errors.name}
          />

          {needsBootstrap && (
            <Field
              label="Setup code"
              required
              placeholder="7F3K-29QX"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              controlClassName="zv-mono"
              autoComplete="off"
              disabled={loading}
              hint="Shown in the terminal where you started ZetaVote."
              error={errors.code}
            />
          )}

          <Field
            label="Passphrase"
            required
            type="password"
            revealable
            placeholder={
              needsBootstrap
                ? `At least ${minPassphrase} characters`
                : "Your admin passphrase"
            }
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            autoComplete={needsBootstrap ? "new-password" : "current-password"}
            disabled={loading}
            error={errors.passphrase}
          />

          <div className="zv-form-actions">
            <Button
              type="submit"
              variant="primary"
              shortcut="submit"
              isLoading={loading}
            >
              {needsBootstrap ? "Create admin account" : "Sign in"}
            </Button>
          </div>

          {!needsBootstrap && (
            <span className="zv-form-hint">
              Forgot the passphrase? The server cannot recover it. On the
              machine running ZetaVote, run
              <code> python run.py --reset-admin</code>.
            </span>
          )}
        </form>
      </Card>
      {needsBootstrap && <FrontDoor variant="next" />}
    </div>
  );
};

/**
 * A username and a passphrase. There is no faster path.
 *
 * The sealed key comes back from the server and is opened here, so the passphrase
 * is required on every sign-in, on every device. A private key cached in
 * localStorage would make this a formality, so the key is held in memory for this
 * tab and dropped on reload.
 */
const AccountSignIn: React.FC<{
  onSignIn: (
    username: string,
    sign: (challenge: string) => string,
  ) => Promise<void>;
  onCreate: () => void;
}> = ({ onSignIn, onCreate }) => {
  const [username, setUsername] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [wrongPassphrase, setWrongPassphrase] = useState(false);
  // Submit is never disabled. An empty field is named on submit, under the field.
  const [errors, setErrors] = useState<Errors>({});
  const formRef = useRef<HTMLFormElement>(null);
  useSubmitShortcut(formRef);

  const { loading, error, run } = useSubmit<Record<string, never>>();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    const next: Errors = {};
    if (username.trim() === "") next.username = "Enter your username.";
    if (passphrase === "") next.passphrase = "Enter your passphrase.";
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    const id = username.trim();
    setWrongPassphrase(false);

    await run(async () => {
      const { sealed_key } = await api.getSealedKey(id);
      let privateKey: string;
      try {
        privateKey = await openPrivateKey(sealed_key, passphrase);
      } catch {
        // AES-GCM cannot tell a wrong passphrase from a wrong ciphertext. The
        // account exists, so the action is to try again, not to hunt for a
        // forgotten username.
        setWrongPassphrase(true);
        throw new Error(
          `That is not the passphrase for ${id}. It is not stored anywhere the server can read, so there is no reset. Try again.`,
        );
      }
      holdAccountKey(privateKey);
      await onSignIn(id, (challenge) => signRaw(challenge, privateKey));
      return {};
    });
  };

  return (
    <div className="zv-acct">
      <Card>
        <form
          ref={formRef}
          className="zv-form"
          onSubmit={(e) => void handleSubmit(e)}
          noValidate
        >
          <div>
            <h1 className="zv-acct-title">Sign in</h1>
            <p className="zv-acct-sub">Everything stays on this computer.</p>
          </div>

          {error && (
            <Alert
              type="error"
              title={wrongPassphrase ? "Wrong passphrase" : "Sign in failed"}
              message={error}
            />
          )}

          <Field
            label="Username"
            required
            placeholder="asharao0142"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            controlClassName="zv-mono"
            autoComplete="username"
            disabled={loading}
            hint="Your name plus four digits, for example asharao0142."
            error={errors.username}
          />

          <Field
            label="Passphrase"
            required
            type="password"
            revealable
            placeholder="The one you chose when registering"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            autoComplete="current-password"
            disabled={loading}
            error={errors.passphrase}
          />

          <div className="zv-form-actions">
            <Button
              type="submit"
              variant="primary"
              shortcut="submit"
              isLoading={loading}
            >
              Sign in
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={onCreate}
              disabled={loading}
            >
              Create account
            </Button>
          </div>

          <span className="zv-form-hint">
            Your passphrase opens your key in this browser. It is never sent.
          </span>
        </form>
      </Card>
      <FrontDoor variant="trust" />
    </div>
  );
};

/**
 * Create the one account a person has, for life.
 *
 * The username is derived from the legal name on the server and the four digits
 * are the person's own, because `Asha Rao` and `A Sha Rao` both reduce to
 * `asharao`. A taken username is answered with alternatives, never a refusal.
 */
const RegisterAccount: React.FC<{
  onSignIn: (
    username: string,
    sign: (challenge: string) => string,
  ) => Promise<void>;
  minPassphrase: number;
  onBack: () => void;
}> = ({ onSignIn, minPassphrase, onBack }) => {
  const [name, setName] = useState("");
  const [dob, setDob] = useState("");
  const [digits, setDigits] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [check, setCheck] = useState<{
    username: string;
    available: boolean;
    suggestions: string[];
  } | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  useSubmitShortcut(formRef);

  const { loading, error, run } = useSubmit<{ username: string }>();

  // Ask the server what this name plus these digits produces, rather than
  // reimplementing the slug rule here and letting the two drift.
  useEffect(() => {
    if (name.trim() === "" || !/^\d{4}$/.test(digits)) {
      setCheck(null);
      return;
    }
    let current = true;
    const timer = setTimeout(() => {
      void api
        .checkUsername(name.trim(), digits)
        .then((answer) => current && setCheck(answer))
        .catch(() => current && setCheck(null));
    }, 250);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [name, digits]);

  const digitsOk = /^\d{4}$/.test(digits);
  const taken = check !== null && !check.available;
  const mismatch = confirm !== "" && confirm !== passphrase;
  const matches = confirm !== "" && confirm === passphrase;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    const next: Errors = {};
    if (name.trim() === "") next.name = "Enter your legal name.";
    if (dob === "") next.dob = "Enter your date of birth.";
    if (!digitsOk) next.digits = "Enter exactly four digits.";
    else if (taken)
      next.digits = `${check?.username} is taken. Try ${check?.suggestions.join(", ")}.`;
    else if (!check?.available)
      next.digits = "Could not check this username yet. Try again in a moment.";
    if (passphrase.length < minPassphrase)
      next.passphrase = `Use at least ${minPassphrase} characters.`;
    if (confirm === "") next.confirm = "Type the passphrase again.";
    else if (confirm !== passphrase) next.confirm = "The two do not match.";
    setErrors(next);
    if (Object.keys(next).length > 0 || !check?.available) return;

    await run(async () => {
      const keys = generateKeys();
      const sealedKey = await sealPrivateKey(keys.privateKey, passphrase);
      await api.createAccount({
        username: check.username,
        name: name.trim(),
        dob,
        public_key: keys.publicKey,
        sealed_key: sealedKey,
      });
      // Held in memory so this tab can join an election straight away. It is
      // never written to storage, so the next visit asks for the passphrase.
      holdAccountKey(keys.privateKey);
      await onSignIn(check.username, (challenge) =>
        signRaw(challenge, keys.privateKey),
      );
      return { username: check.username };
    });
  };

  return (
    <form
      ref={formRef}
      className="zv-acct-register"
      onSubmit={(e) => void handleSubmit(e)}
      noValidate
    >
      <div className="zv-acct-head">
        <h1 className="zv-acct-title">Create account</h1>
        <Button type="button" variant="ghost" size="sm" onClick={onBack}>
          Back to sign in
        </Button>
      </div>

      {error && <Alert type="error" title="Registration failed" message={error} />}

      <div className="zv-acct-groups">
        <Card>
          <div className="zv-form">
            <h2 className="zv-acct-group">About you</h2>
            <Field
              label="Legal name"
              required
              placeholder="Asha Rao"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              disabled={loading}
              error={errors.name}
            />
            <Field
              label="Date of birth"
              required
              type="date"
              value={dob}
              onChange={(e) => setDob(e.target.value)}
              autoComplete="bday"
              disabled={loading}
              hint="Checked for age, then discarded. Never stored."
              error={errors.dob}
            />
            <Field
              label="Four digits"
              required
              inputMode="numeric"
              maxLength={4}
              placeholder="0142"
              value={digits}
              onChange={(e) =>
                setDigits(e.target.value.replace(/\D/g, "").slice(0, 4))
              }
              controlClassName="zv-mono"
              autoComplete="off"
              disabled={loading}
              hint="Two people can share a name, so you choose the last four."
              error={
                errors.digits ??
                (taken
                  ? `${check?.username} is taken. Try ${check?.suggestions.join(", ")}.`
                  : undefined)
              }
            />
            <Field
              label="Your username"
              readOnly
              tabIndex={-1}
              value={check?.available ? check.username : ""}
              placeholder="asharao0142"
              controlClassName="zv-mono"
              hint="Made from your name. Write it down."
            />
          </div>
        </Card>

        <Card>
          <div className="zv-form">
            <h2 className="zv-acct-group">Passphrase</h2>
            <Field
              label="Passphrase"
              required
              type="password"
              revealable
              placeholder={`At least ${minPassphrase} characters`}
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              autoComplete="new-password"
              disabled={loading}
              error={
                errors.passphrase ??
                (passphrase !== "" && passphrase.length < minPassphrase
                  ? `Use at least ${minPassphrase} characters.`
                  : undefined)
              }
            />
            <div className={matches ? "zv-acct-match" : undefined}>
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
                hint={matches ? "\u2713 Matches" : undefined}
                error={
                  mismatch ? "The two do not match." : errors.confirm
                }
              />
            </div>
            <Alert
              type="warning"
              title="Nobody can reset it"
              message="If you forget your passphrase, nobody can reset it. Not even the admin. Write it down before you continue."
              live={false}
            />
            <div className="zv-form-actions">
              <Button
                type="submit"
                variant="primary"
                shortcut="submit"
                isLoading={loading}
              >
                Create account
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </form>
  );
};
