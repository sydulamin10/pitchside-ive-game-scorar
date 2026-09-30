import { Menu, X } from "lucide-react";
import { useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router";

import { Button } from "@/components/ui/Button";
import { Seam } from "@/components/ui/Surface";
import { cn } from "@/lib/utils";
import { useAuth } from "@/store/auth";
import { toastError } from "@/store/toast";

import { HistoryBackButton } from "./HistoryBackButton";
import { BrandLogo } from "./Brand";
import { ConnectionBanner } from "./ConnectionBanner";
import { InstallAppButton } from "./InstallAppButton";

const LINKS = [
  { to: "/app", label: "Matches", end: true },
  { to: "/app/tournaments", label: "Tournaments" },
  { to: "/app/teams", label: "Teams" },
  { to: "/app/pricing", label: "Pricing" },
  { to: "/app/tools", label: "Toss tools" },
  { to: "/app/account", label: "Account" },
];

export function AppShell() {
  const user = useAuth((state) => state.user);
  const logout = useAuth((state) => state.logout);
  const navigate = useNavigate();
  const location = useLocation();
  const links = [
    ...LINKS,
    ...(user?.role === "admin"
      ? [
          { to: "/app/admin", label: "Admin Portal" },
          { to: "/billing", label: "Billing Portal" },
        ]
      : []),
  ];
  // The drawer is remembered against the route it was opened on, so any
  // navigation closes it without an effect having to chase the location.
  const [menu, setMenu] = useState({ open: false, path: location.pathname });
  const menuOpen = menu.open && menu.path === location.pathname;
  const setMenuOpen = (open: boolean) => setMenu({ open, path: location.pathname });
  const matchScoring = location.pathname.match(/^\/app\/matches\/([^/]+)/);
  const scoringHref = matchScoring ? `/app/matches/${matchScoring[1]}` : "/app";
  const scoringScreen = Boolean(matchScoring);

  const signOut = async () => {
    try {
      await logout();
      void navigate("/", { replace: true });
    } catch (error) {
      toastError(error, "Could not sign out.");
    }
  };

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b border-pitch-line bg-pitch/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <HistoryBackButton fallback="/app" />
            <Link to="/app" className="flex items-center">
              <BrandLogo />
            </Link>
          </div>

          <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
            {links.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.end}
                className={({ isActive }) =>
                  cn(
                    "rounded-[2px] px-3 py-2 font-sans text-sm transition-colors",
                    isActive
                      ? "bg-pitch-line text-flip"
                      : "text-willow-soft hover:bg-pitch-line hover:text-chalk",
                  )
                }
              >
                {link.label}
              </NavLink>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <InstallAppButton className="hidden sm:inline-flex" variant="ghost" />
            <span className="hidden font-sans text-xs text-willow lg:inline">
              {user?.display_name}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="hidden md:inline-flex"
              onClick={signOut}
            >
              Sign out
            </Button>
            <button
              type="button"
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(!menuOpen)}
              className="tap rounded-[2px] border border-willow/50 px-2.5 text-chalk md:hidden"
            >
              {menuOpen ? (
                <X aria-hidden="true" className="size-5" />
              ) : (
                <Menu aria-hidden="true" className="size-5" />
              )}
            </button>
          </div>
        </div>

        {user?.role === "admin" && !scoringScreen ? (
          <div className="mx-auto max-w-6xl px-4 pb-3">
            <nav
              aria-label="Admin portals"
              className="grid grid-cols-3 gap-1 rounded-[4px] border border-pitch-line bg-pitch-deep p-1"
            >
              <NavLink
                to={scoringHref}
                className={() =>
                  cn(
                    "rounded-[3px] px-3 py-2 text-center font-sans text-sm font-semibold",
                    location.pathname === "/app" || location.pathname.startsWith("/app/matches")
                      ? "bg-flip/15 text-flip"
                      : "text-willow-soft hover:bg-pitch-line hover:text-chalk",
                  )
                }
              >
                Scoring
              </NavLink>
              <NavLink
                to="/app/admin"
                className={({ isActive }) =>
                  cn(
                    "rounded-[3px] px-3 py-2 text-center font-sans text-sm font-semibold",
                    isActive ? "bg-flip/15 text-flip" : "text-willow-soft hover:bg-pitch-line hover:text-chalk",
                  )
                }
              >
                Admin Portal
              </NavLink>
              <NavLink
                to="/billing"
                className={({ isActive }) =>
                  cn(
                    "rounded-[3px] px-3 py-2 text-center font-sans text-sm font-semibold",
                    isActive ? "bg-flip/15 text-flip" : "text-willow-soft hover:bg-pitch-line hover:text-chalk",
                  )
                }
              >
                Billing Portal
              </NavLink>
            </nav>
          </div>
        ) : null}

        {menuOpen && (
          <nav aria-label="Main" className="border-t border-pitch-line px-4 pb-3 md:hidden">
            {links.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.end}
                className={({ isActive }) =>
                  cn(
                    "tap flex items-center rounded-[2px] px-3 font-sans text-sm",
                    isActive ? "text-flip" : "text-willow-soft",
                  )
                }
              >
                {link.label}
              </NavLink>
            ))}
            <button
              type="button"
              onClick={signOut}
              className="tap flex w-full items-center px-3 font-sans text-sm text-willow-soft"
            >
              Sign out
            </button>
            <div className="px-3 pt-2">
              <InstallAppButton className="w-full" variant="secondary" />
            </div>
          </nav>
        )}
      </header>

      <ConnectionBanner />

      <main
        className={cn(
          "mx-auto w-full max-w-6xl flex-1",
          scoringScreen ? "px-3 py-3 sm:px-4 sm:py-4" : "px-4 py-6",
        )}
      >
        <Outlet />
      </main>

      {scoringScreen ? null : (
      <footer className="mt-8">
        <Seam />
        <p className="mx-auto max-w-6xl px-4 py-4 font-sans text-xs text-willow">
          Every figure on this page is derived from the ball-by-ball log. Correct any delivery
          and the numbers after it correct themselves.
        </p>
      </footer>
      )}
    </div>
  );
}
