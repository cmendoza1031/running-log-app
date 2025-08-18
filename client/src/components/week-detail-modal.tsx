import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import type { Run } from "@shared/schema";

interface WeekDetailModalProps {
  weekLabel: string;
  weekIndex: number;
  totalMiles: number;
  totalTime?: number;
  isOpen: boolean;
  onClose: () => void;
  onRunClick: (run: Run) => void;
  onAddRun: () => void;
}

export default function WeekDetailModal({ 
  weekLabel, 
  weekIndex, 
  totalMiles, 
  totalTime,
  isOpen, 
  onClose, 
  onRunClick,
  onAddRun
}: WeekDetailModalProps) {
  // Get the actual runs for this week
  const { data: allRuns } = useQuery<Run[]>({
    queryKey: ['/api/runs'],
  });

  const formatTime = (totalMinutes: number | undefined) => {
    if (!totalMinutes) return "0min";
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours === 0) return `${minutes}min`;
    return `${hours}hr ${minutes}min`;
  };

  const formatPace = (minutes: number, seconds: number) => {
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const getRunTypeClass = (runType: string) => {
    const knownTypes = ["easy", "tempo", "long", "interval", "trail", "threshold", "race"];
    if (knownTypes.includes(runType)) {
      return `run-type-${runType}`;
    }
    return 'bg-gradient-to-br from-gray-100 to-gray-200';
  };

  // Calculate the week start date from the week label
  const getWeekStartDate = (label: string) => {
    const [month, day] = label.split(' ');
    const currentYear = new Date().getFullYear();
    const monthIndex = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 
                       'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].indexOf(month);
    return new Date(currentYear, monthIndex, parseInt(day));
  };

  const weekStartDate = getWeekStartDate(weekLabel);
  const weekEndDate = new Date(weekStartDate.getTime() + (6 * 24 * 60 * 60 * 1000));

  // Filter runs for this specific week
  const weekRuns = allRuns?.filter(run => {
    const runDate = new Date(run.date);
    return runDate >= weekStartDate && runDate <= weekEndDate;
  }) || [];

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-sm mx-auto bg-ivory rounded-2xl">
        <DialogHeader className="flex flex-row items-center justify-between">
          <div>
            <DialogTitle className="text-xl font-semibold text-gray-800">
              Week of {weekLabel}
            </DialogTitle>
            <div className="text-sm text-gray-600 mt-1">
              {weekStartDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - {weekEndDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </div>
          </div>
          <Button
            onClick={onAddRun}
            className="bg-skyblue text-white px-3 py-1 rounded-lg text-sm hover:bg-skyblue-dark"
            data-testid="button-add-run"
          >
            <Plus size={14} className="mr-1" />
            Add
          </Button>
        </DialogHeader>

        {/* Week Summary */}
        <div className="bg-white rounded-xl p-4 mb-4">
          <div className="grid grid-cols-2 gap-4 text-center">
            <div>
              <div className="text-sm text-gray-600 mb-1">Total Miles</div>
              <div className="text-xl font-bold text-skyblue">{totalMiles.toFixed(1)}</div>
            </div>
            <div>
              <div className="text-sm text-gray-600 mb-1">Total Time</div>
              <div className="text-xl font-bold text-skyblue">{formatTime(totalTime)}</div>
            </div>
          </div>
        </div>

        {/* Runs List */}
        <div className="space-y-3 max-h-60 overflow-y-auto">
          {weekRuns.length === 0 ? (
            <div className="text-center py-6 text-gray-500">
              <p>No runs logged this week</p>
              <p className="text-sm mt-1">Tap "Add" to log your first run</p>
            </div>
          ) : (
            weekRuns
              .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
              .map((run, index) => {
                const runDate = new Date(run.date);
                return (
                  <div
                    key={run.id}
                    onClick={() => onRunClick(run)}
                    className="bg-white rounded-xl p-4 cursor-pointer hover:shadow-md transition-all duration-200 active:scale-95"
                    data-testid={`week-run-${index}`}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center space-x-3">
                        <div className={`inline-flex items-center px-2 py-1 rounded-lg ${getRunTypeClass(run.runType)}`}>
                          <span className="text-gray-700 capitalize font-medium text-xs">{run.runType}</span>
                        </div>
                        <div className="text-sm text-gray-600">
                          {runDate.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' })}
                        </div>
                      </div>
                      <div className="text-xs text-gray-500">
                        {formatPace(run.paceMinutes, run.paceSeconds)}
                      </div>
                    </div>
                    
                    <div className="flex justify-between items-center">
                      <div className="flex space-x-4">
                        <div>
                          <div className="text-xs text-gray-600">Distance</div>
                          <div className="font-bold text-skyblue">{run.distance} mi</div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-600">Time</div>
                          <div className="font-bold text-skyblue">
                            {formatTime((run.timeHours * 60) + run.timeMinutes)}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}