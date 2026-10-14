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
    localStorage.setItem("avernek-theme", next);
    window.setTimeout(() => document.documentElement.classList.remove("theme-transition"), 260);
  }

  return (
    <button type="button" onClick={toggle} className={compact ? "icon-btn !w-9 !h-9" : "btn"}
      aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}>
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={theme}
          className="inline-grid"
          initial={{ opacity: 0, rotate: -35, scale: 0.75 }}
          animate={{ opacity: 1, rotate: 0, scale: 1 }}
          exit={{ opacity: 0, rotate: 35, scale: 0.75 }}
          transition={{ duration: 0.18 }}
        >
          <Icon name={theme === "dark" ? "sun" : "moon"} size={16} />
        </motion.span>
      </AnimatePresence>
      {!compact && <span>{theme === "dark" ? "Light" : "Dark"}</span>}
    </button>
  );
}
