/**
 * The sign-in / create-account screen, shown only when the server has tenancy
 * enabled and no session is present. A single editorial card on the sunken
 * build-workbench surface — deliberately not a generic centered form.
 */
import { useState, type FormEvent } from "react";
import type { ApiClient } from "../../lib/api.js";
import "./auth.css";

type Mode = "login" | "signup";

interface AuthScreenProps {
  readonly api: ApiClient;
  /** Called after a successful login/signup so the gate re-probes the session. */
  readonly onAuthed: () => void;
}

export function AuthScreen({ api, onAuthed }: AuthScreenProps) {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(undefined);
    setBusy(true);
    try {
      if (mode === "signup") await api.signup(email.trim(), password);
      else await api.login(email.trim(), password);
      onAuthed();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setBusy(false);
    }
  }

  const isSignup = mode === "signup";

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-brand">
          <span className="auth-mark">md</span>
          <span className="auth-wordmark">Makedown</span>
        </div>
        <h1 className="auth-title">{isSignup ? "Create your account" : "Sign in"}</h1>
        <p className="auth-sub">
          {isSignup
            ? "Start a team workspace — your build graph, collaboratively."
            : "Welcome back to your build workbench."}
        </p>

        <form className="auth-form" onSubmit={submit}>
          <label className="auth-field">
            <span>Email</span>
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </label>
          <label className="auth-field">
            <span>Password</span>
            <input
              type="password"
              autoComplete={isSignup ? "new-password" : "current-password"}
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={isSignup ? "At least 8 characters" : "••••••••"}
            />
          </label>

          {error && (
            <p className="auth-error" role="alert">
              {error}
            </p>
          )}

          <button className="auth-submit" type="submit" disabled={busy}>
            {busy ? "…" : isSignup ? "Create account" : "Sign in"}
          </button>
        </form>

        <p className="auth-switch">
          {isSignup ? "Already have an account?" : "New to Makedown?"}{" "}
          <button
            type="button"
            className="auth-link"
            onClick={() => {
              setMode(isSignup ? "login" : "signup");
              setError(undefined);
            }}
          >
            {isSignup ? "Sign in" : "Create one"}
          </button>
        </p>
      </div>
    </div>
  );
}
