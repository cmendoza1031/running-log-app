import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Home from "@/pages/home";
import Journey from "@/pages/journey";
import LogActivity from "@/pages/log-activity";
import BottomNavigation from "@/components/bottom-navigation";
import { useEffect } from "react";
import { IOSAppManager, IOSPerformanceManager, isNative } from "./lib/ios-utils";

function Router() {
  return (
    <div className="max-w-sm mx-auto bg-ivory min-h-screen relative pb-20">

      <Switch>
        <Route path="/" component={Home} />
        <Route path="/journey" component={Journey} />
        <Route path="/log" component={LogActivity} />
        <Route component={NotFound} />
      </Switch>
      
      <BottomNavigation />
    </div>
  );
}

function App() {
  useEffect(() => {
    // Initialize iOS-specific features when running on native platform
    const initializeApp = async () => {
      if (isNative()) {
        console.log('Initializing iOS native features...');
        await IOSAppManager.initialize();
        
        // Optimize app performance for iOS
        IOSPerformanceManager.preventZoom();
        
        // Optimize scrolling for all scroll containers
        const scrollContainers = document.querySelectorAll('[data-scroll-container]');
        scrollContainers.forEach((container) => {
          IOSPerformanceManager.optimizeScrolling(container as HTMLElement);
        });
      }
    };

    initializeApp();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
