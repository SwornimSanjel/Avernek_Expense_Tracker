"use client";

import { useEffect, useState } from "react";
import Icon from "@/components/Icons";
import { AnimatePresence, motion } from "framer-motion";

export default function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    const saved = (localStorage.getItem("avernek-theme") as "dark" | "light") || "dark";
    setTheme(saved);
    document.documentElement.dataset.theme = saved;
  }, []);

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.classList.add("theme-transition");
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("avernek-theme", next);
    } catch {}
    window.setTimeout(() => document.documentElement.classList.remove("theme-transition"), 260);
  }

  const label = theme === "dark" ? "Switch to light mode" : "Switch to dark mode";

  return (
    <button type="button" onClick={toggle} className={compact ? "sb-mini-btn" : "btn"} aria-label={label} title={label}>
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={theme}
          className="inline-grid"
          initial={{ opacity: 0, rotate: -35, scale: 0.75 }}
          animate={{ opacity: 1, rotate: 0, scale: 1 }}
          exit={{ opacity: 0, rotate: 35, scale: 0.75 }}
          transition={{ duration: 0.18 }}
        >
          <Icon name={theme === "dark" ? "sun" : "moon"} size={15} />
        </motion.span>
      </AnimatePresence>
      {!compact && <span>{theme === "dark" ? "Light" : "Dark"}</span>}
    </button>
  );
}
