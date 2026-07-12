"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { LogoWord } from "@/components/Logo";
import ThemeToggle from "@/components/ThemeToggle";

const items = [
  { href: "/", label: "Home" },
  { href: "/expenses", label: "Expenses" },
  { href: "/subscriptions", label: "Subs" },
  { href: "/settlements", label: "Balances" },
  { href: "/settings", label: "Settings" },
];

export default function Nav({ name }: { name: string }) {
  const path = usePathname();
  const router = useRouter();
  const active = (href: string) =>
    href === "/" ? path === "/" : path.startsWith(href);
  const firstName = name.split(" ")[0];

  async function signOut() {
    await createClient().auth.signOut();
    router.push("/login");
  }

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className="hidden md:flex md:flex-col w-60 shrink-0 h-screen sticky top-0 p-4"
        style={{ background: "var(--surface)", borderRight: "1px solid var(--line)" }}
      >
        <div className="px-2 py-3">
          <LogoWord />
        </div>
        <nav className="flex-1 mt-4 space-y-1">
          {items.map((it) => (
            <Link
              key={it.href}
              href={it.href}
              className="flex items-center px-3 h-10 rounded-lg text-sm transition"
              style={
                active(it.href)
                  ? { background: "var(--ink)", color: "var(--bg)", fontWeight: 600 }
                  : { color: "var(--muted)" }
              }
            >
              {it.label}
            </Link>
          ))}
        </nav>
        <div className="space-y-2 pt-3" style={{ borderTop: "1px solid var(--line)" }}>
          <ThemeToggle />
          <div className="px-1 text-sm muted truncate">Signed in as {firstName}</div>
          <button onClick={signOut} className="px-1 text-sm muted hover:underline">
            Sign out
          </button>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header
        className="md:hidden fixed top-0 inset-x-0 z-40 h-14 flex items-center justify-between px-4"
        style={{ background: "var(--surface)", borderBottom: "1px solid var(--line)" }}
      >
        <LogoWord />
        <div className="flex items-center gap-2">
          <span className="text-xs muted">{firstName}</span>
          <ThemeToggle />
        </div>
      </header>

      {/* Mobile bottom bar */}
      <nav
        className="md:hidden fixed bottom-0 inset-x-0 z-40 grid grid-cols-5 h-16"
        style={{ background: "var(--surface)", borderTop: "1px solid var(--line)" }}
      >
        {items.map((it) => (
          <Link
            key={it.href}
            href={it.href}
            className="flex items-center justify-center text-[13px]"
            style={
              active(it.href)
                ? { color: "var(--ink)", fontWeight: 700 }
                : { color: "var(--muted)" }
            }
          >
            {it.label}
          </Link>
        ))}
      </nav>
    </>
  );
}
