import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Pencil, X } from "lucide-react";
import type { Run } from "@shared/schema";

interface RunDetailModalProps {
  run: Run | null;
  isOpen: boolean;
  onClose: () => void;
  onEdit: (run: Run) => void;
}

export default function RunDetailModal({ run, isOpen, onClose, onEdit }: RunDetailModalProps) {
  if (!run) return null;

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
      day: 'numeric',
      year: 'numeric' 
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-sm mx-auto bg-card rounded-2xl border-border">
        <DialogHeader className="flex flex-row items-center justify-between">
          <div>
            <DialogTitle className="text-xl font-semibold text-gray-800">Run Details</DialogTitle>
            <DialogDescription className="text-sm text-gray-600">
              View and edit your run information below.
            </DialogDescription>
          </div>
          <Button
            onClick={() => onEdit(run)}
            className="bg-skyblue text-white px-3 py-1 rounded-lg text-sm hover:bg-skyblue-dark"
            data-testid="button-edit-run"
          >
            <Pencil size={14} className="mr-1" />
            Edit
          </Button>
        </DialogHeader>

        <div className="space-y-4">
          {/* Date */}
          <div className="bg-white rounded-xl p-4">
            <div className="text-sm text-gray-600 mb-1">Date</div>
            <div className="text-lg font-medium text-gray-800">
              {formatDate(run.date)}
            </div>
          </div>

          {/* Run Type */}
          <div className="bg-white rounded-xl p-4">
            <div className="text-sm text-gray-600 mb-2">Run Type</div>
            <div className={`inline-flex items-center px-3 py-1 rounded-lg ${getRunTypeClass(run.runType)}`}>
              <span className="text-gray-700 capitalize font-medium">{run.runType}</span>
            </div>
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-white rounded-xl p-4 text-center">
              <div className="text-sm text-gray-600 mb-1">Distance</div>
              <div className="text-lg font-bold text-skyblue">{run.distance} mi</div>
            </div>
            <div className="bg-white rounded-xl p-4 text-center">
              <div className="text-sm text-gray-600 mb-1">Time</div>
              <div className="text-lg font-bold text-skyblue">
                {formatTime(run.timeHours, run.timeMinutes)}
              </div>
            </div>
            <div className="bg-white rounded-xl p-4 text-center">
              <div className="text-sm text-gray-600 mb-1">Pace</div>
              <div className="text-lg font-bold text-skyblue">
                {formatPace(run.paceMinutes, run.paceSeconds)}
              </div>
            </div>
          </div>

          {/* Notes */}
          {run.notes && (
            <div className="bg-white rounded-xl p-4">
              <div className="text-sm text-gray-600 mb-2">Notes</div>
              <div className="text-gray-800">{run.notes}</div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}