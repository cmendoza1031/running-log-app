import type { Run } from "@shared/schema";

export function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday = 1
  return new Date(d.setDate(diff));
}

export function getWeeklyMileage(runs: Run[]) {
  const weeks: { [key: string]: number } = {};
  
  runs.forEach(run => {
    const runDate = new Date(run.date);
    const weekStart = getWeekStart(runDate);
    const weekKey = weekStart.toISOString().split('T')[0];
    
    if (!weeks[weekKey]) {
      weeks[weekKey] = 0;
    }
    weeks[weekKey] += parseFloat(run.distance);
  });

  // Get last 6 weeks
  const today = new Date();
  const sixWeeksAgo = new Date(today.getTime() - (6 * 7 * 24 * 60 * 60 * 1000));
  
  const weeklyData = [];
  for (let i = 5; i >= 0; i--) {
    const weekStart = new Date(today.getTime() - (i * 7 * 24 * 60 * 60 * 1000));
    const weekStartMonday = getWeekStart(weekStart);
    const weekKey = weekStartMonday.toISOString().split('T')[0];
    
    weeklyData.push({
      week: weekKey,
      miles: weeks[weekKey] || 0
    });
  }

  return {
    labels: weeklyData.map(w => {
      const date = new Date(w.week);
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }),
    values: weeklyData.map(w => w.miles)
  };
}

export function getCurrentWeekMileage(runs: Run[]): number {
  const today = new Date();
  const weekStart = getWeekStart(today);
  const weekEnd = new Date(weekStart.getTime() + (7 * 24 * 60 * 60 * 1000));

  return runs
    .filter(run => {
      const runDate = new Date(run.date);
      return runDate >= weekStart && runDate < weekEnd;
    })
    .reduce((total, run) => total + parseFloat(run.distance), 0);
}

export function formatPace(minutes: number, seconds: number): string {
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function formatTime(hours: number, minutes: number): string {
  if (hours === 0) {
    return `${minutes}min`;
  }
  return `${hours}h ${minutes}min`;
}
