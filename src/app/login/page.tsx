"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { LogoWord } from "@/components/Logo";

function authErrorMessage(error: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "object" &&
          error !== null &&
          "message" in error &&
          typeof error.message === "string"
        ? error.message
        : "";

  if (
    message.toLowerCase().includes("failed to fetch") ||
    message.toLowerCase().includes("network")
  ) {
    return "The sign-in service is unreachable. Ask the administrator to check the Supabase project URL and redeploy the site.";
  }

  return message || "Sign-in failed. Please try again.";
}

export default function LoginPage() {
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function signInWithGoogle() {
    setError(null);
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${location.origin}/auth/callback` },
      });
      if (error) setError(authErrorMessage(error));
    } catch (error) {
      setError(authErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }

  async function signInWithEmail(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: `${location.origin}/auth/callback` },
      });
      if (error) setError(authErrorMessage(error));
      else setSent(true);
    } catch (error) {
      setError(authErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm card p-8">
        <div className="mb-8">
          <LogoWord />
          <h1 className="text-xl font-bold mt-4">Expense Tracker</h1>
          <p className="muted text-sm mt-1">Internal tool · team sign-in</p>
        </div>

        {sent ? (
          <p className="text-sm">
            Check <span className="font-semibold">{email}</span> for a sign-in
            link.
          </p>
        ) : (
          <form onSubmit={signInWithEmail} className="space-y-3">
            <input
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@avernek.com"
              className="input"
            />
            <button type="submit" disabled={loading} className="btn btn-primary w-full">
              {loading ? "Sending…" : "Email me a sign-in link"}
            </button>
          </form>
        )}

        <div className="flex items-center gap-3 my-5 muted text-xs">
          <div className="h-px flex-1" style={{ background: "var(--line)" }} />
          OR
          <div className="h-px flex-1" style={{ background: "var(--line)" }} />
        </div>

        <button
          onClick={signInWithGoogle}
          disabled={loading}
          className="btn w-full"
        >
          {loading ? "Connecting…" : "Continue with Google"}
        </button>

        {error && (
          <p className="text-sm mt-3" style={{ color: "var(--red)" }}>
            {error}
          </p>
        )}
      </div>
    </main>
  );
}
