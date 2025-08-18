import { useState, useRef, useEffect } from "react";
import { IOSFeedbackManager, IOSPerformanceManager, isNative } from '@/lib/ios-utils';

interface ScrollWheelProps {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  className?: string;
  dataTestId?: string;
}

export default function ScrollWheel({ value, onChange, min, max, className = "", dataTestId }: ScrollWheelProps) {
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const itemHeight = 40;
  const visibleItems = 5;

  const items = Array.from({ length: max - min + 1 }, (_, i) => min + i);
  const selectedIndex = items.indexOf(value);

  useEffect(() => {
    if (containerRef.current) {
      const scrollTop = selectedIndex * itemHeight;
      containerRef.current.scrollTop = scrollTop;
      
      // Apply iOS performance optimizations if running on native platform
      if (isNative()) {
        IOSPerformanceManager.optimizeScrolling(containerRef.current);
        IOSPerformanceManager.optimizeAnimations(containerRef.current);
      }
    }
  }, [value, selectedIndex]);

  const handleScroll = async () => {
    if (!containerRef.current || isDragging) return;
    
    const scrollTop = containerRef.current.scrollTop;
    const newIndex = Math.round(scrollTop / itemHeight);
    const newValue = items[newIndex];
    
    if (newValue !== value && newValue >= min && newValue <= max) {
      // Trigger light haptic feedback for smooth scrolling on iOS
      await IOSFeedbackManager.lightImpact();
      onChange(newValue);
    }
  };

  const handleItemClick = async (clickedValue: number) => {
    // Trigger medium haptic feedback for direct selection on iOS
    await IOSFeedbackManager.mediumImpact();
    onChange(clickedValue);
  };

  return (
    <div
      ref={containerRef}
      className={`relative overflow-hidden h-48 ${className}`}
      style={{ height: `${visibleItems * itemHeight}px` }}
      onScroll={handleScroll}
      data-testid={dataTestId}
      data-scroll-container
    >
      {/* Top fade */}
      <div className="absolute top-0 left-0 right-0 h-8 bg-gradient-to-b from-white to-transparent z-10 pointer-events-none" />
      
      {/* Bottom fade */}
      <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-white to-transparent z-10 pointer-events-none" />
      
      {/* Selection indicator */}
      <div 
        className="absolute left-0 right-0 border-t border-b border-skyblue bg-skyblue bg-opacity-10 z-5 pointer-events-none"
        style={{ 
          top: `${Math.floor(visibleItems / 2) * itemHeight}px`,
          height: `${itemHeight}px`
        }}
      />
      
      <div className="relative" style={{ paddingTop: `${Math.floor(visibleItems / 2) * itemHeight}px`, paddingBottom: `${Math.floor(visibleItems / 2) * itemHeight}px` }}>
        {items.map((item, index) => {
          const distance = Math.abs(index - selectedIndex);
          const opacity = distance === 0 ? 1 : distance <= 2 ? 0.4 : 0.2;
          const scale = distance === 0 ? 1 : 0.8;
          
          return (
            <div
              key={item}
              className="flex items-center justify-center cursor-pointer transition-all duration-200"
              style={{ 
                height: `${itemHeight}px`,
                opacity,
                transform: `scale(${scale})`,
              }}
              onClick={() => handleItemClick(item)}
            >
              <span className="text-lg font-medium text-gray-700">
                {item.toString().padStart(2, '0')}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}