"use client";

import Link from "next/link";
import type { ReactNode } from "react";

interface CTA {
  label: string;
  href?: string;
  onClick?: () => void;
}

interface EmptyStateProps {
  title: string;
  description: string;
  cta?: CTA;
  secondaryCta?: CTA;
  illustration?: ReactNode;
  children?: ReactNode;
  compact?: boolean;
}

/**
 * Default HO3 illustration: three overlapping rounded rectangles representing
 * Personal, Business, and Nonprofit books converging into one view.
 */
export function BooksIllustration({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 160 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={className}
    >
      {/* Back card — Nonprofit (muted) */}
      <rect
        x="24"
        y="22"
        width="88"
        height="68"
        rx="10"
        fill="var(--color-card)"
        stroke="var(--color-border)"
        strokeWidth="1.5"
        transform="rotate(-8 68 56)"
      />
      {/* Middle card — Business (slightly terracotta) */}
      <rect
        x="40"
        y="26"
        width="88"
        height="68"
        rx="10"
        fill="var(--color-card-hover)"
        stroke="var(--color-terracotta)"
        strokeOpacity="0.35"
        strokeWidth="1.5"
        transform="rotate(4 84 60)"
      />
      {/* Front card — Personal (accent) */}
      <rect
        x="48"
        y="36"
        width="88"
        height="68"
        rx="10"
        fill="var(--color-terracotta)"
        fillOpacity="0.12"
        stroke="var(--color-terracotta)"
        strokeWidth="1.5"
      />
      {/* Inner detail lines on front card */}
      <rect
        x="58"
        y="48"
        width="42"
        height="6"
        rx="3"
        fill="var(--color-terracotta)"
        fillOpacity="0.55"
      />
      <rect
        x="58"
        y="60"
        width="64"
        height="4"
        rx="2"
        fill="var(--color-terracotta)"
        fillOpacity="0.28"
      />
      <rect
        x="58"
        y="70"
        width="52"
        height="4"
        rx="2"
        fill="var(--color-terracotta)"
        fillOpacity="0.28"
      />
      <rect
        x="58"
        y="80"
        width="38"
        height="4"
        rx="2"
        fill="var(--color-terracotta)"
        fillOpacity="0.28"
      />
    </svg>
  );
}

function CtaButton({ cta, primary }: { cta: CTA; primary: boolean }) {
  const baseClasses = primary
    ? "inline-flex items-center justify-center rounded-lg bg-terracotta px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-terracotta-hover"
    : "inline-flex items-center justify-center rounded-lg border border-border bg-card px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-card-hover";

  if (cta.href) {
    return (
      <Link href={cta.href} className={baseClasses}>
        {cta.label}
      </Link>
    );
  }

  return (
    <button type="button" onClick={cta.onClick} className={baseClasses}>
      {cta.label}
    </button>
  );
}

export function EmptyState({
  title,
  description,
  cta,
  secondaryCta,
  illustration,
  children,
  compact = false,
}: EmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center text-center ${
        compact ? "py-10 px-6" : "py-16 px-6 sm:py-20"
      }`}
    >
      <div
        className={`${
          compact ? "w-32 h-24" : "w-48 h-36 sm:w-56 sm:h-40"
        } mb-6 flex items-center justify-center`}
      >
        {illustration ?? <BooksIllustration className="w-full h-full" />}
      </div>

      <h2
        className={`${
          compact ? "text-xl" : "text-2xl sm:text-3xl"
        } font-bold text-foreground max-w-xl`}
      >
        {title}
      </h2>

      <p className="mt-3 text-sm sm:text-base text-muted max-w-lg leading-relaxed">
        {description}
      </p>

      {(cta || secondaryCta) && (
        <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
          {cta && <CtaButton cta={cta} primary />}
          {secondaryCta && <CtaButton cta={secondaryCta} primary={false} />}
        </div>
      )}

      {children && <div className="mt-10 w-full max-w-3xl">{children}</div>}
    </div>
  );
}

/**
 * A small inline banner for "partially empty" states (e.g. accounts connected
 * but transactions still syncing).
 */
export function EmptyStateBanner({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-xl border border-terracotta/30 bg-terracotta/10 px-4 py-3">
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="mt-0.5 text-xs text-muted">{description}</p>
    </div>
  );
}
