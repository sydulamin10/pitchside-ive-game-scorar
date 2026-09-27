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
const TeamDetail = lazy(() => import("@/routes/app/TeamDetail"));
const PlayerEdit = lazy(() => import("@/routes/app/PlayerEdit"));
const Tournaments = lazy(() => import("@/routes/app/Tournaments"));
const TournamentDetail = lazy(() => import("@/routes/app/TournamentDetail"));
const Account = lazy(() => import("@/routes/app/Account"));
const BroadcastStudio = lazy(() => import("@/routes/app/BroadcastStudio"));
const Admin = lazy(() => import("@/routes/app/Admin"));
const BillingAdmin = lazy(() => import("@/routes/billing/BillingAdmin"));
const ToolsPage = lazy(() => import("@/routes/tools/ToolsPage"));
const PublicMatch = lazy(() => import("@/routes/public/PublicMatch"));
const PublicTournament = lazy(() => import("@/routes/public/PublicTournament"));
const PublicClub = lazy(() => import("@/routes/public/PublicClub"));
const PublicPlayer = lazy(() => import("@/routes/public/PublicPlayer"));
const Overlay = lazy(() => import("@/routes/public/Overlay"));
const ExternalCamera = lazy(() => import("@/routes/public/ExternalCamera"));
const FacebookOAuthReturn = lazy(() => import("@/routes/public/FacebookOAuthReturn"));
const ScoreFeature = lazy(() => import("@/routes/marketing/ScoreFeature"));
const TournamentFeature = lazy(() => import("@/routes/marketing/TournamentFeature"));
const Broadcast = lazy(() => import("@/routes/marketing/Broadcast"));
const StreamKeyGuide = lazy(() => import("@/routes/marketing/StreamKeyGuide"));
const About = lazy(() => import("@/routes/marketing/About"));
const Legal = lazy(() => import("@/routes/marketing/Legal"));
const Changelog = lazy(() => import("@/routes/marketing/Changelog"));
const InstallApp = lazy(() => import("@/routes/marketing/InstallApp"));
const Pricing = lazy(() => import("@/routes/marketing/Pricing"));

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    // scrollTo's return value must not leak out of the effect — React treats a
    // returned Promise as a cleanup and then crashes when it tries to call it.
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

function RequireAdmin({ children }: { children: React.ReactNode }) {
  const user = useAuth((state) => state.user);
  const status = useAuth((state) => state.status);
  if (status === "loading") return <Spinner label="Checking your session" />;
  if (status === "guest" || user?.role !== "admin") {
    return <Navigate to="/app" replace />;
  }
  return <>{children}</>;
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
          <Route path="/s/:slug/camera/:token" element={<ExternalCamera />} />
          <Route path="/social/facebook/callback" element={<FacebookOAuthReturn />} />
          <Route
            path="/api/v1/public/social/facebook/callback"
            element={<FacebookOAuthReturn />}
          />
          <Route path="/t/:slug" element={<PublicTournament />} />
          <Route path="/club/:slug" element={<PublicClub />} />
          <Route path="/p/:slug" element={<PublicPlayer />} />

          <Route element={<PublicShell />}>
            <Route index element={<Home />} />
            <Route path="/install" element={<InstallApp />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/features/score" element={<ScoreFeature />} />
            <Route path="/features/tournament" element={<TournamentFeature />} />
            <Route path="/broadcast" element={<Broadcast />} />
            <Route path="/pricing" element={<Pricing />} />
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
            path="/billing"
            element={
              <RequireAdmin>
                <BillingAdmin />
              </RequireAdmin>
            }
          />

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
            <Route path="matches/:matchId/broadcast" element={<BroadcastStudio />} />
            <Route path="teams" element={<Teams />} />
            <Route path="teams/:teamId" element={<TeamDetail />} />
            <Route path="teams/:teamId/players/:playerId" element={<PlayerEdit />} />
            <Route path="tournaments" element={<Tournaments />} />
            <Route path="tournaments/:tournamentId" element={<TournamentDetail />} />
            <Route path="tools" element={<ToolsPage initial="coin" />} />
            <Route path="account" element={<Account />} />
            <Route
              path="admin"
              element={
                <RequireAdmin>
                  <Admin />
                </RequireAdmin>
              }
            />
          </Route>

          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
      <Toaster />
    </>
  );
}
