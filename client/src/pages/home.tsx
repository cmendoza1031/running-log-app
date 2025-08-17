import { useQuery } from "@tanstack/react-query";
import WeeklyChart from "@/components/weekly-chart";
import { getWeeklyMileage, getCurrentWeekMileage } from "@/lib/date-utils";
import type { Run } from "@shared/schema";

export default function Home() {
  const { data: runs, isLoading } = useQuery<Run[]>({
    queryKey: ['/api/runs'],
  });

  if (isLoading) {
    return (
      <div className="px-6">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-semibold text-gray-800 mb-2">Milestones</h1>
          <p className="text-skyblue text-lg font-medium">Weekly</p>
        </div>
        <div className="bg-white rounded-2xl shadow-lg p-6 mb-6 animate-pulse">
          <div className="h-8 bg-gray-200 rounded mb-4"></div>
          <div className="h-64 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  const currentWeekMiles = getCurrentWeekMileage(runs || []);
  const weeklyData = getWeeklyMileage(runs || []);
  
  // Calculate statistics
  const totalRuns = runs?.length || 0;
  const avgPace = runs && runs.length > 0 
    ? runs.reduce((sum, run) => sum + run.paceMinutes + (run.paceSeconds / 60), 0) / runs.length
    : 0;
  
  const avgPaceMinutes = Math.floor(avgPace);
  const avgPaceSeconds = Math.round((avgPace - avgPaceMinutes) * 60);

  return (
    <div className="px-6" data-testid="home-page">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-semibold text-gray-800 mb-2" data-testid="text-page-title">
          Milestones
        </h1>
        <p className="text-skyblue text-lg font-medium" data-testid="text-page-subtitle">
          Weekly
        </p>
      </div>

      <div className="bg-white rounded-2xl shadow-lg p-6 mb-6">
        <div className="flex justify-between items-center mb-4">
          <span className="text-2xl font-bold text-gray-800" data-testid="text-current-week-miles">
            {currentWeekMiles.toFixed(1)} mi
          </span>
          <span className="text-sm text-gray-500">This Week</span>
        </div>
        
        <WeeklyChart data={weeklyData} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white rounded-xl p-4 shadow-sm">
          <div className="text-skyblue text-2xl font-bold" data-testid="text-total-runs">
            {totalRuns}
          </div>
          <div className="text-gray-600 text-sm">Total Runs</div>
        </div>
        <div className="bg-white rounded-xl p-4 shadow-sm">
          <div className="text-skyblue text-2xl font-bold" data-testid="text-avg-pace">
            {totalRuns > 0 ? `${avgPaceMinutes}:${avgPaceSeconds.toString().padStart(2, '0')}` : '--:--'}
          </div>
          <div className="text-gray-600 text-sm">Avg Pace</div>
        </div>
      </div>
    </div>
  );
}
