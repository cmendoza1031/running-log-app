import { useLocation, Link } from "wouter";
import { Home, Calendar, Plus, Bot, User } from "lucide-react";
import { IOSFeedbackManager } from "@/lib/ios-utils";

const tabs = [
  { path: "/", icon: Home, label: "Home" },
  { path: "/journey", icon: Calendar, label: "Journey" },
  { path: "/coach", icon: Bot, label: "Coach", highlight: true },
  { path: "/log", icon: Plus, label: "Log" },
  { path: "/settings", icon: User, label: "Profile" },
];

export default function BottomNavigation() {
  const [location] = useLocation();

  return (
    <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 max-w-sm w-full bg-white/95 backdrop-blur-xl border-t border-gray-100 px-2 pb-safe" style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}>
      <div className="flex justify-around items-center py-2">
        {tabs.map((tab) => {
          const isActive = location === tab.path;
          const Icon = tab.icon;

          if (tab.highlight) {
            return (
              <Link key={tab.path} href={tab.path}>
                <button
                  onClick={() => IOSFeedbackManager.mediumImpact()}
                  className="flex flex-col items-center py-1 px-3 transition-all active:scale-90"
                  data-testid={`tab-${tab.label.toLowerCase()}`}
                >
                  <div
                    className={`w-12 h-12 rounded-2xl flex items-center justify-center mb-0.5 shadow-md transition-all ${
                      isActive
                        ? "bg-gradient-to-br from-skyblue to-blue-600 shadow-blue-200"
                        : "bg-gradient-to-br from-skyblue/80 to-blue-600/80"
                    }`}
                  >
                    <Icon size={22} className="text-white" />
                  </div>
                  <span className={`text-[10px] font-semibold ${isActive ? "text-skyblue" : "text-gray-400"}`}>
                    {tab.label}
                  </span>
                </button>
              </Link>
            );
          }

          return (
            <Link key={tab.path} href={tab.path}>
              <button
                onClick={() => IOSFeedbackManager.lightImpact()}
                className={`flex flex-col items-center py-2 px-3 transition-colors active:scale-90 ${
                  isActive ? "text-skyblue" : "text-gray-400"
                }`}
                data-testid={`tab-${tab.label.toLowerCase()}`}
              >
                <Icon size={20} className="mb-1" strokeWidth={isActive ? 2.5 : 1.8} />
                <span className={`text-[10px] font-semibold`}>{tab.label}</span>
              </button>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
