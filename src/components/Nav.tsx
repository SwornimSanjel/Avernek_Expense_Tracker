"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { signOut } from "@/app/login/actions";
import Icon, { type IconName } from "@/components/Icons";
import { LogoMark } from "@/components/Logo";
import ThemeToggle from "@/components/ThemeToggle";
import { displayName, initialsOf } from "@/lib/people";

type Item = { href: string; label: string; short: string; icon: IconName };

const groups: { label: string | null; items: Item[] }[] = [
  {
    label: null,
    items: [
      { href: "/", label: "Overview", short: "Home", icon: "home" },
      { href: "/statement", label: "Statement", short: "Statement", icon: "statement" },
    ],
  },
  {
    label: "Money",
    items: [
      { href: "/expenses", label: "Expenses", short: "Spend", icon: "expense" },
      { href: "/income", label: "Income", short: "Income", icon: "income" },
      { href: "/funds", label: "Company money", short: "Accounts", icon: "wallet" },
      { href: "/vat", label: "VAT & bills", short: "VAT", icon: "receipt" },
      { href: "/subscriptions", label: "Subscriptions", short: "Subs", icon: "subscription" },
    ],
  },
  {
    label: "People",
    items: [
      { href: "/clients", label: "Clients", short: "Clients", icon: "users" },
      { href: "/settlements", label: "Contributions", short: "Partners", icon: "contribution" },
    ],
  },
];

const allItems = [...groups.flatMap((group) => group.items), { href: "/settings", label: "Settings", short: "Settings", icon: "settings" as IconName }];

export default function Nav({ name, isAdmin }: { name: string; isAdmin: boolean }) {
  const path = usePathname();
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  const shown = displayName(name);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setCollapsed(document.documentElement.dataset.sidebar === "collapsed");
  }, []);

  const toggle = useCallback(() => {
    setCollapsed((current) => {
      const next = !current;
      const root = document.documentElement;
      if (next) root.dataset.sidebar = "collapsed";
      else delete root.dataset.sidebar;
      try {
        localStorage.setItem("avernek-sidebar", next ? "collapsed" : "expanded");
      } catch {}
      return next;
    });
  }, []);

  // ⌘B / Ctrl+B toggles the sidebar, like most desktop tools.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "b") {
        const target = event.target as HTMLElement | null;
        if (target && /input|textarea|select/i.test(target.tagName)) return;
        event.preventDefault();
        toggle();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  return (
    <>
      <aside className="sidebar" aria-label="Main navigation">
        <div className="sb-top">
          <Link href="/" className="sb-brand" aria-label="Avernek overview">
            <LogoMark size={28} />
            <span className="logo-text">Avernek</span>
          </Link>
          <button
            type="button"
            onClick={toggle}
            className="sb-toggle"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={`${collapsed ? "Expand" : "Collapse"} sidebar (⌘B)`}
          >
            <Icon name="sidebar" size={17} />
          </button>
        </div>

        <nav className="sb-scroll">
          {groups.map((group, index) => (
            <div key={index} className="sb-group">
              {group.label && <div className="sb-group-label">{group.label}</div>}
              {group.items.map((item) => (
                <NavLink key={item.href} item={item} active={active(item.href)} />
              ))}
            </div>
          ))}
        </nav>

        <div className="sb-foot">
          <NavLink item={allItems[allItems.length - 1]} active={active("/settings")} />
          <div className="sb-user">
            <div className="avatar avatar-round !w-8 !h-8 !text-[12px]">{initialsOf(name)}</div>
            <div className="sb-user-text min-w-0 flex-1">
              <div className="sb-user-name">{shown}</div>
              <div className="sb-user-role">{isAdmin ? "Administrator" : "View only"}</div>
            </div>
            <div className="sb-foot-row flex items-center gap-0.5">
              <ThemeToggle compact />
              <form action={signOut} className="sb-hide-collapsed">
                <button type="submit" className="sb-mini-btn" title="Sign out" aria-label="Sign out">
                  <Icon name="logout" size={15} />
                </button>
              </form>
            </div>
          </div>
        </div>
      </aside>

      <header className="mobile-topbar md:hidden fixed top-0 inset-x-0 z-40 h-14 flex items-center justify-between px-4 border-b">
        <Link href="/" className="flex items-center gap-2">
          <LogoMark size={24} />
          <span className="logo-text !text-[16px]">Avernek</span>
        </Link>
        <div className="flex items-center gap-2">
          <span className="text-[13px] muted">{shown}</span>
          <ThemeToggle compact />
        </div>
      </header>

      <nav className="mobile-bottom-nav md:hidden fixed bottom-0 inset-x-0 z-40 h-[66px] border-t">
        {allItems.map((item) => (
          <Link key={item.href} href={item.href} className={`mobile-nav-item ${active(item.href) ? "mobile-nav-item-active" : ""}`}>
            <Icon name={item.icon} size={19} strokeWidth={active(item.href) ? 2.1 : 1.8} />
            <span className="truncate max-w-full px-1">{item.short}</span>
          </Link>
        ))}
      </nav>
    </>
  );
}

function NavLink({ item, active }: { item: Item; active: boolean }) {
  return (
    <Link href={item.href} className={`sb-link ${active ? "sb-link-active" : ""}`} aria-current={active ? "page" : undefined}>
      {active && (
        <motion.span
          layoutId="sidebar-active"
          className="sb-active-bg"
          transition={{ type: "spring", stiffness: 500, damping: 38 }}
        />
      )}
      <span className="sb-icon"><Icon name={item.icon} size={18} strokeWidth={active ? 2 : 1.75} /></span>
      <span className="sb-label">{item.label}</span>
      <span className="sb-tip">{item.label}</span>
    </Link>
  );
}
