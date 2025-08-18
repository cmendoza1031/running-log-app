import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useLocation } from "wouter";
import MonthlyCalendar from "@/components/monthly-calendar";
import RunDayPopup from "@/components/run-day-popup";
import RunDetailModal from "@/components/run-detail-modal";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Run } from "@shared/schema";

export default function Journey() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [selectedRuns, setSelectedRuns] = useState<Run[]>([]);
  const [showDayPopup, setShowDayPopup] = useState(false);
  const [selectedRun, setSelectedRun] = useState<Run | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [, setLocation] = useLocation();
  
  const currentMonth = currentDate.getMonth() + 1;
  const currentYear = currentDate.getFullYear();

  const { data: runs, isLoading } = useQuery<Run[]>({
    queryKey: ['/api/runs/month', currentYear, currentMonth],
  });

  const monthlyMiles = runs?.reduce((total, run) => total + parseFloat(run.distance), 0) || 0;

  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];

  const navigateMonth = (direction: 'prev' | 'next') => {
    const newDate = new Date(currentDate);
    if (direction === 'prev') {
      newDate.setMonth(newDate.getMonth() - 1);
    } else {
      newDate.setMonth(newDate.getMonth() + 1);
    }
    setCurrentDate(newDate);
  };

  const handleDayClick = (date: string, runs: Run[]) => {
    setSelectedDate(date);
    setSelectedRuns(runs);
    setShowDayPopup(true);
  };

  const handleRunClick = (run: Run) => {
    setShowDayPopup(false);
    setSelectedRun(run);
    setShowDetailModal(true);
  };

  const handleEditRun = (run: Run) => {
    setShowDetailModal(false);
    setLocation(`/log?edit=${run.id}`);
  };

  const closeDayPopup = () => {
    setShowDayPopup(false);
    setSelectedDate("");
    setSelectedRuns([]);
  };

  const closeDetailModal = () => {
    setShowDetailModal(false);
    setSelectedRun(null);
  };

  if (isLoading) {
    return (
      <div className="px-6">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-semibold text-gray-800 mb-2">Journey</h1>
          <p className="text-skyblue text-lg font-medium">Monthly Progress</p>
        </div>
        <div className="bg-white rounded-2xl shadow-lg p-6 mb-6 animate-pulse">
          <div className="h-8 bg-gray-200 rounded mb-4"></div>
          <div className="h-64 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="px-6" data-testid="journey-page">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-semibold text-gray-800 mb-2" data-testid="text-page-title">
          Journey
        </h1>
        <p className="text-skyblue text-lg font-medium" data-testid="text-page-subtitle">
          Monthly Progress
        </p>
      </div>

      <div className="bg-white rounded-2xl shadow-lg p-6 mb-6">
        <div className="text-center mb-6">
          <div className="text-3xl font-bold text-skyblue" data-testid="text-monthly-miles">
            {monthlyMiles.toFixed(1)}
          </div>
          <div className="text-gray-600">Miles this month</div>
        </div>

        {/* Calendar Header */}
        <div className="flex justify-between items-center mb-4">
          <button 
            className="p-2 text-skyblue"
            onClick={() => navigateMonth('prev')}
            data-testid="button-prev-month"
          >
            <ChevronLeft size={20} />
          </button>
          <h3 className="text-lg font-semibold text-gray-800" data-testid="text-current-month">
            {monthNames[currentMonth - 1]} {currentYear}
          </h3>
          <button 
            className="p-2 text-skyblue"
            onClick={() => navigateMonth('next')}
            data-testid="button-next-month"
          >
            <ChevronRight size={20} />
          </button>
        </div>

        <MonthlyCalendar 
          year={currentYear} 
          month={currentMonth} 
          runs={runs || []} 
          onDayClick={handleDayClick}
        />
      </div>

      {/* Run Type Legend */}
      <div className="bg-white rounded-xl p-4 shadow-sm">
        <h4 className="text-sm font-medium text-gray-800 mb-3">Run Types</h4>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="flex items-center">
            <div className="w-3 h-3 rounded-full run-type-easy mr-2"></div>
            <span>Easy</span>
          </div>
          <div className="flex items-center">
            <div className="w-3 h-3 rounded-full run-type-tempo mr-2"></div>
            <span>Tempo</span>
          </div>
          <div className="flex items-center">
            <div className="w-3 h-3 rounded-full run-type-long mr-2"></div>
            <span>Long</span>
          </div>
          <div className="flex items-center">
            <div className="w-3 h-3 rounded-full run-type-interval mr-2"></div>
            <span>Interval</span>
          </div>
          <div className="flex items-center">
            <div className="w-3 h-3 rounded-full run-type-trail mr-2"></div>
            <span>Trail</span>
          </div>
          <div className="flex items-center">
            <div className="w-3 h-3 rounded-full run-type-threshold mr-2"></div>
            <span>Threshold</span>
          </div>
          <div className="flex items-center">
            <div className="w-3 h-3 rounded-full run-type-race mr-2"></div>
            <span>Race</span>
          </div>
          <div className="flex items-center">
            <div className="w-3 h-3 rounded-full bg-gradient-to-br from-gray-100 to-gray-200 mr-2"></div>
            <span>Other</span>
          </div>
        </div>
      </div>

      {/* Popups */}
      <RunDayPopup
        runs={selectedRuns}
        date={selectedDate}
        isOpen={showDayPopup}
        onClose={closeDayPopup}
        onRunClick={handleRunClick}
      />

      <RunDetailModal
        run={selectedRun}
        isOpen={showDetailModal}
        onClose={closeDetailModal}
        onEdit={handleEditRun}
      />
    </div>
  );
}
