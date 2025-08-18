import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Run } from "@shared/schema";

interface RunDayPopupProps {
  runs: Run[];
  date: string;
  isOpen: boolean;
  onClose: () => void;
  onRunClick: (run: Run) => void;
}

export default function RunDayPopup({ runs, date, isOpen, onClose, onRunClick }: RunDayPopupProps) {
  if (runs.length === 0) return null;

  const formatTime = (hours: number, minutes: number) => {
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

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { 
      weekday: 'long',
      month: 'long', 
      day: 'numeric' 
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-sm mx-auto bg-ivory rounded-2xl">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold text-gray-800">
            {formatDate(date)}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {runs.map((run, index) => (
            <div
              key={run.id}
              onClick={() => onRunClick(run)}
              className="bg-white rounded-xl p-4 cursor-pointer hover:shadow-md transition-all duration-200 active:scale-95"
              data-testid={`run-summary-${index}`}
            >
              <div className="flex items-center justify-between mb-3">
                <div className={`inline-flex items-center px-3 py-1 rounded-lg ${getRunTypeClass(run.runType)}`}>
                  <span className="text-gray-700 capitalize font-medium text-sm">{run.runType}</span>
                </div>
                <div className="text-sm text-gray-500">
                  {formatPace(run.paceMinutes, run.paceSeconds)} pace
                </div>
              </div>
              
              <div className="flex justify-between items-center">
                <div className="flex space-x-4">
                  <div>
                    <div className="text-sm text-gray-600">Distance</div>
                    <div className="font-bold text-skyblue">{run.distance} mi</div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-600">Time</div>
                    <div className="font-bold text-skyblue">
                      {formatTime(run.timeHours, run.timeMinutes)}
                    </div>
                  </div>
                </div>
              </div>
              
              {run.notes && (
                <div className="mt-3 pt-3 border-t border-gray-100">
                  <div className="text-sm text-gray-600 truncate">
                    {run.notes.length > 50 ? `${run.notes.substring(0, 50)}...` : run.notes}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}