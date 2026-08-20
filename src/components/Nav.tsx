"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "@/app/login/actions";
import Icon, { type IconName } from "@/components/Icons";
import { LogoWord } from "@/components/Logo";
import ThemeToggle from "@/components/ThemeToggle";
import { motion } from "framer-motion";

const items: { href: string; label: string; short: string; icon: IconName }[] = [
  { href: "/", label: "Overview", short: "Home", icon: "home" },
  { href: "/expenses", label: "Expenses", short: "Spend", icon: "expense" },
  { href: "/income", label: "Income", short: "Income", icon: "income" },
  { href: "/clients", label: "Clients", short: "Clients", icon: "users" },
  { href: "/funds", label: "Company money", short: "Funds", icon: "wallet" },
  { href: "/subscriptions", label: "Subscriptions", short: "Subs", icon: "subscription" },
  { href: "/settlements", label: "Contributions", short: "Team", icon: "contribution" },
  { href: "/settings", label: "Settings", short: "Settings", icon: "settings" },
];

export default function Nav({ name, isAdmin }: { name: string; isAdmin: boolean }) {
  const path = usePathname();
  const active = (href: string) => href === "/" ? path === "/" : path.startsWith(href);
  const firstName = name.split(" ")[0];
  const initials = name.split(" ").filter(Boolean).slice(0, 2)
    .map((part) => part[0]?.toUpperCase()).join("");

  return (
    <>
      <aside className="sidebar hidden md:flex md:flex-col w-[272px] shrink-0 h-screen sticky top-0 px-4 py-5">
        <div className="px-2 pb-7">
          <LogoWord />
          <div className="mt-2 ml-[38px] text-[10px] uppercase tracking-[0.16em]" style={{ color: "var(--muted-2)" }}>
            Finance workspace
          </div>
        </div>

        <nav className="flex-1 min-h-0 overflow-y-auto">
          <div className="nav-section-label mb-2">Workspace</div>
          <div className="space-y-1">
            {items.slice(0, 6).map((item) => (
              <NavLink key={item.href} item={item} active={active(item.href)} />
            ))}
          </div>
          <div className="nav-section-label mt-7 mb-2">Organisation</div>
          <div className="space-y-1">
            {items.slice(6).map((item) => (
              <NavLink key={item.href} item={item} active={active(item.href)} />
            ))}
          </div>
        </nav>

        <div className="space-y-3 pt-4 mt-4" style={{ borderTop: "1px solid var(--line)" }}>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.12em] muted">Appearance</span>
            <ThemeToggle compact />
          </div>
          <div className="user-chip">
            <div className="avatar">{initials || "A"}</div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-semibold">{name}</div>
              <div className="text-[11px] muted">{isAdmin ? "Administrator" : "View only"}</div>
            </div>
            <form action={signOut}>
              <button type="submit" className="icon-btn !w-8 !h-8" title="Sign out" aria-label="Sign out">
                <Icon name="arrow" size={15} />
              </button>
            </form>
          </div>
        </div>
      </aside>

      <header className="mobile-topbar md:hidden fixed top-0 inset-x-0 z-40 h-16 flex items-center justify-between px-4" style={{ borderBottom: "1px solid var(--line)" }}>
        <LogoWord />
        <div className="flex items-center gap-2">
          <span className="text-[11px] muted">{firstName}</span>
          <ThemeToggle compact />
        </div>
      </header>

      <nav className="mobile-bottom-nav md:hidden fixed bottom-0 inset-x-0 z-40 grid grid-cols-8 h-[68px]" style={{ borderTop: "1px solid var(--line)" }}>
        {items.map((item) => (
          <Link key={item.href} href={item.href} className={`mobile-nav-item ${active(item.href) ? "mobile-nav-item-active" : ""}`}>
            <Icon name={item.icon} size={18} strokeWidth={active(item.href) ? 2.2 : 1.8} />
            <span className="truncate max-w-full px-1">{item.short}</span>
          </Link>
        ))}
      </nav>
    </>
  );
}

function NavLink({ item, active }: { item: { href: string; label: string; icon: IconName }; active: boolean }) {
  return (
    <motion.div whileHover={{ x: 2 }} whileTap={{ scale: 0.985 }} transition={{ duration: 0.16 }}>
      <Link href={item.href} className={`nav-item ${active ? "nav-item-active" : ""}`}>
        {active && <motion.span layoutId="desktop-nav-active" className="nav-active-rail" transition={{ type: "spring", stiffness: 430, damping: 34 }} />}
        <span className="nav-icon"><Icon name={item.icon} size={17} strokeWidth={active ? 2.1 : 1.75} /></span>
        <span>{item.label}</span>
      </Link>
    </motion.div>
  );
}
