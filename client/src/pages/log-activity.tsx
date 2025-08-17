import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { insertRunSchema } from "@shared/schema";

const formSchema = insertRunSchema.extend({
  distance: z.string().min(1, "Distance is required"),
  paceMinutes: z.string().min(1, "Pace minutes required"),
  paceSeconds: z.string().min(1, "Pace seconds required"),
  timeHours: z.string(),
  timeMinutes: z.string().min(1, "Time minutes required"),
});

type FormData = z.infer<typeof formSchema>;

export default function LogActivity() {
  const [selectedRunType, setSelectedRunType] = useState<string>("easy");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      distance: "",
      paceMinutes: "8",
      paceSeconds: "45",
      timeHours: "0",
      timeMinutes: "45",
      runType: "easy",
      notes: "",
      date: new Date().toISOString().split('T')[0],
    },
  });

  const createRunMutation = useMutation({
    mutationFn: async (data: any) => {
      const response = await apiRequest('POST', '/api/runs', data);
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Run logged successfully!",
        description: "Your run has been saved to your training log.",
      });
      form.reset();
      queryClient.invalidateQueries({ queryKey: ['/api/runs'] });
      queryClient.invalidateQueries({ queryKey: ['/api/runs/month'] });
    },
    onError: () => {
      toast({
        title: "Error logging run",
        description: "Please try again.",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: FormData) => {
    const submitData = {
      distance: data.distance,
      paceMinutes: parseInt(data.paceMinutes),
      paceSeconds: parseInt(data.paceSeconds),
      timeHours: parseInt(data.timeHours),
      timeMinutes: parseInt(data.timeMinutes),
      runType: selectedRunType,
      notes: data.notes,
      date: data.date,
    };
    createRunMutation.mutate(submitData);
  };

  const runTypes = [
    { value: "easy", label: "Easy Run" },
    { value: "tempo", label: "Tempo" },
    { value: "long", label: "Long Run" },
    { value: "interval", label: "Intervals" },
    { value: "trail", label: "Trail Run" },
    { value: "threshold", label: "Threshold" },
    { value: "workout", label: "Workout" },
    { value: "race", label: "Race" },
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
            <div className="flex items-center justify-center space-x-2">
              <FormField
                control={form.control}
                name="paceMinutes"
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger 
                          className="ios-input bg-gray-50 border-0 rounded-xl px-3 py-3 text-lg font-medium text-center w-20"
                          data-testid="select-pace-minutes"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Array.from({ length: 8 }, (_, i) => i + 5).map((num) => (
                            <SelectItem key={num} value={num.toString()}>
                              {num}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormControl>
                  </FormItem>
                )}
              />
              <span className="text-lg font-medium text-gray-500">:</span>
              <FormField
                control={form.control}
                name="paceSeconds"
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger 
                          className="ios-input bg-gray-50 border-0 rounded-xl px-3 py-3 text-lg font-medium text-center w-20"
                          data-testid="select-pace-seconds"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="00">00</SelectItem>
                          <SelectItem value="15">15</SelectItem>
                          <SelectItem value="30">30</SelectItem>
                          <SelectItem value="45">45</SelectItem>
                        </SelectContent>
                      </Select>
                    </FormControl>
                  </FormItem>
                )}
              />
              <span className="text-gray-500 font-medium">per mile</span>
            </div>
          </div>

          {/* Time Input */}
          <div className="bg-white rounded-2xl p-6 shadow-sm">
            <FormLabel className="block text-sm font-medium text-gray-700 mb-3">Total Time</FormLabel>
            <div className="flex items-center justify-center space-x-2">
              <FormField
                control={form.control}
                name="timeHours"
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger 
                          className="ios-input bg-gray-50 border-0 rounded-xl px-3 py-3 text-lg font-medium text-center w-20"
                          data-testid="select-time-hours"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Array.from({ length: 4 }, (_, i) => i).map((num) => (
                            <SelectItem key={num} value={num.toString()}>
                              {num}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormControl>
                  </FormItem>
                )}
              />
              <span className="text-lg font-medium text-gray-500">h</span>
              <FormField
                control={form.control}
                name="timeMinutes"
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger 
                          className="ios-input bg-gray-50 border-0 rounded-xl px-3 py-3 text-lg font-medium text-center w-20"
                          data-testid="select-time-minutes"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Array.from({ length: 12 }, (_, i) => (i + 1) * 5).map((num) => (
                            <SelectItem key={num} value={num.toString()}>
                              {num}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormControl>
                  </FormItem>
                )}
              />
              <span className="text-lg font-medium text-gray-500">min</span>
            </div>
          </div>

          {/* Run Type Selection */}
          <div className="bg-white rounded-2xl p-6 shadow-sm">
            <FormLabel className="block text-sm font-medium text-gray-700 mb-3">Run Type</FormLabel>
            <div className="grid grid-cols-2 gap-3">
              {runTypes.map((type) => (
                <button
                  key={type.value}
                  type="button"
                  onClick={() => setSelectedRunType(type.value)}
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
          </div>

          {/* Highlights/Notes */}
          <div className="bg-white rounded-2xl p-6 shadow-sm">
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-sm font-medium text-gray-700">Highlight of Run</FormLabel>
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

          {/* Submit Button */}
          <Button
            type="submit"
            className="w-full bg-skyblue text-white py-4 rounded-2xl font-semibold text-lg shadow-lg active:scale-95 transition-all duration-200 hover:bg-skyblue-dark"
            disabled={createRunMutation.isPending}
            data-testid="button-log-run"
          >
            {createRunMutation.isPending ? 'Logging...' : 'Log Run'}
          </Button>
        </form>
      </Form>
    </div>
  );
}
