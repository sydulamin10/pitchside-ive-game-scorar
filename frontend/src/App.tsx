import { lazy, Suspense, useEffect } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router";

import { AppShell } from "@/components/layout/AppShell";
import { PublicShell } from "@/components/layout/PublicShell";
import { Spinner } from "@/components/ui/Surface";
import { Toaster } from "@/components/ui/Toaster";
import { useAuth } from "@/store/auth";

import { Home } from "@/routes/marketing/Home";
import { Login } from "@/routes/auth/Login";
import { Register } from "@/routes/auth/Register";
import { NotFound } from "@/routes/NotFound";

// The scoring console and the ledger pages are the heaviest screens in the app
// and are only needed once someone is actually scoring, so they load on demand.
const Dashboard = lazy(() => import("@/routes/app/Dashboard"));
const NewMatch = lazy(() => import("@/routes/app/NewMatch"));
const ScoringConsole = lazy(() => import("@/routes/app/ScoringConsole"));
const Teams = lazy(() => import("@/routes/app/Teams"));
const Tournaments = lazy(() => import("@/routes/app/Tournaments"));
const TournamentDetail = lazy(() => import("@/routes/app/TournamentDetail"));
const Account = lazy(() => import("@/routes/app/Account"));
const ToolsPage = lazy(() => import("@/routes/tools/ToolsPage"));
const PublicMatch = lazy(() => import("@/routes/public/PublicMatch"));
const PublicTournament = lazy(() => import("@/routes/public/PublicTournament"));
const Overlay = lazy(() => import("@/routes/public/Overlay"));
const ScoreFeature = lazy(() => import("@/routes/marketing/ScoreFeature"));
const TournamentFeature = lazy(() => import("@/routes/marketing/TournamentFeature"));
const Broadcast = lazy(() => import("@/routes/marketing/Broadcast"));
const StreamKeyGuide = lazy(() => import("@/routes/marketing/StreamKeyGuide"));
const About = lazy(() => import("@/routes/marketing/About"));
const Legal = lazy(() => import("@/routes/marketing/Legal"));
const Changelog = lazy(() => import("@/routes/marketing/Changelog"));

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => window.scrollTo(0, 0), [pathname]);
  return null;
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const status = useAuth((state) => state.status);
  const location = useLocation();

  if (status === "loading") return <Spinner label="Checking your session" />;
  if (status === "guest") {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
}

export function App() {
  const restore = useAuth((state) => state.restore);

  useEffect(() => {
    void restore();
  }, [restore]);

  return (
    <>
      <ScrollToTop />
      <Suspense fallback={<Spinner />}>
        <Routes>
          {/* Public scorecards: no chrome, no login, opens on any device. */}
          <Route path="/s/:slug" element={<PublicMatch />} />
          <Route path="/s/:slug/overlay" element={<Overlay />} />
          <Route path="/t/:slug" element={<PublicTournament />} />

          <Route element={<PublicShell />}>
            <Route index element={<Home />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/features/score" element={<ScoreFeature />} />
            <Route path="/features/tournament" element={<TournamentFeature />} />
            <Route path="/broadcast" element={<Broadcast />} />
            <Route
              path="/guides/youtube-stream-key"
              element={<StreamKeyGuide platform="youtube" />}
            />
            <Route
              path="/guides/facebook-stream-key"
              element={<StreamKeyGuide platform="facebook" />}
            />
            <Route path="/tools/coin-flip" element={<ToolsPage initial="coin" />} />
            <Route path="/tools/spin-wheel" element={<ToolsPage initial="wheel" />} />
            <Route path="/about" element={<About />} />
            <Route path="/privacy" element={<Legal document="privacy" />} />
            <Route path="/terms" element={<Legal document="terms" />} />
            <Route path="/changelog" element={<Changelog />} />
          </Route>

          <Route
            path="/app"
            element={
              <RequireAuth>
                <AppShell />
              </RequireAuth>
            }
          >
            <Route index element={<Dashboard />} />
            <Route path="matches/new" element={<NewMatch />} />
            <Route path="matches/:matchId" element={<ScoringConsole />} />
            <Route path="teams" element={<Teams />} />
            <Route path="tournaments" element={<Tournaments />} />
            <Route path="tournaments/:tournamentId" element={<TournamentDetail />} />
            <Route path="tools" element={<ToolsPage initial="coin" />} />
            <Route path="account" element={<Account />} />
          </Route>

          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
      <Toaster />
    </>
  );
}
