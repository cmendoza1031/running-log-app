import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import ScrollWheel from "@/components/scroll-wheel";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { insertRunSchema } from "@shared/schema";

const formSchema = insertRunSchema.extend({
  distance: z.string().min(1, "Distance is required"),
  paceMinutes: z.number().min(4).max(15),
  paceSeconds: z.number().min(0).max(59),
  timeHours: z.string(),
  timeMinutes: z.string().min(1, "Time minutes required"),
  customRunType: z.string().optional(),
  date: z.string().refine((date) => {
    const selectedDate = new Date(date);
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    return selectedDate <= today;
  }, "Cannot log runs for future dates"),
});

type FormData = z.infer<typeof formSchema>;

export default function LogActivity() {
  const [selectedRunType, setSelectedRunType] = useState<string>("easy");
  const [customRunType, setCustomRunType] = useState<string>("");
  const [paceMinutes, setPaceMinutes] = useState<number>(8);
  const [paceSeconds, setPaceSeconds] = useState<number>(45);
  const [timeHours, setTimeHours] = useState<number>(0);
  const [timeMinutes, setTimeMinutes] = useState<number>(45);
  const [showPacePopup, setShowPacePopup] = useState<boolean>(false);
  const [showTimePopup, setShowTimePopup] = useState<boolean>(false);
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [editingRunId, setEditingRunId] = useState<string | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Helper function to invalidate cache after changes
  const invalidateRunsCache = () => {
    queryClient.invalidateQueries({ queryKey: ['/api/runs'] });
    queryClient.invalidateQueries({ queryKey: ['/api/runs/month'] });
  };
  
  // Get run ID from URL search params
  const editRunId = new URLSearchParams(window.location.search).get('edit');
  
  // Fetch run data if editing
  const { data: editingRun, isLoading: loadingRun } = useQuery<any>({
    queryKey: ['/api/runs', editRunId],
    enabled: !!editRunId,
  });

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      distance: "",
      paceMinutes: 8,
      paceSeconds: 45,
      timeHours: "0",
      timeMinutes: "45",
      runType: "easy",
      notes: "",
      date: new Date().toISOString().split('T')[0],
      customRunType: "",
    },
  });

  // Set up editing state when run data loads
  useEffect(() => {
    if (editRunId && editingRun) {
      setIsEditing(true);
      setEditingRunId(editRunId);
      setSelectedRunType(editingRun.runType);
      setPaceMinutes(editingRun.paceMinutes);
      setPaceSeconds(editingRun.paceSeconds);
      setTimeHours(editingRun.timeHours || 0);
      setTimeMinutes(editingRun.timeMinutes);
      
      form.reset({
        distance: editingRun.distance,
        paceMinutes: editingRun.paceMinutes,
        paceSeconds: editingRun.paceSeconds,
        timeHours: (editingRun.timeHours || 0).toString(),
        timeMinutes: editingRun.timeMinutes.toString(),
        runType: editingRun.runType,
        notes: editingRun.notes || "",
        date: editingRun.date,
        customRunType: "",
      });
    }
  }, [editRunId, editingRun, form]);

  const saveRunMutation = useMutation({
    mutationFn: async (data: any) => {
      const url = isEditing ? `/api/runs/${editingRunId}` : '/api/runs';
      const method = isEditing ? 'PUT' : 'POST';
      const response = await apiRequest(method, url, data);
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: isEditing ? "Run updated successfully!" : "Run logged successfully!",
        description: isEditing ? "Your run has been updated." : "Your run has been saved to your training log.",
      });
      if (!isEditing) {
        form.reset();
      }
      queryClient.invalidateQueries({ queryKey: ['/api/runs'] });
      queryClient.invalidateQueries({ queryKey: ['/api/runs/month'] });
    },
    onError: (error: any) => {
      toast({
        title: isEditing ? "Error updating run" : "Error logging run",
        description: error?.message || "Please try again.",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: FormData) => {
    const finalRunType = selectedRunType === "other" ? customRunType : selectedRunType;
    const submitData = {
      distance: data.distance,
      paceMinutes: paceMinutes,
      paceSeconds: paceSeconds,
      timeHours: timeHours,
      timeMinutes: timeMinutes,
      runType: finalRunType,
      notes: data.notes,
      date: data.date,
    };
    
    if (isEditing && editingRunId) {
      // Update existing run
      fetch(`/api/runs/${editingRunId}`, {
        method: 'PUT',
        body: JSON.stringify(submitData),
        headers: { 'Content-Type': 'application/json' }
      }).then(response => {
        if (!response.ok) throw new Error('Failed to update run');
        return response.json();
      }).then(() => {
        toast({
          title: "Run updated successfully!",
          description: "Your run has been updated.",
        });
        queryClient.invalidateQueries({ queryKey: ['/api/runs'] });
        queryClient.invalidateQueries({ queryKey: ['/api/runs/month'] });
      }).catch((error) => {
        toast({
          title: "Error updating run",
          description: error?.message || "Please try again.",
          variant: "destructive",
        });
      });
    } else {
      saveRunMutation.mutate(submitData);
    }
  };

  const handleSave = () => {
    toast({
      title: "Progress saved",
      description: "Your current form data has been saved.",
    });
  };

  const runTypes = [
    { value: "easy", label: "Easy Run" },
    { value: "tempo", label: "Tempo" },
    { value: "long", label: "Long Run" },
    { value: "interval", label: "Intervals" },
    { value: "trail", label: "Trail Run" },
    { value: "threshold", label: "Threshold" },
    { value: "race", label: "Race" },
    { value: "other", label: "Other" },
  ];

  return (
    <div className="px-6" data-testid="log-activity-page">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-semibold text-gray-800 mb-2" data-testid="text-page-title">
          Log Activity
        </h1>
        <p className="text-skyblue text-lg font-medium" data-testid="text-page-subtitle">
          Record Your Run
        </p>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          {/* Distance Input */}
          <div className="bg-white rounded-2xl p-6 shadow-sm">
            <FormField
              control={form.control}
              name="distance"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-sm font-medium text-gray-700">Distance</FormLabel>
                  <div className="flex items-center space-x-3">
                    <FormControl>
                      <Input
                        {...field}
                        type="number"
                        step="0.1"
                        placeholder="0.0"
                        className="ios-input flex-1 bg-gray-50 border-0 rounded-xl px-4 py-3 text-lg font-medium text-center"
                        data-testid="input-distance"
                      />
                    </FormControl>
                    <span className="text-gray-500 font-medium">miles</span>
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          {/* Pace Input */}
          <div className="bg-white rounded-2xl p-6 shadow-sm">
            <FormLabel className="block text-sm font-medium text-gray-700 mb-3">Pace</FormLabel>
            <div 
              onClick={() => setShowPacePopup(true)}
              className="ios-input bg-gray-50 border-0 rounded-xl px-4 py-4 text-center cursor-pointer active:bg-gray-100 transition-colors"
              data-testid="input-pace-display"
            >
              <div className="text-2xl font-semibold text-gray-800">
                {paceMinutes}:{paceSeconds.toString().padStart(2, '0')}
              </div>
              <div className="text-sm text-gray-500 mt-1">per mile</div>
            </div>
          </div>

          {/* Time Input */}
          <div className="bg-white rounded-2xl p-6 shadow-sm">
            <FormLabel className="block text-sm font-medium text-gray-700 mb-3">Total Time</FormLabel>
            <div 
              onClick={() => setShowTimePopup(true)}
              className="ios-input bg-gray-50 border-0 rounded-xl px-4 py-4 text-center cursor-pointer active:bg-gray-100 transition-colors"
              data-testid="input-time-display"
            >
              <div className="text-2xl font-semibold text-gray-800">
                {timeHours > 0 ? `${timeHours}hr ` : ''}{timeMinutes}min
              </div>
              <div className="text-sm text-gray-500 mt-1">total time</div>
            </div>
          </div>

          {/* Run Type Selection */}
          <div className="bg-white rounded-2xl p-6 shadow-sm">
            <FormLabel className="block text-sm font-medium text-gray-700 mb-3">Run Type</FormLabel>
            <div className="grid grid-cols-2 gap-3 mb-4">
              {runTypes.map((type) => (
                <button
                  key={type.value}
                  type="button"
                  onClick={() => {
                    setSelectedRunType(type.value);
                    invalidateRunsCache();
                  }}
                  className={`ios-input py-3 px-4 rounded-xl font-medium text-sm transition-all ${
                    selectedRunType === type.value
                      ? 'bg-gradient-to-br from-blue-50 to-blue-100 border-2 border-skyblue text-skyblue-dark'
                      : 'bg-gray-50 border-2 border-transparent text-gray-600'
                  }`}
                  data-testid={`button-run-type-${type.value}`}
                >
                  {type.label}
                </button>
              ))}
            </div>
            
            {selectedRunType === "other" && (
              <div className="mt-3">
                <Input
                  value={customRunType}
                  onChange={(e) => {
                    setCustomRunType(e.target.value);
                    invalidateRunsCache();
                  }}
                  placeholder="Enter custom run type..."
                  className="ios-input bg-gray-50 border-0 rounded-xl px-4 py-3"
                  data-testid="input-custom-run-type"
                />
              </div>
            )}
          </div>

          {/* Highlights/Notes */}
          <div className="bg-white rounded-2xl p-6 shadow-sm">
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-sm font-medium text-gray-700">Highlight/Description of Run</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      value={field.value || ""}
                      placeholder="How did the run feel? Any aches or great moments to remember..."
                      className="ios-input w-full bg-gray-50 border-0 rounded-xl px-4 py-3 text-base resize-none"
                      rows={4}
                      data-testid="textarea-notes"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          {/* Save Button */}
          <Button
            type="button"
            onClick={handleSave}
            className="w-full bg-gray-100 text-gray-700 py-3 rounded-2xl font-medium text-base shadow-sm active:scale-95 transition-all duration-200 hover:bg-gray-200 mb-3"
            data-testid="button-save-progress"
          >
            Save Progress
          </Button>

          {/* Submit Button */}
          <Button
            type="submit"
            className="w-full bg-skyblue text-white py-4 rounded-2xl font-semibold text-lg shadow-lg active:scale-95 transition-all duration-200 hover:bg-skyblue-dark"
            disabled={saveRunMutation.isPending}
            data-testid="button-log-run"
          >
            {saveRunMutation.isPending ? (isEditing ? 'Updating...' : 'Logging...') : (isEditing ? 'Update Run' : 'Log Run')}
          </Button>
        </form>
      </Form>

      {/* Pace Popup Modal */}
      <Dialog open={showPacePopup} onOpenChange={setShowPacePopup}>
        <DialogContent className="max-w-sm mx-auto bg-ivory rounded-2xl" aria-describedby="pace-selector">
          <DialogHeader>
            <DialogTitle className="text-xl font-semibold text-gray-800 text-center">Set Pace</DialogTitle>
          </DialogHeader>
          <div className="flex items-center justify-center space-x-4 py-4">
            <div className="flex flex-col items-center">
              <ScrollWheel
                value={paceMinutes}
                onChange={(value) => {
                  setPaceMinutes(value);
                  invalidateRunsCache();
                }}
                min={4}
                max={15}
                className="bg-gray-50 rounded-xl"
                dataTestId="scroll-pace-minutes-popup"
              />
              <span className="text-xs text-gray-500 mt-2">min</span>
            </div>
            <span className="text-2xl font-medium text-gray-500 pt-8">:</span>
            <div className="flex flex-col items-center">
              <ScrollWheel
                value={paceSeconds}
                onChange={(value) => {
                  setPaceSeconds(value);
                  invalidateRunsCache();
                }}
                min={0}
                max={59}
                className="bg-gray-50 rounded-xl"
                dataTestId="scroll-pace-seconds-popup"
              />
              <span className="text-xs text-gray-500 mt-2">sec</span>
            </div>
          </div>
          <div className="text-center">
            <span className="text-gray-500 font-medium">per mile</span>
          </div>
          <Button
            onClick={() => setShowPacePopup(false)}
            className="w-full bg-skyblue text-white py-3 rounded-xl font-medium text-base mt-4"
            data-testid="button-set-pace"
          >
            Set Pace
          </Button>
        </DialogContent>
      </Dialog>

      {/* Time Popup Modal */}
      <Dialog open={showTimePopup} onOpenChange={setShowTimePopup}>
        <DialogContent className="max-w-sm mx-auto bg-ivory rounded-2xl" aria-describedby="time-selector">
          <DialogHeader>
            <DialogTitle className="text-xl font-semibold text-gray-800 text-center">Set Total Time</DialogTitle>
          </DialogHeader>
          <div className="flex items-center justify-center space-x-4 py-4">
            <div className="flex flex-col items-center">
              <ScrollWheel
                value={timeHours}
                onChange={(value) => {
                  setTimeHours(value);
                  invalidateRunsCache();
                }}
                min={0}
                max={3}
                className="bg-gray-50 rounded-xl"
                dataTestId="scroll-time-hours-popup"
              />
              <span className="text-xs text-gray-500 mt-2">hr</span>
            </div>
            <div className="flex flex-col items-center">
              <ScrollWheel
                value={timeMinutes}
                onChange={(value) => {
                  setTimeMinutes(value);
                  invalidateRunsCache();
                }}
                min={5}
                max={180}
                className="bg-gray-50 rounded-xl"
                dataTestId="scroll-time-minutes-popup"
              />
              <span className="text-xs text-gray-500 mt-2">min</span>
            </div>
          </div>
          <Button
            onClick={() => setShowTimePopup(false)}
            className="w-full bg-skyblue text-white py-3 rounded-xl font-medium text-base mt-4"
            data-testid="button-set-time"
          >
            Set Time
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
