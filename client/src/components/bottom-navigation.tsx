import { useLocation, Link } from "wouter";
import { Home, CalendarDays, Sparkles, TrendingUp, User } from "lucide-react";
import { IOSFeedbackManager } from "@/lib/ios-utils";

const tabs = [
  { path: "/", icon: Home, label: "Today" },
  { path: "/calendar", icon: CalendarDays, label: "Calendar" },
  { path: "/coach", icon: Sparkles, label: "Coach" },
  { path: "/progress", icon: TrendingUp, label: "Progress" },
  { path: "/profile", icon: User, label: "Profile" },
];

export default function BottomNavigation() {
  const [location] = useLocation();
  const active = (p: string) => (p === "/" ? location === "/" : location.startsWith(p));
  return (
    <nav
      className="fixed bottom-0 left-1/2 z-40 w-full max-w-md -translate-x-1/2 border-t border-white/[0.06] bg-black/80 backdrop-blur-2xl"
      style={{ paddingBottom: "max(6px, env(safe-area-inset-bottom))" }}
    >
      <div className="flex items-center justify-around px-2 pt-1.5">
        {tabs.map(({ path, icon: Icon, label }) => {
          const on = active(path);
          return (
            <Link
              key={path}
              href={path}
              onClick={() => void IOSFeedbackManager.lightImpact()}
              className={`press flex w-16 flex-col items-center gap-0.5 py-1 ${on ? "text-ink-1" : "text-ink-3"}`}
              data-testid={`tab-${label.toLowerCase()}`}
            >
              <div className={`flex h-8 w-12 items-center justify-center rounded-full transition-colors ${on ? (path === "/coach" ? "bg-primary/25" : "bg-white/[0.1]") : ""}`}>
                <Icon size={21} strokeWidth={on ? 2.4 : 1.9} className={on && path === "/coach" ? "text-[#64a8ff]" : ""} />
              </div>
              <span className="text-[10px] font-semibold">{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
