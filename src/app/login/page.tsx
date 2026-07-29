"use client";

import { useActionState, useEffect, useState } from "react";
import { signIn, type LoginState } from "./actions";
import { LogoWord } from "@/components/Logo";

const initialState: LoginState = { error: null };

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(signIn, initialState);

  // Middleware puts the originally requested path in ?next= so sign-in returns
  // there. Read from location rather than useSearchParams() to keep this page
  // statically prerenderable without a Suspense boundary.
  const [next, setNext] = useState("/");
  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get("next");
    if (raw && raw.startsWith("/") && !raw.startsWith("//")) setNext(raw);
  }, []);

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm card p-8">
        <div className="mb-8">
          <LogoWord />
          <h1 className="text-xl font-bold mt-4">Expense Tracker</h1>
          <p className="muted text-sm mt-1">Internal tool · team sign-in</p>
        </div>

        <form action={formAction} className="space-y-3">
          <input type="hidden" name="next" value={next} />

          <input
            type="email"
            name="email"
            required
            autoComplete="username"
            autoFocus
            placeholder="you@avernek.com"
            className="input"
          />

          <input
            type="password"
            name="password"
            required
            autoComplete="current-password"
            placeholder="Password"
            className="input"
          />

          <button
            type="submit"
            disabled={pending}
            className="btn btn-primary w-full"
          >
            {pending ? "Signing in…" : "Sign in"}
          </button>
        </form>

        {state.error && (
          <p className="text-sm mt-3" style={{ color: "var(--red)" }} role="alert">
            {state.error}
          </p>
        )}

        <p className="muted text-xs mt-6">
          Accounts are created by an administrator. Ask them for access or a
          password reset.
        </p>
      </div>
    </main>
  );
}
