import { useRef, useEffect, useCallback } from 'react';

export interface PerformanceMetrics {
  renderTime: number;
  dimensionCalculationTime: number;
  svgCleanupTime: number;
  lastInteractionTime: number;
  zoomLevel: number;
  panPosition: { x: number; y: number };
}

export const usePerformanceMonitor = () => {
  const metricsRef = useRef<PerformanceMetrics>({
    renderTime: 0,
    dimensionCalculationTime: 0,
    svgCleanupTime: 0,
    lastInteractionTime: Date.now(),
    zoomLevel: 1,
    panPosition: { x: 0, y: 0 },
  });

  const startTiming = useCallback(() => {
    return performance.now();
  }, []);

  const endTiming = useCallback((startTime: number, metricName: keyof PerformanceMetrics) => {
    const duration = performance.now() - startTime;
    metricsRef.current[metricName] = duration;
    return duration;
  }, []);

  const recordInteraction = useCallback(() => {
    metricsRef.current.lastInteractionTime = Date.now();
  }, []);

  const updateZoomLevel = useCallback((level: number) => {
    metricsRef.current.zoomLevel = level;
  }, []);

  const updatePanPosition = useCallback((x: number, y: number) => {
    metricsRef.current.panPosition = { x, y };
  }, []);

  const getMetrics = useCallback(() => {
    return { ...metricsRef.current };
  }, []);

  const logMetrics = useCallback(() => {
    console.group('MermaidZoomable Performance Metrics');
    console.log('Render Time:', `${metricsRef.current.renderTime.toFixed(2)}ms`);
    console.log('Dimension Calculation:', `${metricsRef.current.dimensionCalculationTime.toFixed(2)}ms`);
    console.log('SVG Cleanup:', `${metricsRef.current.svgCleanupTime.toFixed(2)}ms`);
    console.log('Current Zoom Level:', metricsRef.current.zoomLevel);
    console.log('Pan Position:', metricsRef.current.panPosition);
    console.log('Last Interaction:', new Date(metricsRef.current.lastInteractionTime).toLocaleTimeString());
    console.groupEnd();
  }, []);

  return {
    startTiming,
    endTiming,
    recordInteraction,
    updateZoomLevel,
    updatePanPosition,
    getMetrics,
    logMetrics,
  };
};