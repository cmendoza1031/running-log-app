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

function Router() {
  return (
    <div className="max-w-sm mx-auto bg-ivory min-h-screen relative pb-20">
      {/* Status Bar */}
      <div className="flex justify-between items-center p-4 pt-8">
        <span className="text-lg font-medium text-gray-800">91</span>
        <div className="flex items-center space-x-1">
          <div className="w-4 h-3 bg-gray-600 rounded-sm"></div>
          <div className="w-6 h-3 bg-gray-600 rounded-sm"></div>
        </div>
      </div>

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
