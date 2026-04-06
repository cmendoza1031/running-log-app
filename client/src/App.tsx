import { Switch, Route, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Home from "@/pages/home";
import Journey from "@/pages/journey";
import LogActivity from "@/pages/log-activity";
import CoachPage from "@/pages/coach";
import PlanPage from "@/pages/plan";
import SettingsPage from "@/pages/settings";
import AuthPage from "@/pages/auth";
import Onboarding from "@/pages/onboarding";
import BottomNavigation from "@/components/bottom-navigation";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Profile } from "@shared/schema";
import { useEffect } from "react";
import { IOSAppManager, IOSPerformanceManager, isNative } from "./lib/ios-utils";
import { SplashScreen } from "@capacitor/splash-screen";

// ─── Protected Route wrapper ──────────────────────────────────────────────────

function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-surface">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-skyblue/30 border-t-skyblue" />
      </div>
    );
  }

  if (!user) return <Redirect to="/auth" />;
  return <Component />;
}

// ─── Router ───────────────────────────────────────────────────────────────────

function Router() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-surface">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-skyblue/30 border-t-skyblue" />
      </div>
    );
  }

  // Unauthenticated — only show auth page
  if (!user) {
    return (
      <div className="relative mx-auto flex min-h-[100dvh] w-full max-w-sm flex-col bg-surface">
        <Switch>
          <Route path="/auth" component={AuthPage} />
          <Route><Redirect to="/auth" /></Route>
        </Switch>
      </div>
    );

  }

  // Authenticated — check onboarding
  return <AuthenticatedApp />;
}

function AuthenticatedApp() {
  const { data: profile, isLoading: profileLoading } = useQuery<Profile | null>({
    queryKey: ["/api/profile"],
  });
  const qc = useQueryClient();

  if (profileLoading) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-surface">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-skyblue/30 border-t-skyblue" />
      </div>
    );
  }

  // Show onboarding if not completed
  if (profile && !profile.onboardingComplete) {
    return (
      <div className="mx-auto flex h-[100dvh] max-h-[100dvh] w-full max-w-sm flex-col overflow-hidden bg-surface">
        <Onboarding onComplete={() => qc.invalidateQueries({ queryKey: ["/api/profile"] })} />
      </div>
    );
  }

  return (
    <div
      className="relative mx-auto min-h-[100dvh] w-full max-w-sm bg-surface pb-20"
    >
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/journey" component={Journey} />
        <Route path="/coach" component={CoachPage} />
        <Route path="/plan" component={PlanPage} />
        <Route path="/log" component={LogActivity} />
        <Route path="/settings" component={SettingsPage} />
        <Route path="/auth"><Redirect to="/" /></Route>
        <Route component={NotFound} />
      </Switch>
      <BottomNavigation />
    </div>
  );
}

// ─── App Root ─────────────────────────────────────────────────────────────────

function AppContent() {
  useEffect(() => {
    const initializeApp = async () => {
      if (isNative()) {
        // Hide splash screen immediately — don't wait for auth state
        SplashScreen.hide().catch(() => {});
        await IOSAppManager.initialize();
        IOSPerformanceManager.preventZoom();
        const scrollContainers = document.querySelectorAll("[data-scroll-container]");
        scrollContainers.forEach((el) => IOSPerformanceManager.optimizeScrolling(el as HTMLElement));
      }
    };
    initializeApp();
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
