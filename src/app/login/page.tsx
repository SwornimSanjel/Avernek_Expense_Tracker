"use client";

import { useActionState, useEffect, useState } from "react";
import { signIn, type LoginState } from "./actions";
import { LogoMark, LogoWord } from "@/components/Logo";

const initialState: LoginState = { error: null };

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(signIn, initialState);

  // Middleware puts the originally requested path in ?next= so sign-in returns
  // there. Read from location rather than useSearchParams() to keep this page
  // statically prerenderable without a Suspense boundary.
  const [next, setNext] = useState("/");
  const [removed, setRemoved] = useState(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("next");
    if (raw && raw.startsWith("/") && !raw.startsWith("//")) setNext(raw);
    // Sent here by /signed-out after an administrator removed this account.
    setRemoved(params.get("removed") === "1");
  }, []);

  return (
    <main className="min-h-screen grid lg:grid-cols-2">
      <section className="hidden lg:flex relative overflow-hidden flex-col justify-between p-12 border-r dot-pattern" style={{ background: "radial-gradient(ellipse at 20% 0%, rgb(139 92 246 / .16), transparent 60%)" }}>
        <LogoWord />
        <div className="max-w-lg">
          <LogoMark size={64} />
          <h1 className="mt-8 text-[44px] font-semibold tracking-[-.035em] leading-[1.08]">Every rupee.<br />Every client.<br /><span style={{ color: "#a274ff" }}>One clear view.</span></h1>
          <p className="muted mt-5 max-w-md text-[15px] leading-relaxed">Avernek&apos;s finance workspace for expenses, client income, company accounts, VAT and partner investment.</p>
        </div>
        <div className="text-[13px] muted">Avernek Technologies · Internal use only</div>
      </section>

      <section className="flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md card p-7 md:p-9">
        <div className="mb-8 lg:hidden">
          <LogoWord />
        </div>
        <div className="mb-7">
          <h2 className="text-[26px] font-semibold tracking-tight">Welcome back</h2>
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

        {state.error ? (
          <p className="alert alert-error mt-3" role="alert">
            {state.error}
          </p>
        ) : removed ? (
          <p className="alert alert-warn mt-3" role="status">
            You were signed out because this account&apos;s access was removed.
          </p>
        ) : null}

        <p className="muted text-[13px] mt-6">
          Accounts are created by an administrator. Ask them for access or a
          password reset.
        </p>
      </div>
      </section>
    </main>
  );
}
