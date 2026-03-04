import React, { useEffect, useRef, useState, useCallback, useLayoutEffect, useMemo } from 'react';
import mermaid from 'mermaid';
import { useTheme } from './ThemeProvider';
import { TransformWrapper, TransformComponent, useControls } from 'react-zoom-pan-pinch';

interface MermaidProps {
  content: string;
}

export const Mermaid: React.FC<MermaidProps> = ({ content }) => {
  const { theme } = useTheme();
  const [svg, setSvg] = useState<string>('');
  const [dimensions, setDimensions] = useState<{w: number, h: number} | null>(null);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const transformRef = useRef<any>(null);
  
  // Create a stable ID for this mermaid instance
  const mermaidId = useMemo(() => `mermaid-${Math.random().toString(36).slice(2, 11)}`, []);

  useEffect(() => {
    const effectiveTheme = theme === 'system' 
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'default')
      : (theme === 'dark' ? 'dark' : 'default');

    mermaid.initialize({
      startOnLoad: false,
      theme: effectiveTheme,
      securityLevel: 'loose',
      fontFamily: 'inherit',
      // Increase padding significantly to avoid clipping
      flowchart: { 
        padding: 20,
        useMaxWidth: false,
        htmlLabels: true,
        curve: 'basis'
      },
      sequence: {
        diagramMarginX: 30,
        diagramMarginY: 30,
        useMaxWidth: false,
      },
      gantt: {
        useMaxWidth: false,
      }
    });

    const renderDiagram = async () => {
      if (!content.trim()) return;
      
      try {
        const { svg: renderedSvg } = await mermaid.render(mermaidId, content);
        
        // Parse SVG to extract exact dimensions from viewBox
        const parser = new DOMParser();
        const doc = parser.parseFromString(renderedSvg, 'image/svg+xml');
        const svgElement = doc.querySelector('svg');
        
        if (svgElement) {
          const viewBox = svgElement.getAttribute('viewBox');
          if (viewBox) {
            const [, , w, h] = viewBox.split(' ').map(Number);
            setDimensions({ w, h });
          }

          // Clean up SVG attributes that interfere with pan/zoom
          svgElement.setAttribute('width', '100%');
          svgElement.setAttribute('height', '100%');
          svgElement.style.maxWidth = 'none';
          svgElement.style.display = 'block';
          
          // Remove all inline styles that might limit size
          svgElement.removeAttribute('style');
          
          setSvg(new XMLSerializer().serializeToString(doc));
        } else {
          setSvg(renderedSvg);
        }
        
        setError(null);
      } catch (err) {
        console.error('Mermaid rendering failed:', err);
        setError('Failed to render diagram. Please check your Mermaid syntax.');
      }
    };

    renderDiagram();
  }, [content, theme, mermaidId]);

  // Handle framing after SVG is injected
  useLayoutEffect(() => {
    if (svg && dimensions && transformRef.current && containerRef.current) {
      // Instant framing
      transformRef.current.resetTransform(0);
      transformRef.current.centerView(0.8, 0);
    }
  }, [svg, dimensions]);

  const handleDownload = useCallback(() => {
    if (!svg) return;
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'diagram.svg';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [svg]);

  // Memoize the diagram content to prevent re-parsing SVG during panning
  const diagramContent = useMemo(() => (
    <div 
      ref={containerRef}
      className="mermaid-container"
      style={dimensions ? { width: dimensions.w, height: dimensions.h } : {}}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  ), [svg, dimensions]);

  if (error && !svg) {
    return (
      <div className="my-5 p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm font-mono">
        {error}
      </div>
    );
  }

  return (
    <div className="mermaid-wrapper relative my-6 bg-muted/5 rounded-xl border border-border/30 overflow-hidden group/mermaid shadow-sm select-none">
      <style>{`
        .mermaid-grid {
          background-image: radial-gradient(circle, var(--color-border) 1px, transparent 1px);
          background-size: 32px 32px;
          opacity: 0.15;
          pointer-events: none;
        }
        .mermaid-container {
          display: block;
          position: relative;
          padding: 10px;
          background-color: transparent;
          /* FORCE NO TRANSITIONS */
          transition: none !important;
          animation: none !important;
        }
        .mermaid-container svg {
          display: block;
          width: 100%;
          height: 100%;
          margin: 0;
          overflow: visible;
          /* FORCE NO TRANSITIONS */
          transition: none !important;
          animation: none !important;
        }
        .react-transform-component, .react-transform-element {
          /* FORCE NO TRANSITIONS ON LIBRARY ELEMENTS */
          transition: none !important;
        }
      `}</style>
      
      <TransformWrapper
        ref={transformRef}
        initialScale={1}
        minScale={0.01}
        maxScale={100}
        doubleClick={{ mode: 'reset', animationTime: 0 } as any}
        panning={{ 
          velocityDisabled: true,
          animationTime: 0
        } as any}
        wheel={{ 
          step: 0.1,
          smooth: false, 
          activationKeys: [] 
        } as any}
        zoomAnimation={{
          disabled: true,
          animationTime: 0
        } as any}
        alignmentAnimation={{ 
          disabled: true,
          animationTime: 0
        } as any}
        limitToBounds={false}
      >
        {({ zoomIn, zoomOut, resetTransform, zoomToElement }) => (
          <>
            <div className="absolute inset-0 mermaid-grid" />
            
            <TransformComponent
              wrapperClass="!w-full !h-full min-h-[350px] max-h-[600px]"
              contentClass="cursor-grab active:cursor-grabbing"
            >
              {diagramContent}
            </TransformComponent>

            {/* Floating Controls - Maps style */}
            <div className="absolute bottom-4 right-4 z-20 flex items-center gap-1 opacity-0 group-hover/mermaid:opacity-100 transition-all duration-200 translate-y-2 group-hover/mermaid:translate-y-0 bg-popover/90 backdrop-blur-md border border-border rounded-lg p-1 shadow-xl">
              <ToolbarButton onClick={() => zoomIn(0.2, 0)} title="Zoom In">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
              </ToolbarButton>
              <ToolbarButton onClick={() => zoomOut(0.2, 0)} title="Zoom Out">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M20 12H4" />
                </svg>
              </ToolbarButton>
              <ToolbarButton onClick={() => {
                if (containerRef.current) {
                  zoomToElement(containerRef.current, 0.8, 0);
                }
              }} title="Fit to Screen">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
              </ToolbarButton>
              <ToolbarButton onClick={() => resetTransform(0)} title="Reset View">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </ToolbarButton>
              <div className="w-px h-4 bg-border mx-1" />
              <ToolbarButton onClick={handleDownload} title="Download SVG">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
              </ToolbarButton>
            </div>
          </>
        )}
      </TransformWrapper>
    </div>
  );
};

const ToolbarButton: React.FC<{ onClick: () => void; title: string; children: React.ReactNode }> = ({ onClick, title, children }) => (
  <button
    onClick={onClick}
    className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors active:scale-95 flex items-center justify-center"
    title={title}
  >
    {children}
  </button>
);
