"use client";

import { useEffect, useState } from "react";
import {
  CASH_MODES,
  CASH_WINDOWS,
  type CashMode,
  type CashWindow,
} from "./types";

const WINDOW_KEY = "ho3.cashWindow";
const MODE_KEY = "ho3.cashMode";

export interface CashProjectionHeaderProps {
  window: CashWindow;
  mode: CashMode;
  onWindowChange: (w: CashWindow) => void;
  onModeChange: (m: CashMode) => void;
}

export function CashProjectionHeader({
  window: currentWindow,
  mode,
  onWindowChange,
  onModeChange,
}: CashProjectionHeaderProps) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    function handle() {
      setScrolled(window.scrollY > 24);
    }
    handle();
    window.addEventListener("scroll", handle, { passive: true });
    return () => window.removeEventListener("scroll", handle);
  }, []);

  return (
    <div
      className={`sticky top-0 z-30 rounded-xl border border-border bg-card p-3 transition-shadow ${
        scrolled ? "shadow-lg" : "shadow-sm"
      }`}
    >
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wide text-muted">
            Window
          </span>
          <div className="flex flex-wrap items-center gap-1 overflow-x-auto">
            {CASH_WINDOWS.map((w) => {
              const active = currentWindow === w.value;
              return (
                <button
                  key={w.value}
                  type="button"
                  onClick={() => onWindowChange(w.value)}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                    active
                      ? "border-terracotta bg-terracotta text-white"
                      : "border-border-subtle bg-card text-foreground hover:bg-card-hover"
                  }`}
                >
                  {w.label}
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wide text-muted">
            Mode
          </span>
          <div className="flex flex-wrap items-center gap-1">
            {CASH_MODES.map((m) => {
              const active = mode === m.value;
              return (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => onModeChange(m.value)}
                  className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
                    active
                      ? "border-accent-blue bg-accent-blue/10 text-accent-blue"
                      : "border-border-subtle bg-card text-foreground hover:bg-card-hover"
                  }`}
                >
                  {m.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

export function loadCashProjectionPrefs(defaults: {
  window: CashWindow;
  mode: CashMode;
}): { window: CashWindow; mode: CashMode } {
  if (typeof window === "undefined") return defaults;
  try {
    const w = window.localStorage.getItem(WINDOW_KEY);
    const m = window.localStorage.getItem(MODE_KEY);
    const validWindow = (CASH_WINDOWS.find((x) => x.value === w)?.value ??
      defaults.window) as CashWindow;
    const validMode = (CASH_MODES.find((x) => x.value === m)?.value ??
      defaults.mode) as CashMode;
    return { window: validWindow, mode: validMode };
  } catch {
    return defaults;
  }
}

export function saveCashProjectionPrefs(w: CashWindow, m: CashMode) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(WINDOW_KEY, w);
    window.localStorage.setItem(MODE_KEY, m);
  } catch {
    /* quota / incognito — safe to ignore */
  }
}
