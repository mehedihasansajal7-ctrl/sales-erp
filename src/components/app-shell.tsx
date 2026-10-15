"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as Icons from "lucide-react";
import type { NavSection } from "@/lib/nav";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

function Icon({ name, className }: { name: string; className?: string }) {
  const LucideIcon = (Icons as unknown as Record<string, React.ComponentType<{ className?: string }>>)[
    name
  ];
  const Fallback = Icons.Circle;
  const Component = LucideIcon ?? Fallback;
  return <Component className={className} />;
}

export type ShellUser = {
  name: string;
  email: string;
  role: string;
  roleLabel: string;
  warehouseName: string | null;
};

export function AppShell({
  user,
  sections,
  children,
}: {
  user: ShellUser;
  sections: NavSection[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = React.useState(false);

  const isActive = (href: string) =>
    pathname === href || (pathname.startsWith(`${href}/`) && href !== "/dashboard");

  const closeMobileNav = () => setMobileOpen(false);

  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      {/* Mobile top bar */}
      <header className="app-header sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-slate-200 bg-white px-3 py-2 lg:hidden">
        <Button
          variant="outline"
          size="icon"
          aria-label="Open navigation"
          onClick={() => setMobileOpen((open) => !open)}
        >
          <Icons.Menu className="size-4" />
        </Button>
        <span className="text-sm font-semibold">Sales &amp; Delivery ERP</span>
        <form action="/api/logout" method="post">
          <Button variant="ghost" size="sm" type="submit">
            Sign out
          </Button>
        </form>
      </header>

      <aside
        className={cn(
          "z-20 w-full shrink-0 border-r border-slate-200 bg-white lg:block lg:w-64 lg:min-h-dvh",
          mobileOpen ? "block" : "hidden",
        )}
      >
        <div className="hidden items-center gap-2 border-b border-slate-200 px-4 py-4 lg:flex">
          <Icons.Package className="size-5 text-emerald-600" />
          <div>
            <p className="text-sm font-semibold leading-tight">Sales &amp; Delivery</p>
            <p className="text-xs text-slate-500">Bulk commodity ERP</p>
          </div>
        </div>

        <nav className="flex flex-col gap-4 p-3">
          {sections.map((section) => (
            <div key={section.title} className="flex flex-col gap-1">
              <p className="px-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                {section.title}
              </p>
              {section.items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={closeMobileNav}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-2 py-2 text-sm font-medium transition-colors",
                    isActive(item.href)
                      ? "bg-emerald-50 text-emerald-800"
                      : "text-slate-700 hover:bg-slate-100",
                  )}
                >
                  <Icon name={item.icon} className="size-4 shrink-0" />
                  {item.label}
                </Link>
              ))}
            </div>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="app-header hidden items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 lg:flex">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-900">{user.name}</p>
            <p className="truncate text-xs text-slate-500">
              {user.roleLabel}
              {user.warehouseName ? ` • ${user.warehouseName}` : ""} • {user.email}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href="/change-password">Change password</Link>
            </Button>
            <form action="/api/logout" method="post">
              <Button variant="default" size="sm" type="submit">
                Sign out
              </Button>
            </form>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1400px] flex-1 p-3 sm:p-5">{children}</main>
      </div>
    </div>
  );
}
