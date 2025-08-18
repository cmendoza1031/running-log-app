import { useEffect, useRef } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  LineController,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  LineController,
  Title,
  Tooltip,
  Legend,
  Filler
);

interface WeeklyChartProps {
  data: {
    labels: string[];
    values: number[];
    times?: number[];
  };
  onDotClick?: (weekIndex: number, weekLabel: string, miles: number, time?: number) => void;
}

export default function WeeklyChart({ data, onDotClick }: WeeklyChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<ChartJS | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    // Destroy existing chart
    if (chartRef.current) {
      chartRef.current.destroy();
    }

    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;

    const chartData = {
      labels: data.labels,
      datasets: [{
        label: 'Weekly Miles',
        data: data.values,
        borderColor: '#4A90E2',
        backgroundColor: 'rgba(74, 144, 226, 0.1)',
        fill: true,
        tension: 0.4,
        pointBackgroundColor: '#4A90E2',
        pointBorderColor: '#ffffff',
        pointBorderWidth: 2,
        pointRadius: 6,
        pointHoverRadius: 8,
      }]
    };

    chartRef.current = new ChartJS(ctx, {
      type: 'line',
      data: chartData,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: false
          },
          tooltip: {
            backgroundColor: 'rgba(255, 255, 255, 0.9)',
            titleColor: '#374151',
            bodyColor: '#374151',
            borderColor: '#4A90E2',
            borderWidth: 1,
            cornerRadius: 8,
            callbacks: {
              afterBody: (context: any) => {
                if (data.times && data.times[context[0].dataIndex]) {
                  const totalMinutes = data.times[context[0].dataIndex];
                  const hours = Math.floor(totalMinutes / 60);
                  const minutes = totalMinutes % 60;
                  const timeText = hours === 0 ? `${minutes}min` : `${hours}hr ${minutes}min`;
                  return [`Total time: ${timeText}`];
                }
                return [];
              }
            }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            max: Math.max(30, Math.max(...data.values) + 5),
            grid: {
              color: 'rgba(0,0,0,0.05)'
            },
            ticks: {
              color: '#9CA3AF',
              font: {
                size: 12
              }
            }
          },
          x: {
            grid: {
              display: false
            },
            ticks: {
              color: '#9CA3AF',
              font: {
                size: 12
              }
            }
          }
        },
        elements: {
          point: {
            hoverBackgroundColor: '#357ABD'
          }
        },
        onClick: (event: any, elements: any) => {
          if (elements && elements.length > 0 && onDotClick) {
            const elementIndex = elements[0].index;
            const weekLabel = data.labels[elementIndex];
            const miles = data.values[elementIndex];
            const time = data.times ? data.times[elementIndex] : undefined;
            onDotClick(elementIndex, weekLabel, miles, time);
          }
        }
      }
    });

    return () => {
      if (chartRef.current) {
        chartRef.current.destroy();
      }
    };
  }, [data]);

  return (
    <div className="relative h-64" data-testid="weekly-chart">
      <canvas ref={canvasRef} />
    </div>
  );
}