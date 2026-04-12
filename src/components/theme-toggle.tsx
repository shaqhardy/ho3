"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { useTheme } from "@/components/theme-provider";

export function ThemeToggle({ className = "" }: { className?: string }) {
  const { theme, toggleTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const isDark = theme === "dark";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      title={isDark ? "Switch to light theme" : "Switch to dark theme"}
      className={`relative inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border-subtle text-muted transition-colors hover:border-border hover:bg-card-hover hover:text-foreground ${className}`}
    >
      {mounted ? (
        <span
          key={theme}
          className="theme-icon-enter inline-flex items-center justify-center"
        >
          {isDark ? (
            <Sun className="h-4 w-4" />
          ) : (
            <Moon className="h-4 w-4" />
          )}
        </span>
      ) : (
        // Placeholder matching size to avoid layout shift pre-hydration.
        <span className="inline-block h-4 w-4" />
      )}
    </button>
  );
}
