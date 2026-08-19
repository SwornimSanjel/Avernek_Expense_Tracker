"use client";

import { useActionState, useEffect, useState } from "react";
import { signIn, type LoginState } from "./actions";
import { LogoWord } from "@/components/Logo";
import Icon from "@/components/Icons";

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
    <main className="min-h-screen grid lg:grid-cols-2">
      <section className="hidden lg:flex relative overflow-hidden flex-col justify-between p-12" style={{ borderRight: "1px solid var(--line)", background: "linear-gradient(145deg, rgb(139 92 246 / .12), transparent 54%)" }}>
        <LogoWord />
        <div className="max-w-lg">
          <div className="eyebrow"><Icon name="sparkles" size={12} /> Private finance workspace</div>
          <h1 className="text-5xl font-bold tracking-[-.05em] leading-[1.05]">Every rupee.<br />Every agreement.<br /><span style={{ color: "#9a6bff" }}>One clear view.</span></h1>
          <p className="muted mt-5 max-w-md leading-relaxed">Avernek’s internal workspace for expenses, client revenue, subscriptions, and team contributions.</p>
        </div>
        <div className="text-xs muted">Avernek Technologies · Internal use only</div>
      </section>

      <section className="flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md card p-7 md:p-9">
        <div className="mb-8 lg:hidden">
          <LogoWord />
        </div>
        <div className="mb-7">
          <div className="eyebrow">Secure access</div>
          <h2 className="text-2xl font-bold tracking-tight">Welcome back</h2>
          <p className="muted text-sm mt-1">Sign in to the Avernek finance workspace.</p>
        </div>

        <form action={formAction} className="space-y-3">
          <input type="hidden" name="next" value={next} />

          <label className="field-label">Email address
          <input
            type="email"
            name="email"
            required
            autoComplete="username"
            autoFocus
            placeholder="you@avernek.com" className="input mt-1.5" />
          </label>

          <label className="field-label">Password
          <input
            type="password"
            name="password"
            required
            autoComplete="current-password"
            placeholder="Your password" className="input mt-1.5" />
          </label>

          <button
            type="submit"
            disabled={pending}
            className="btn btn-primary w-full !h-12 mt-2"
          >
            {pending ? "Signing in…" : "Sign in"}
          </button>
        </form>

        {state.error && (
          <p className="alert alert-error mt-3" role="alert">
            {state.error}
          </p>
        )}

        <p className="muted text-xs mt-6">
          Accounts are created by an administrator. Ask them for access or a
          password reset.
        </p>
      </div>
      </section>
    </main>
  );
}
