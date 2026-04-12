"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Profile } from "@/lib/types";
import {
  LayoutDashboard,
  Wallet,
  Building2,
  Heart,
  LogOut,
  Menu,
  X,
  Settings,
} from "lucide-react";
import { useState } from "react";
import { ThemeToggle } from "@/components/theme-toggle";

const allNavItems = [
  {
    href: "/overview",
    label: "Overview",
    icon: LayoutDashboard,
    book: null,
  },
  {
    href: "/personal",
    label: "Personal",
    icon: Wallet,
    book: "personal" as const,
  },
  {
    href: "/business",
    label: "Business",
    icon: Building2,
    book: "business" as const,
  },
  {
    href: "/nonprofit",
    label: "Nonprofit",
    icon: Heart,
    book: "nonprofit" as const,
  },
];

export function Sidebar({ profile }: { profile: Profile }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const navItems = allNavItems.filter((item) =>
    item.book === null
      ? profile.role === "admin"
      : profile.allowed_books.includes(item.book)
  );

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  // Initials for the avatar circle.
  const initials = (profile.full_name || profile.email || "?")
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <>
      {/* Mobile top bar — hamburger */}
      <button
        onClick={() => setOpen(true)}
        className="fixed top-4 left-4 z-50 rounded-lg border border-border-subtle bg-card p-2 text-muted shadow-sm lg:hidden"
        aria-label="Open menu"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Overlay */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Sidebar (drawer on mobile, static on lg+) */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-border bg-card transition-transform lg:static lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Brand */}
        <div className="flex h-16 items-center justify-between border-b border-border-subtle px-6">
          <Link
            href="/overview"
            className="ho3-wordmark text-2xl text-foreground"
          >
            HO3
          </Link>
          <button
            onClick={() => setOpen(false)}
            className="text-muted hover:text-foreground lg:hidden"
            aria-label="Close menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Section label */}
        <div className="px-6 pt-5">
          <p className="label-sm">Navigation</p>
        </div>

        {/* Nav */}
        <nav className="flex-1 space-y-0.5 px-3 py-3">
          {navItems.map((item) => {
            const active = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className={`group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all ${
                  active
                    ? "bg-terracotta/10 text-terracotta"
                    : "text-muted hover:bg-card-hover hover:text-foreground"
                }`}
              >
                {/* Active-state vertical bar */}
                <span
                  aria-hidden
                  className={`absolute left-0 top-1/2 h-6 -translate-y-1/2 rounded-r-full bg-terracotta transition-all ${
                    active ? "w-1 opacity-100" : "w-0 opacity-0"
                  }`}
                />
                <item.icon
                  className={`h-5 w-5 transition-transform ${
                    active ? "scale-105" : "group-hover:scale-105"
                  }`}
                />
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Settings link */}
        <div className="px-3 pb-2">
          <Link
            href="/settings"
            onClick={() => setOpen(false)}
            className={`group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all ${
              pathname.startsWith("/settings")
                ? "bg-terracotta/10 text-terracotta"
                : "text-muted hover:bg-card-hover hover:text-foreground"
            }`}
          >
            <Settings className="h-5 w-5" />
            Settings
          </Link>
        </div>

        {/* Divider */}
        <div className="mx-4 border-t border-border-subtle" />

        {/* Profile + actions */}
        <div className="p-4">
          <div className="mb-3 flex items-center gap-3 px-1">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-terracotta/15 text-xs font-semibold text-terracotta">
              {initials || "?"}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">
                {profile.full_name}
              </p>
              <p className="truncate text-xs text-muted">{profile.email}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleLogout}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-border-subtle px-3 py-2 text-xs font-medium text-muted transition-colors hover:border-border hover:bg-card-hover hover:text-foreground"
            >
              <LogOut className="h-3.5 w-3.5" />
              Sign out
            </button>
            <ThemeToggle />
          </div>
        </div>
      </aside>

      {/* Mobile bottom tab bar */}
      <MobileBottomNav navItems={navItems} pathname={pathname} />
    </>
  );
}

function MobileBottomNav({
  navItems,
  pathname,
}: {
  navItems: typeof allNavItems;
  pathname: string;
}) {
  if (navItems.length === 0) return null;

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80 lg:hidden"
      style={{
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}
      aria-label="Primary (mobile)"
    >
      <ul
        className="grid"
        style={{
          gridTemplateColumns: `repeat(${Math.max(navItems.length, 1)}, minmax(0, 1fr))`,
        }}
      >
        {navItems.map((item) => {
          const active = pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <li key={item.href} className="min-w-0">
              <Link
                href={item.href}
                className={`relative flex flex-col items-center justify-center gap-1 py-2.5 text-[10px] font-medium tracking-wide transition-colors ${
                  active ? "text-terracotta" : "text-muted"
                }`}
              >
                <span
                  aria-hidden
                  className={`absolute left-1/2 top-0 h-[2px] -translate-x-1/2 rounded-full bg-terracotta transition-all ${
                    active ? "w-8 opacity-100" : "w-0 opacity-0"
                  }`}
                />
                <Icon className="h-5 w-5" />
                <span className="uppercase tracking-widest">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
