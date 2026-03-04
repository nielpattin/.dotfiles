import React, { useEffect, useRef, useState, useCallback } from 'react';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import mermaid from 'mermaid';

interface MermaidZoomableProps {
  chart: string;
  className?: string;
  id?: string;
  theme?: 'light' | 'dark' | 'forest' | 'neutral' | 'base';
  maxWidth?: number;
  maxHeight?: number;
  showControls?: boolean;
  enablePan?: boolean;
  enableZoom?: boolean;
  enableWheel?: boolean;
  initialScale?: number;
  minScale?: number;
  maxScale?: number;
  onDiagramClick?: (event: React.MouseEvent) => void;
  onError?: (error: Error) => void;
}

interface SvgDimensions {
  width: number;
  height: number;
  viewBox: string;
}

const MermaidZoomable: React.FC<MermaidZoomableProps> = ({
  chart,
  className = '',
  id,
  theme = 'default',
  maxWidth = 1200,
  maxHeight = 800,
  showControls = true,
  enablePan = true,
  enableZoom = true,
  enableWheel = true,
  initialScale = 1,
  minScale = 0.1,
  maxScale = 5,
  onDiagramClick,
  onError,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [dimensions, setDimensions] = useState<SvgDimensions | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);

  // Generate unique ID for this diagram
  const diagramId = id || `mermaid-${Math.random().toString(36).substr(2, 9)}`;

  // Initialize Mermaid configuration
  useEffect(() => {
    if (!isInitialized) {
      mermaid.initialize({
        startOnLoad: false,
        theme,
        themeVariables: {
          background: 'transparent',
        },
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: 14,
        flowchart: {
          htmlLabels: true,
          curve: 'basis',
        },
        securityLevel: 'loose',
      });
      setIsInitialized(true);
    }
  }, [theme, isInitialized]);

  // Calculate SVG dimensions with fallbacks
  const calculateSvgDimensions = useCallback((svgElement: SVGSVGElement): SvgDimensions => {
    let viewBox = svgElement.getAttribute('viewBox');
    let width = 0;
    let height = 0;

    // Try to get dimensions from viewBox first
    if (viewBox) {
      const values = viewBox.split(/\s+/).map(Number);
      if (values.length === 4 && !values.some(isNaN)) {
        width = values[2];
        height = values[3];
      }
    }

    // Fallback to getBBox if viewBox is invalid
    if (!width || !height) {
      try {
        const bbox = svgElement.getBBox();
        width = bbox.width + bbox.x;
        height = bbox.height + bbox.y;
        viewBox = `${bbox.x} ${bbox.y} ${width} ${height}`;
      } catch (e) {
        console.warn('Failed to get BBox:', e);
        // Final fallback to natural dimensions
        width = svgElement.clientWidth || 800;
        height = svgElement.clientHeight || 600;
        viewBox = `0 0 ${width} ${height}`;
      }
    }

    return {
      width: Math.max(width, 100),
      height: Math.max(height, 100),
      viewBox: viewBox || `0 0 ${width} ${height}`,
    };
  }, []);

  // Clean up SVG styles that cause clipping
  const cleanupSvgStyles = useCallback((svgElement: SVGSVGElement) => {
    // Remove problematic inline styles
    svgElement.style.maxWidth = 'none';
    svgElement.style.width = '';
    svgElement.style.height = '';
    
    // Remove width/height attributes that might constrain the SVG
    if (svgElement.getAttribute('width') && svgElement.getAttribute('height')) {
      const dims = calculateSvgDimensions(svgElement);
      svgElement.setAttribute('width', dims.width.toString());
      svgElement.setAttribute('height', dims.height.toString());
    }
  }, [calculateSvgDimensions]);

  // Render Mermaid diagram
  const renderDiagram = useCallback(async () => {
    if (!chart || !containerRef.current) return;

    setIsLoading(true);
    setError(null);

    try {
      // Clear previous content
      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }

      // Render diagram
      const { svg } = await mermaid.render(`${diagramId}-svg`, chart);
      
      // Create a temporary div to hold the SVG
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = svg;
      const svgElement = tempDiv.querySelector('svg') as SVGSVGElement;

      if (!svgElement) {
        throw new Error('Failed to render SVG from Mermaid');
      }

      // Apply cleanup
      cleanupSvgStyles(svgElement);
      
      // Set reference for later use
      svgRef.current = svgElement;

      // Calculate dimensions using double requestAnimationFrame for proper rendering
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const dims = calculateSvgDimensions(svgElement);
          
          // Apply calculated dimensions and viewBox
          svgElement.setAttribute('viewBox', dims.viewBox);
          svgElement.setAttribute('width', dims.width.toString());
          svgElement.setAttribute('height', dims.height.toString());
          
          // Set CSS for proper rendering
          svgElement.style.width = `${dims.width}px`;
          svgElement.style.height = `${dims.height}px`;
          svgElement.style.display = 'block';
          svgElement.style.overflow = 'visible';

          // Add to container
          if (containerRef.current) {
            containerRef.current.appendChild(svgElement);
            setDimensions(dims);
            setIsLoading(false);
          }
        });
      });

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to render diagram';
      setError(errorMessage);
      setIsLoading(false);
      onError?.(err instanceof Error ? err : new Error(errorMessage));
    }
  }, [chart, diagramId, calculateSvgDimensions, cleanupSvgStyles, onError]);

  // Trigger render when dependencies change
  useEffect(() => {
    if (isInitialized) {
      renderDiagram();
    }
  }, [renderDiagram, isInitialized]);

  // Handle diagram clicks
  const handleDiagramClick = useCallback((event: React.MouseEvent) => {
    onDiagramClick?.(event);
  }, [onDiagramClick]);

  if (error) {
    return (
      <div className={`mermaid-error ${className}`} style={{
        padding: '1rem',
        border: '1px solid #ef4444',
        borderRadius: '0.5rem',
        backgroundColor: '#fef2f2',
        color: '#991b1b',
        maxWidth: `${maxWidth}px`,
      }}>
        <div style={{ fontWeight: 'bold', marginBottom: '0.5rem' }}>
          Mermaid Rendering Error
        </div>
        <div style={{ fontSize: '0.875rem' }}>{error}</div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className={`mermaid-loading ${className}`} style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '200px',
        border: '1px solid #e5e7eb',
        borderRadius: '0.5rem',
        backgroundColor: '#f9fafb',
        maxWidth: `${maxWidth}px`,
      }}>
        <div style={{ color: '#6b7280' }}>Loading diagram...</div>
      </div>
    );
  }

  if (!dimensions) {
    return null;
  }

  const containerWidth = Math.min(dimensions.width, maxWidth);
  const containerHeight = Math.min(dimensions.height, maxHeight);

  return (
    <div className={`mermaid-zoomable-wrapper ${className}`} style={{
      position: 'relative',
      width: `${containerWidth}px`,
      height: `${containerHeight}px`,
      border: '1px solid #e5e7eb',
      borderRadius: '0.5rem',
      overflow: 'hidden',
      backgroundColor: theme === 'dark' ? '#1f2937' : '#ffffff',
    }}>
      <TransformWrapper
        initialScale={initialScale}
        minScale={minScale}
        maxScale={maxScale}
        centerOnInit={true}
        wheel={{ enabled: enableWheel }}
        pan={{ enabled: enablePan, disableOnTarget: ['.mermaid-control'] }}
        pinch={{ enabled: true }}
        doubleClick={{ disabled: !enableZoom }}
        style={{
          width: '100%',
          height: '100%',
        }}
      >
        {({ zoomIn, zoomOut, resetTransform, centerView }) => (
          <>
            {showControls && (
              <div className="mermaid-controls" style={{
                position: 'absolute',
                top: '0.5rem',
                right: '0.5rem',
                display: 'flex',
                gap: '0.25rem',
                zIndex: 10,
                background: 'rgba(255, 255, 255, 0.9)',
                borderRadius: '0.375rem',
                padding: '0.25rem',
                boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
                backdropFilter: 'blur(8px)',
              }}>
                <button
                  className="mermaid-control"
                  onClick={() => zoomIn()}
                  disabled={!enableZoom}
                  title="Zoom In"
                  style={{
                    width: '2rem',
                    height: '2rem',
                    border: 'none',
                    background: 'transparent',
                    color: theme === 'dark' ? '#9ca3af' : '#4b5563',
                    cursor: enableZoom ? 'pointer' : 'not-allowed',
                    borderRadius: '0.25rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '1rem',
                    transition: 'all 0.2s',
                  }}
                  onMouseEnter={(e) => {
                    if (enableZoom) {
                      e.currentTarget.style.backgroundColor = theme === 'dark' ? 'rgba(55, 65, 81, 0.8)' : 'rgba(37, 99, 235, 0.1)';
                      e.currentTarget.style.color = '#2563eb';
                    }
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent';
                    e.currentTarget.style.color = theme === 'dark' ? '#9ca3af' : '#4b5563';
                  }}
                >
                  +
                </button>
                <button
                  className="mermaid-control"
                  onClick={() => zoomOut()}
                  disabled={!enableZoom}
                  title="Zoom Out"
                  style={{
                    width: '2rem',
                    height: '2rem',
                    border: 'none',
                    background: 'transparent',
                    color: theme === 'dark' ? '#9ca3af' : '#4b5563',
                    cursor: enableZoom ? 'pointer' : 'not-allowed',
                    borderRadius: '0.25rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '1rem',
                    transition: 'all 0.2s',
                  }}
                  onMouseEnter={(e) => {
                    if (enableZoom) {
                      e.currentTarget.style.backgroundColor = theme === 'dark' ? 'rgba(55, 65, 81, 0.8)' : 'rgba(37, 99, 235, 0.1)';
                      e.currentTarget.style.color = '#2563eb';
                    }
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent';
                    e.currentTarget.style.color = theme === 'dark' ? '#9ca3af' : '#4b5563';
                  }}
                >
                  −
                </button>
                <button
                  className="mermaid-control"
                  onClick={() => resetTransform()}
                  title="Reset View"
                  style={{
                    width: '2rem',
                    height: '2rem',
                    border: 'none',
                    background: 'transparent',
                    color: theme === 'dark' ? '#9ca3af' : '#4b5563',
                    cursor: 'pointer',
                    borderRadius: '0.25rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '1rem',
                    transition: 'all 0.2s',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = theme === 'dark' ? 'rgba(55, 65, 81, 0.8)' : 'rgba(37, 99, 235, 0.1)';
                    e.currentTarget.style.color = '#2563eb';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent';
                    e.currentTarget.style.color = theme === 'dark' ? '#9ca3af' : '#4b5563';
                  }}
                >
                  ⟲
                </button>
                <button
                  className="mermaid-control"
                  onClick={() => centerView()}
                  title="Center View"
                  style={{
                    width: '2rem',
                    height: '2rem',
                    border: 'none',
                    background: 'transparent',
                    color: theme === 'dark' ? '#9ca3af' : '#4b5563',
                    cursor: 'pointer',
                    borderRadius: '0.25rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '1rem',
                    transition: 'all 0.2s',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = theme === 'dark' ? 'rgba(55, 65, 81, 0.8)' : 'rgba(37, 99, 235, 0.1)';
                    e.currentTarget.style.color = '#2563eb';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent';
                    e.currentTarget.style.color = theme === 'dark' ? '#9ca3af' : '#4b5563';
                  }}
                >
                  ⊡
                </button>
              </div>
            )}
            <TransformComponent
              wrapperStyle={{
                width: '100%',
                height: '100%',
              }}
              contentStyle={{
                width: '100%',
                height: '100%',
                willChange: 'transform',
                transform: 'translateZ(0)', // Hardware acceleration
                backfaceVisibility: 'hidden' as const,
                perspective: '1000px',
              }}
            >
              <div
                ref={containerRef}
                className="mermaid-diagram-container"
                onClick={handleDiagramClick}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '100%',
                  height: '100%',
                  contain: 'layout paint style', // Performance optimization
                }}
              />
            </TransformComponent>
          </>
        )}
      </TransformWrapper>
    </div>
  );
};

export default MermaidZoomable;