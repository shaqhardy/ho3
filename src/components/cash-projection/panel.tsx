"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";

export interface PanelProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}

/**
 * Responsive drill-down panel. Right-side slide-out on >=768px; full-screen
 * modal below. ESC, backdrop click, and close button all dismiss.
 */
export function Panel({
  open,
  onClose,
  title,
  subtitle,
  children,
}: PanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    // Trap scroll on body while panel is open.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  // Focus management: shift focus into the panel on open.
  useEffect(() => {
    if (!open) return;
    const first = panelRef.current?.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    first?.focus();
  }, [open]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="panel-title"
      className="fixed inset-0 z-40 flex items-stretch"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        aria-hidden
        className="absolute inset-0 bg-black/50 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        className="relative ml-auto flex h-full w-full flex-col overflow-hidden bg-card shadow-2xl md:w-[560px] md:max-w-[90vw]"
      >
        <div className="flex items-start justify-between gap-3 border-b border-border-subtle px-5 py-4">
          <div className="min-w-0">
            <h2
              id="panel-title"
              className="truncate text-base font-semibold text-foreground"
            >
              {title}
            </h2>
            {subtitle && (
              <p className="mt-0.5 truncate text-xs text-muted">{subtitle}</p>
            )}
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="flex-shrink-0 rounded-lg border border-border-subtle p-1.5 text-muted hover:bg-card-hover hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}
