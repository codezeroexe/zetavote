import React, { useEffect, useState } from "react";
import { api } from "../../services/api";
import { useSubmit } from "../../hooks/useSubmit";
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

  const headings: Record<EntryMode, { title: string; note: string }> = {
    signin: {
      title: role === "admin" ? "Admin sign in" : "Sign in to vote",
      note: "Secure local voting. Nothing leaves this machine.",
    },
    register: {
      title: "Create your account",
      note: "One account per person, for life. Each election is joined separately.",
    },
  };
  const heading = headings[mode];

  return (
    // Two columns: the record explained on the left, the way in on the right.
    // The form keeps its own 42rem measure inside the column — a sign-in form is
    // two short fields, and stretching it across 1,120px is how a form becomes a
    // wall — so this is the wide container with a narrow right half, not the
    // narrow container with a paragraph beside it.
    <div className="zv-page-container zv-entry">
      {/* The navbar drops the wordmark on this screen, so the page carries the
          lockup itself, once. It spans both columns rather than sitting inside
          the left one: on a phone the columns reorder and put the form first,
          and a wordmark below the form is a wordmark nobody sees. */}
      <FrontDoor title={heading.title} note={heading.note} />

      <div className="zv-entry-form">
        {/* Stated before anyone signs in, because it is the one claim about this
            software a person cannot check for themselves later. */}
        <Alert
          type="info"
          title="Prototype — not for real elections"
          message="ZetaVote is an academic proof-of-concept for local cryptographic voting. It is not intended for binding, governmental or commercial elections."
          live={false}
        />

        <section className="zv-admin-section">
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
        ) : (
          <>
            {/* A segmented switch, not a tab bar: this changes which form is
                below it rather than which view of one thing is showing. */}
            <div
              className="zv-segment"
              role="group"
              aria-label="Sign in or register"
            >
              {(
                [
                  ["signin", "Sign in"],
                  ["register", "Create account"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={mode === value}
                  className="zv-segment-option"
                  onClick={() => setMode(value)}
                >
                  {label}
                </button>
              ))}
            </div>

            {mode === "signin" ? (
              <AccountSignIn onSignIn={signInAsAccount} />
            ) : (
              <RegisterAccount
                onSignIn={signInAsAccount}
                minPassphrase={minPassphrase}
              />
            )}
          </>
        )}
      </section>
      </div>
    </div>
  );
};

/** Admin credentials are a normal login: a name, a verifier and a passphrase. */
const AdminSignIn: React.FC<{
  onSignIn: (name: string, passphrase: string) => Promise<void>;
  minPassphrase: number;
}> = ({ onSignIn, minPassphrase }) => {
  const [name, setName] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [needsBootstrap, setNeedsBootstrap] = useState(false);
  const [code, setCode] = useState("");

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

  const ready = needsBootstrap
    ? name.trim() !== "" &&
      passphrase.length >= minPassphrase &&
      code.trim() !== ""
    : name.trim() !== "" && passphrase !== "";

  return (
    <Card>
      <form className="zv-form" onSubmit={(e) => void handleSubmit(e)} noValidate>
        {error && (
          <Alert
            type="error"
            title={needsBootstrap ? "Setup Failed" : "Sign In Failed"}
            message={error}
          />
        )}

        {needsBootstrap && (
          <Alert
            type="info"
            title="First run — set up the admin account"
            message="There is no admin account on this machine yet. The one-time code was printed in the terminal running the server; copy it in below."
          />
        )}

        <Field
          label="Admin Name"
          required
          placeholder="Your name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="username"
          disabled={loading}
        />

        {needsBootstrap && (
          <Field
            label="First-Run Code"
            required
            placeholder="Printed in the server terminal"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            controlClassName="zv-mono"
            autoComplete="off"
            disabled={loading}
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
          autoComplete="current-password"
          disabled={loading}
          error={
            passphrase !== "" &&
            needsBootstrap &&
            passphrase.length < minPassphrase
              ? `Must be at least ${minPassphrase} characters`
              : undefined
          }
        />

        <div className="zv-form-actions">
          <Button
            type="submit"
            variant="primary"
            isLoading={loading}
            disabled={!ready}
          >
            {needsBootstrap ? "Create Admin Account" : "Sign In"}
          </Button>
        </div>

        {!needsBootstrap && (
          <span className="zv-form-hint">
            Forgotten the passphrase? It cannot be recovered from the server.
            Reset it from the machine running the server with
            <code> python run.py --reset-admin</code>.
          </span>
        )}
      </form>
    </Card>
  );
};

/**
 * A username and a passphrase. There is no faster path.
 *
 * The sealed key comes back from the server and is opened here, so the passphrase
 * is required on every sign-in, on every device — which is the point. A private
 * key cached in localStorage would make this a formality: anything able to read
 * the page's storage could then sign a login challenge without ever knowing the
 * passphrase. The key is held in memory for this tab and dropped on reload.
 */
const AccountSignIn: React.FC<{
  onSignIn: (
    username: string,
    sign: (challenge: string) => string,
  ) => Promise<void>;
}> = ({ onSignIn }) => {
  const [username, setUsername] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [wrongPassphrase, setWrongPassphrase] = useState(false);

  const { loading, error, run } = useSubmit<Record<string, never>>();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading || username.trim() === "" || passphrase === "") return;
    const id = username.trim();
    setWrongPassphrase(false);

    await run(async () => {
      const { sealed_key } = await api.getSealedKey(id);
      let privateKey: string;
      try {
        privateKey = await openPrivateKey(sealed_key, passphrase);
      } catch {
        // AES-GCM cannot tell a wrong passphrase from a wrong ciphertext, and
        // the raw message is a bare "Unsupported state or unable to authenticate
        // data". The account exists — this is the one error in the app that is
        // worth separating out, because the action is to try again rather than to
        // go looking for a forgotten username.
        setWrongPassphrase(true);
        throw new Error(
          `That is not the passphrase for ${id}. It is not stored anywhere the server can read, so there is no reset — try again.`,
        );
      }
      holdAccountKey(privateKey);
      await onSignIn(id, (challenge) => signRaw(challenge, privateKey));
      return {};
    });
  };

  return (
    <Card>
      <form className="zv-form" onSubmit={(e) => void handleSubmit(e)} noValidate>
        {error && (
          <Alert
            type="error"
            title={wrongPassphrase ? "Wrong Passphrase" : "Sign In Failed"}
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
          hint="Your name and four digits. Case matters — Asha0142 is not asha0142. Write it down somewhere: it cannot be recovered."
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
          hint="Required every time, on every device. It opens your sealed key here in this browser and is never sent."
        />

        <div className="zv-form-actions">
          <Button
            type="submit"
            variant="primary"
            isLoading={loading}
            disabled={username.trim() === "" || passphrase === ""}
          >
            Sign In
          </Button>
        </div>

        <span className="zv-form-hint">
          One account per person, for life. Each election is joined separately,
          and the ballot key for one is never used in another.
        </span>
      </form>
    </Card>
  );
};

/**
 * Create the one account a person has, for life.
 *
 * The username is derived from the legal name on the server and the four digits
 * are the person's own, because `Asha Rao` and `A Sha Rao` both reduce to
 * `asharao`. A taken username is answered with alternatives, never a refusal:
 * the digits exist precisely because two people can share a name.
 */
const RegisterAccount: React.FC<{
  onSignIn: (
    username: string,
    sign: (challenge: string) => string,
  ) => Promise<void>;
  minPassphrase: number;
}> = ({ onSignIn, minPassphrase }) => {
  const [name, setName] = useState("");
  const [dob, setDob] = useState("");
  const [digits, setDigits] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [check, setCheck] = useState<{
    username: string;
    available: boolean;
    suggestions: string[];
  } | null>(null);

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading || !check?.available) return;

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
      // Held in memory so this tab can enrol straight away. It is never written
      // to storage, so the next visit asks for the passphrase again.
      holdAccountKey(keys.privateKey);
      await onSignIn(check.username, (challenge) =>
        signRaw(challenge, keys.privateKey),
      );
      return { username: check.username };
    });
  };

  const digitsOk = /^\d{4}$/.test(digits);
  const ready =
    name.trim() !== "" &&
    dob !== "" &&
    digitsOk &&
    passphrase.length >= minPassphrase &&
    confirm === passphrase;
  const taken = check !== null && !check.available;
  const mismatch = confirm !== "" && confirm !== passphrase;

  return (
    <Card>
      <form className="zv-form" onSubmit={(e) => void handleSubmit(e)} noValidate>
        {error && (
          <Alert type="error" title="Registration Failed" message={error} />
        )}

        {/* Said before the field, not after the fact. This is the one account a
            person gets, and neither the username nor the passphrase can be
            recovered: the server holds only a one-way name hash and a sealed key
            it has no key for. */}
        <Alert
          type="warning"
          title="Two things you cannot get back"
          message="Your username and your passphrase are not stored in a recoverable form — the server keeps a hash of your name and an encrypted key it cannot open. Write both down before you continue."
        />

        <Field
          label="Full Name"
          required
          placeholder="Asha Rao"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="name"
          disabled={loading}
          hint="Used to build your username and to match the eligible list. Never stored."
        />

        <Field
          label="Date of Birth"
          required
          type="date"
          value={dob}
          onChange={(e) => setDob(e.target.value)}
          autoComplete="bday"
          disabled={loading}
          hint="Eligibility only. Hashed, never stored, never a credential."
        />

        <Field
          label="Four Digits"
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
          error={digits !== "" && !digitsOk ? "Exactly four digits" : undefined}
          hint={
            taken
              ? `${check?.username} is taken — try ${check?.suggestions.join(", ")}`
              : check?.username
                ? `Your username will be ${check.username}`
                : "Two people can share a name, so you choose the last four."
          }
        />

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
            passphrase !== "" && passphrase.length < minPassphrase
              ? `Must be at least ${minPassphrase} characters`
              : undefined
          }
          hint="Seals your key on the server. The server never sees it — signing in opens the key here."
        />

        <Field
          label="Confirm Passphrase"
          required
          type="password"
          revealable
          placeholder="Type it again"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          disabled={loading}
          error={mismatch ? "The two do not match" : undefined}
        />

        <div className="zv-form-actions">
          <Button
            type="submit"
            variant="primary"
            isLoading={loading}
            disabled={!ready || !check?.available}
          >
            Create Account
          </Button>
        </div>
      </form>
    </Card>
  );
};
