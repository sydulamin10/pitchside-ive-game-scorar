import { Link, NavLink, Outlet } from "react-router";

import { Button } from "@/components/ui/Button";
import { Seam } from "@/components/ui/Surface";
import { cn } from "@/lib/utils";
import { useAuth } from "@/store/auth";

import { SeamMark } from "./Brand";
import { InstallAppButton } from "./InstallAppButton";

const NAV = [
  { to: "/features/score", label: "Scoring" },
  { to: "/features/tournament", label: "Tournaments" },
  { to: "/broadcast", label: "Broadcast" },
  { to: "/tools/coin-flip", label: "Toss tools" },
  { to: "/about", label: "About" },
];

const FOOTER = [
  {
    title: "Product",
    links: [
      { to: "/features/score", label: "Ball-by-ball scoring" },
      { to: "/features/tournament", label: "Tournaments & NRR" },
      { to: "/broadcast", label: "Broadcast overlay" },
      { to: "/tools/coin-flip", label: "Coin flip" },
      { to: "/tools/spin-wheel", label: "Spin the wheel" },
    ],
  },
  {
    title: "Guides",
    links: [
      { to: "/guides/youtube-stream-key", label: "YouTube stream key" },
      { to: "/guides/facebook-stream-key", label: "Facebook stream key" },
      { to: "/changelog", label: "Changelog" },
    ],
  },
  {
    title: "Company",
    links: [
      { to: "/about", label: "About" },
      { to: "/privacy", label: "Privacy" },
      { to: "/terms", label: "Terms" },
    ],
  },
];

export function PublicShell() {
  const status = useAuth((state) => state.status);
  const signedIn = status === "authenticated";

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-pitch-line">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <Link to="/" className="flex items-center gap-2.5">
            <SeamMark className="size-6" />
            <span className="font-sans text-base font-bold tracking-tight text-chalk">
              Pitchside
            </span>
          </Link>

          <nav aria-label="Main" className="hidden items-center gap-1 lg:flex">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    "rounded-[2px] px-3 py-2 font-sans text-sm",
                    isActive ? "text-flip" : "text-willow-soft hover:text-chalk",
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <Link to="/install" className="hidden sm:block">
              <Button variant="ghost" size="sm">
                Install
              </Button>
            </Link>
            <InstallAppButton className="hidden md:inline-flex" />
            {signedIn ? (
              <Link to="/app">
                <Button size="sm">My matches</Button>
              </Link>
            ) : (
              <>
                <Link to="/login" className="hidden sm:block">
                  <Button variant="ghost" size="sm">
                    Log in
                  </Button>
                </Link>
                <Link to="/register">
                  <Button size="sm">Start scoring</Button>
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1">
        <Outlet />
      </main>

      <footer className="mt-16">
        <Seam />
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <div className="flex items-center gap-2">
              <SeamMark className="size-5" />
              <span className="font-sans text-sm font-bold text-chalk">Pitchside</span>
            </div>
            <p className="mt-2 max-w-xs text-sm text-willow-soft">
              A scorer's ledger for club, gully, box and turf cricket. Score from a phone, share
              one link, and let the numbers take care of themselves.
            </p>
          </div>
          {FOOTER.map((column) => (
            <nav key={column.title} aria-label={column.title}>
              <p className="font-sans text-[0.65rem] font-bold tracking-[0.16em] text-willow uppercase">
                {column.title}
              </p>
              <ul className="mt-2 space-y-1.5">
                {column.links.map((link) => (
                  <li key={link.to}>
                    <Link
                      to={link.to}
                      className="font-sans text-sm text-willow-soft hover:text-chalk"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <div className="mx-auto max-w-6xl px-4 pb-8">
          <p className="font-sans text-xs text-willow">
            © {new Date().getFullYear()} Pitchside. Not affiliated with any other scoring
            product.
          </p>
        </div>
      </footer>
    </div>
  );
}
