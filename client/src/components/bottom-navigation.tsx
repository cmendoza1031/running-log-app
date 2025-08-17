import { useLocation } from "wouter";
import { Home, Calendar, Plus } from "lucide-react";
import { Link } from "wouter";

export default function BottomNavigation() {
  const [location] = useLocation();

  const tabs = [
    { path: "/", icon: Home, label: "Home" },
    { path: "/journey", icon: Calendar, label: "Journey" },
    { path: "/log", icon: Plus, label: "Log" },
  ];

  return (
    <nav className="fixed bottom-0 left-1/2 transform -translate-x-1/2 max-w-sm w-full bg-white border-t border-gray-100 px-6 py-2" data-testid="bottom-navigation">
      <div className="flex justify-around items-center">
        {tabs.map((tab) => {
          const isActive = location === tab.path;
          const Icon = tab.icon;
          
          return (
            <Link key={tab.path} href={tab.path}>
              <button 
                className={`flex flex-col items-center py-2 px-3 transition-colors ${
                  isActive ? 'text-skyblue' : 'text-gray-400'
                }`}
                data-testid={`tab-${tab.label.toLowerCase()}`}
              >
                <Icon size={20} className="mb-1" />
                <span className="text-xs">{tab.label}</span>
              </button>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
