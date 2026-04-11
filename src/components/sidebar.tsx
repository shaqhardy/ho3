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
} from "lucide-react";
import { useState } from "react";

const allNavItems = [
  { href: "/overview", label: "Overview", icon: LayoutDashboard, book: null },
  { href: "/personal", label: "Personal", icon: Wallet, book: "personal" as const },
  { href: "/business", label: "Business", icon: Building2, book: "business" as const },
  { href: "/nonprofit", label: "Nonprofit", icon: Heart, book: "nonprofit" as const },
];

export function Sidebar({ profile }: { profile: Profile }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const navItems = allNavItems.filter(
    (item) =>
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

  return (
    <>
      {/* Mobile menu button */}
      <button
        onClick={() => setOpen(true)}
        className="fixed top-4 left-4 z-50 rounded-lg bg-card p-2 text-muted lg:hidden"
        aria-label="Open menu"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Overlay */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-border bg-card transition-transform lg:static lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-16 items-center justify-between px-6">
          <Link href="/overview" className="text-xl font-bold text-foreground">
            HO3
          </Link>
          <button
            onClick={() => setOpen(false)}
            className="text-muted lg:hidden"
            aria-label="Close menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-4">
          {navItems.map((item) => {
            const active = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                  active
                    ? "bg-terracotta/10 text-terracotta"
                    : "text-muted hover:bg-card-hover hover:text-foreground"
                }`}
              >
                <item.icon className="h-5 w-5" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-border p-4">
          <div className="mb-3 px-3">
            <p className="text-sm font-medium text-foreground truncate">
              {profile.full_name}
            </p>
            <p className="text-xs text-muted truncate">{profile.email}</p>
          </div>
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-muted transition-colors hover:bg-card-hover hover:text-foreground"
          >
            <LogOut className="h-5 w-5" />
            Sign out
          </button>
        </div>
      </aside>
    </>
  );
}
