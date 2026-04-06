import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { ChevronLeft, ChevronRight } from "lucide-react";
import WeeklyChart from "@/components/weekly-chart";
import WeekDetailModal from "@/components/week-detail-modal";
import RunDetailModal from "@/components/run-detail-modal";
import { getMonthlyWeeklyMileage, getCurrentWeekMileage, getCurrentWeekTime, getMonthlyWeeklyTime } from "@/lib/date-utils";
import type { Run } from "@shared/schema";

export default function Home() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedWeek, setSelectedWeek] = useState<{
    index: number;
    label: string;
    miles: number;
    time?: number;
  } | null>(null);
  const [showWeekDetail, setShowWeekDetail] = useState(false);
  const [selectedRun, setSelectedRun] = useState<Run | null>(null);
  const [showRunDetail, setShowRunDetail] = useState(false);
  const [, setLocation] = useLocation();
  
  const currentMonth = currentDate.getMonth() + 1;
  const currentYear = currentDate.getFullYear();
  
  const { data: runs, isLoading } = useQuery<Run[]>({
    queryKey: ['/api/runs/month', currentYear, currentMonth],
  });

  if (isLoading) {
    return (
      <div className="px-6 pt-8">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-semibold text-foreground mb-2">Milestones</h1>
          <p className="text-skyblue text-lg font-medium">Weekly</p>
        </div>
        <div className="bg-surface-raised rounded-2xl shadow-lg p-6 mb-6 animate-pulse">
          <div className="h-8 bg-border rounded mb-4"></div>
          <div className="h-64 bg-border rounded"></div>
        </div>
      </div>
    );
  }

  const currentWeekMiles = getCurrentWeekMileage(runs || []);
  const currentWeekTime = getCurrentWeekTime(runs || []);
  const weeklyData = getMonthlyWeeklyMileage(runs || [], currentYear, currentMonth);
  
  // Calculate statistics
  const totalRuns = runs?.length || 0;
  const avgPace = runs && runs.length > 0 
    ? runs.reduce((sum, run) => sum + run.paceMinutes + (run.paceSeconds / 60), 0) / runs.length
    : 0;
  
  const avgPaceMinutes = Math.floor(avgPace);
  const avgPaceSeconds = Math.round((avgPace - avgPaceMinutes) * 60);

  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];

  const navigateMonth = (direction: 'prev' | 'next') => {
    const newDate = new Date(currentDate);
    const today = new Date();
    
    if (direction === 'prev') {
      newDate.setMonth(newDate.getMonth() - 1);
      setCurrentDate(newDate);
    } else {
      // Only allow going forward if not already in current month
      newDate.setMonth(newDate.getMonth() + 1);
      if (newDate.getFullYear() < today.getFullYear() || 
          (newDate.getFullYear() === today.getFullYear() && newDate.getMonth() <= today.getMonth())) {
        setCurrentDate(newDate);
      }
    }
  };

  // Check if we can navigate forward (not in current month)
  const canNavigateForward = () => {
    const today = new Date();
    return currentYear < today.getFullYear() || 
           (currentYear === today.getFullYear() && currentMonth < today.getMonth() + 1);
  };

  const handleWeekClick = (weekIndex: number, weekLabel: string, miles: number, time?: number) => {
    setSelectedWeek({ index: weekIndex, label: weekLabel, miles, time });
    setShowWeekDetail(true);
  };

  const handleRunClick = (run: Run) => {
    setShowWeekDetail(false);
    setSelectedRun(run);
    setShowRunDetail(true);
  };

  const handleEditRun = (run: Run) => {
    setShowRunDetail(false);
    setLocation(`/log?edit=${run.id}`);
  };

  const handleAddRun = () => {
    setShowWeekDetail(false);
    setLocation('/log');
  };

  const closeWeekDetail = () => {
    setShowWeekDetail(false);
    setSelectedWeek(null);
  };

  const closeRunDetail = () => {
    setShowRunDetail(false);
    setSelectedRun(null);
  };

  const formatTime = (totalMinutes: number) => {
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours === 0) return `${minutes}min`;
    return `${hours}hr ${minutes}min`;
  };

  return (
    <div className="px-5 pb-28" data-testid="home-page">
      <div className="pt-14 pb-4">
        <h1 className="text-2xl font-bold text-foreground" data-testid="text-page-title">Milestones</h1>
        <p className="text-skyblue text-sm font-medium mt-0.5" data-testid="text-page-subtitle">Weekly</p>
      </div>

      <div className="bg-surface-raised rounded-2xl shadow-lg p-6 mb-6">
        {/* Chart Header with Navigation */}
        <div className="flex justify-between items-center mb-4">
          <button 
            className="p-2 text-skyblue"
            onClick={() => navigateMonth('prev')}
            data-testid="button-prev-month"
          >
            <ChevronLeft size={20} />
          </button>
          <h3 className="text-lg font-semibold text-foreground" data-testid="text-current-month">
            {monthNames[currentMonth - 1]} {currentYear}
          </h3>
          <button 
            className={`p-2 ${canNavigateForward() ? 'text-skyblue' : 'text-muted-foreground cursor-not-allowed'}`}
            onClick={() => canNavigateForward() && navigateMonth('next')}
            disabled={!canNavigateForward()}
            data-testid="button-next-month"
          >
            <ChevronRight size={20} />
          </button>
        </div>

        {/* Current Week Stats */}
        <div className="flex justify-between items-center mb-4">
          <div>
            <span className="text-2xl font-bold text-foreground" data-testid="text-current-week-miles">
              {currentWeekMiles.toFixed(1)} mi
            </span>
            <span className="text-skyblue text-lg font-medium ml-2" data-testid="text-current-week-time">
              {formatTime(currentWeekTime)}
            </span>
          </div>
          <span className="text-sm text-muted-foreground">This Week</span>
        </div>
        
        <WeeklyChart data={weeklyData} onDotClick={handleWeekClick} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="bg-surface-raised rounded-xl p-4 shadow-sm">
          <div className="text-skyblue text-2xl font-bold" data-testid="text-total-runs">
            {totalRuns}
          </div>
          <div className="text-muted-foreground text-sm">Total Runs</div>
        </div>
        <div className="bg-surface-raised rounded-xl p-4 shadow-sm">
          <div className="text-skyblue text-2xl font-bold" data-testid="text-avg-pace">
            {totalRuns > 0 ? `${avgPaceMinutes}:${avgPaceSeconds.toString().padStart(2, '0')}` : '--:--'}
          </div>
          <div className="text-muted-foreground text-sm">Avg Pace</div>
        </div>
      </div>

      {/* Modals */}
      {selectedWeek && (
        <WeekDetailModal
          weekLabel={selectedWeek.label}
          weekIndex={selectedWeek.index}
          totalMiles={selectedWeek.miles}
          totalTime={selectedWeek.time}
          isOpen={showWeekDetail}
          onClose={closeWeekDetail}
          onRunClick={handleRunClick}
          onAddRun={handleAddRun}
        />
      )}

      <RunDetailModal
        run={selectedRun}
        isOpen={showRunDetail}
        onClose={closeRunDetail}
        onEdit={handleEditRun}
      />
    </div>
  );
}
