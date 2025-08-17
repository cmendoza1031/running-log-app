import type { Run } from "@shared/schema";

interface MonthlyCalendarProps {
  year: number;
  month: number;
  runs: Run[];
}

export default function MonthlyCalendar({ year, month, runs }: MonthlyCalendarProps) {
  const daysInMonth = new Date(year, month, 0).getDate();
  const firstDayOfMonth = new Date(year, month - 1, 1).getDay();
  const adjustedFirstDay = firstDayOfMonth === 0 ? 6 : firstDayOfMonth - 1; // Monday = 0

  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  
  // Create a map of date to runs
  const runsByDate = runs.reduce((acc, run) => {
    const runDate = new Date(run.date);
    const day = runDate.getDate();
    if (!acc[day]) acc[day] = [];
    acc[day].push(run);
    return acc;
  }, {} as Record<number, Run[]>);

  const getRunTypeClass = (runType: string) => {
    return `run-type-${runType}`;
  };

  const renderCalendarDay = (day: number) => {
    const dayRuns = runsByDate[day] || [];
    const hasRun = dayRuns.length > 0;
    const runType = hasRun ? dayRuns[0].runType : null;

    return (
      <div
        key={day}
        className={`calendar-day h-10 flex items-center justify-center text-sm rounded-lg ${
          hasRun ? getRunTypeClass(runType!) : ''
        }`}
        data-testid={`calendar-day-${day}`}
      >
        <span className={hasRun ? 'text-gray-600' : 'text-gray-400'}>
          {day}
        </span>
      </div>
    );
  };

  const renderEmptyDay = (index: number) => (
    <div key={`empty-${index}`} className="h-10"></div>
  );

  return (
    <div data-testid="monthly-calendar">
      {/* Calendar Days Header */}
      <div className="grid grid-cols-7 gap-1 mb-2">
        {days.map((day) => (
          <div key={day} className="text-center text-xs text-gray-400 p-2">
            {day}
          </div>
        ))}
      </div>

      {/* Calendar Grid */}
      <div className="grid grid-cols-7 gap-1">
        {/* Empty cells for days before the first day of the month */}
        {Array.from({ length: adjustedFirstDay }, (_, index) => renderEmptyDay(index))}
        
        {/* Calendar days */}
        {Array.from({ length: daysInMonth }, (_, index) => renderCalendarDay(index + 1))}
      </div>
    </div>
  );
}
