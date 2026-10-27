import { useEffect } from "react";
import { Switch, Route, Redirect } from "wouter";
import { QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import { SplashScreen } from "@capacitor/splash-screen";
import { queryClient } from "./lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useAutoSync } from "@/hooks/use-sync";
import { IOSAppManager, IOSPerformanceManager, isNative } from "./lib/ios-utils";
import type { Profile } from "@shared/schema";
import BottomNavigation from "@/components/bottom-navigation";
import AuthPage from "@/pages/auth";
import Onboarding from "@/pages/onboarding";
import Today from "@/pages/today";
import CalendarPage from "@/pages/calendar";
import CoachPage from "@/pages/coach";
import ProgressPage from "@/pages/progress";
import ProfilePage from "@/pages/profile";
import WorkoutPage from "@/pages/workout";
import ActivityPage from "@/pages/activity";
import LogPage from "@/pages/log";
import PrivacyPage from "@/pages/privacy";
import NotFound from "@/pages/not-found";

function Spinner() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-black">
      <div className="h-7 w-7 animate-spin rounded-full border-2 border-white/15 border-t-primary" />
    </div>
  );
}

function Router() {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  if (!user) {
    return (
      <div className="relative mx-auto flex min-h-[100dvh] w-full max-w-md flex-col bg-black">
        <Switch>
          <Route path="/privacy" component={PrivacyPage} />
          <Route path="/auth" component={AuthPage} />
          <Route>
            <Redirect to="/auth" />
          </Route>
        </Switch>
      </div>
    );
  }
  return <AuthenticatedApp />;
}

function AuthenticatedApp() {
  const { data: profile, isLoading, isError, refetch, isFetching } = useQuery<Profile | null>({ queryKey: ["/api/profile"] });
  const qc = useQueryClient();
  const { toast } = useToast();
  useAutoSync(!!profile?.onboardingComplete);

  // Web Strava OAuth returns with ?strava=connected|denied|error
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const s = params.get("strava");
    if (!s) return;
    if (s === "connected") {
      toast({ title: "Strava connected", description: "Importing your history — thresholds and fitness will appear shortly." });
      void qc.invalidateQueries();
      setTimeout(() => void qc.invalidateQueries(), 15000);
    } else {
      toast({ title: s === "denied" ? "Strava not connected" : "Strava connection failed", variant: "destructive" });
    }
    window.history.replaceState({}, "", window.location.pathname);
  }, [qc, toast]);

  if (isLoading) return <Spinner />;

  if (isError) {
    return (
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col items-center justify-center gap-4 bg-black px-8 text-center">
        <div className="text-[17px] font-semibold text-ink-1">Can't reach Vista right now</div>
        <div className="text-[14px] leading-snug text-ink-2">The server didn't respond. Check your connection and try again.</div>
        <button type="button" onClick={() => void refetch()} disabled={isFetching} className="press rounded-xl bg-primary px-5 py-2.5 text-[15px] font-semibold text-white disabled:opacity-60">
          {isFetching ? "Retrying…" : "Retry"}
        </button>
      </div>
    );
  }

  if (profile && !profile.onboardingComplete) {
    return (
      <div className="mx-auto flex h-[100dvh] max-h-[100dvh] w-full max-w-md flex-col overflow-hidden bg-black">
        <Onboarding onComplete={() => qc.invalidateQueries()} />
      </div>
    );
  }

  return (
    <div className="relative mx-auto flex h-[100dvh] max-h-[100dvh] w-full max-w-md flex-col overflow-hidden bg-black">
      <div className="min-h-0 flex-1 overflow-hidden">
        <Switch>
          <Route path="/" component={Today} />
          <Route path="/calendar" component={CalendarPage} />
          <Route path="/coach" component={CoachPage} />
          <Route path="/progress" component={ProgressPage} />
          <Route path="/profile" component={ProfilePage} />
          <Route path="/workout/:id" component={WorkoutPage} />
          <Route path="/activity/:id" component={ActivityPage} />
          <Route path="/log" component={LogPage} />
          <Route path="/privacy" component={PrivacyPage} />
          <Route path="/auth">
            <Redirect to="/" />
          </Route>
          <Route component={NotFound} />
        </Switch>
      </div>
      <BottomNavigation />
    </div>
  );
}

function AppContent() {
  useEffect(() => {
    if (!isNative()) return;
    SplashScreen.hide().catch(() => {});
    void IOSAppManager.initialize();
    IOSPerformanceManager.preventZoom();
  }, []);
  return <Router />;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <Toaster />
          <AppContent />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
