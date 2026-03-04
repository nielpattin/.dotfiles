export interface SvgDimensions {
  width: number;
  height: number;
  viewBox: string;
  boundingBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface ProcessedSvg {
  dimensions: SvgDimensions;
  cleanedElement: SVGSVGElement;
  hasInvalidStyles: boolean;
}

/**
 * Calculate natural SVG dimensions with multiple fallback strategies
 */
export const calculateSvgDimensions = (svgElement: SVGSVGElement): SvgDimensions => {
  let viewBox = svgElement.getAttribute('viewBox');
  let width = 0;
  let height = 0;
  let boundingBox;

  // Strategy 1: Try viewBox first (most reliable)
  if (viewBox) {
    const values = viewBox.split(/[\s,]+/).map(Number);
    if (values.length === 4 && !values.some(isNaN)) {
      [, , width, height] = values;
      boundingBox = {
        x: values[0],
        y: values[1],
        width: values[2],
        height: values[3],
      };
    }
  }

  // Strategy 2: Try getBBox() (good for rendered SVGs)
  if ((!width || !height) && svgElement.getBBox) {
    try {
      const bbox = svgElement.getBBox();
      if (bbox.width > 0 && bbox.height > 0) {
        width = bbox.width + Math.abs(bbox.x);
        height = bbox.height + Math.abs(bbox.y);
        boundingBox = {
          x: bbox.x < 0 ? bbox.x : 0,
          y: bbox.y < 0 ? bbox.y : 0,
          width: bbox.width + Math.abs(bbox.x),
          height: bbox.height + Math.abs(bbox.y),
        };
        viewBox = `${boundingBox.x} ${boundingBox.y} ${width} ${height}`;
      }
    } catch (e) {
      console.warn('getBBox() failed:', e);
    }
  }

  // Strategy 3: Try getBoundingClientRect() (viewport dimensions)
  if ((!width || !height) && svgElement.getBoundingClientRect) {
    try {
      const rect = svgElement.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        width = rect.width;
        height = rect.height;
        viewBox = `0 0 ${width} ${height}`;
        boundingBox = { x: 0, y: 0, width, height };
      }
    } catch (e) {
      console.warn('getBoundingClientRect() failed:', e);
    }
  }

  // Strategy 4: Try width/height attributes
  if ((!width || !height) && svgElement.getAttribute('width') && svgElement.getAttribute('height')) {
    const attrWidth = parseFloat(svgElement.getAttribute('width') || '0');
    const attrHeight = parseFloat(svgElement.getAttribute('height') || '0');
    if (attrWidth > 0 && attrHeight > 0) {
      width = attrWidth;
      height = attrHeight;
      viewBox = `0 0 ${width} ${height}`;
      boundingBox = { x: 0, y: 0, width, height };
    }
  }

  // Strategy 5: Try computed styles
  if ((!width || !height) && svgElement.style) {
    const computedStyle = window.getComputedStyle(svgElement);
    const styleWidth = parseFloat(computedStyle.width || '0');
    const styleHeight = parseFloat(computedStyle.height || '0');
    if (styleWidth > 0 && styleHeight > 0) {
      width = styleWidth;
      height = styleHeight;
      viewBox = `0 0 ${width} ${height}`;
      boundingBox = { x: 0, y: 0, width, height };
    }
  }

  // Final fallback: reasonable defaults
  if (!width || !height) {
    console.warn('Could not determine SVG dimensions, using defaults');
    width = Math.max(width || 800, 100);
    height = Math.max(height || 600, 100);
    viewBox = viewBox || `0 0 ${width} ${height}`;
    boundingBox = { x: 0, y: 0, width, height };
  }

  return {
    width: Math.max(width, 100),
    height: Math.max(height, 100),
    viewBox,
    boundingBox,
  };
};

/**
 * Clean up problematic SVG styles and attributes
 */
export const cleanupSvgElement = (svgElement: SVGSVGElement): ProcessedSvg => {
  const clonedSvg = svgElement.cloneNode(true) as SVGSVGElement;
  let hasInvalidStyles = false;

  // Remove problematic inline styles that cause clipping
  const problematicStyles = [
    'max-width',
    'max-height',
    'min-width',
    'min-height',
    'overflow',
  ];

  problematicStyles.forEach(styleProp => {
    if (clonedSvg.style[styleProp as any]) {
      clonedSvg.style[styleProp as any] = '';
      hasInvalidStyles = true;
    }
  });

  // Remove width/height constraints that might interfere with zoom/pan
  if (clonedSvg.getAttribute('width') && clonedSvg.getAttribute('height')) {
    const dims = calculateSvgDimensions(clonedSvg);
    clonedSvg.setAttribute('width', dims.width.toString());
    clonedSvg.setAttribute('height', dims.height.toString());
    hasInvalidStyles = true;
  }

  // Remove style attribute entirely if it contains constraints
  const styleAttr = clonedSvg.getAttribute('style');
  if (styleAttr) {
    const hasConstraints = problematicStyles.some(prop => 
      styleAttr.includes(prop) || 
      styleAttr.includes('max-width') ||
      styleAttr.includes('max-height')
    );
    
    if (hasConstraints) {
      // Parse and clean the style attribute
      const cleanedStyles = styleAttr
        .split(';')
        .map(rule => rule.trim())
        .filter(rule => {
          const [property] = rule.split(':');
          return property && !problematicStyles.includes(property.trim());
        })
        .join('; ');
      
      if (cleanedStyles) {
        clonedSvg.setAttribute('style', cleanedStyles);
      } else {
        clonedSvg.removeAttribute('style');
      }
      hasInvalidStyles = true;
    }
  }

  // Set essential attributes for proper rendering
  const dims = calculateSvgDimensions(clonedSvg);
  clonedSvg.setAttribute('viewBox', dims.viewBox);
  clonedSvg.setAttribute('width', dims.width.toString());
  clonedSvg.setAttribute('height', dims.height.toString());

  // Set CSS properties for optimal rendering
  clonedSvg.style.width = `${dims.width}px`;
  clonedSvg.style.height = `${dims.height}px`;
  clonedSvg.style.display = 'block';
  clonedSvg.style.overflow = 'visible';
  clonedSvg.style.position = 'relative';

  // Add performance optimizations
  clonedSvg.style.willChange = 'transform';
  clonedSvg.style.transform = 'translateZ(0)';
  clonedSvg.style.backfaceVisibility = 'hidden';
  clonedSvg.style.imageRendering = 'crisp-edges';

  return {
    dimensions: dims,
    cleanedElement: clonedSvg,
    hasInvalidStyles,
  };
};

/**
 * Validate SVG dimensions are reasonable
 */
export const validateDimensions = (dims: SvgDimensions): boolean => {
  const { width, height } = dims;
  
  // Check for reasonable dimensions
  if (width < 10 || height < 10) {
    console.warn('SVG dimensions too small:', { width, height });
    return false;
  }
  
  if (width > 50000 || height > 50000) {
    console.warn('SVG dimensions too large:', { width, height });
    return false;
  }
  
  // Check for reasonable aspect ratio
  const aspectRatio = width / height;
  if (aspectRatio > 20 || aspectRatio < 0.05) {
    console.warn('SVG aspect ratio seems unusual:', aspectRatio);
    // Don't return false, just warn - some diagrams legitimately have extreme ratios
  }
  
  return true;
};

/**
 * Get optimal container dimensions for the SVG
 */
export const getOptimalContainerDimensions = (
  svgDims: SvgDimensions,
  maxWidth: number,
  maxHeight: number,
  padding: number = 20
): { width: number; height: number; scale: number } => {
  const availableWidth = maxWidth - (padding * 2);
  const availableHeight = maxHeight - (padding * 2);
  
  const scaleX = availableWidth / svgDims.width;
  const scaleY = availableHeight / svgDims.height;
  const scale = Math.min(scaleX, scaleY, 1); // Don't scale up beyond natural size
  
  const containerWidth = svgDims.width * scale + (padding * 2);
  const containerHeight = svgDims.height * scale + (padding * 2);
  
  return {
    width: Math.max(containerWidth, 200),
    height: Math.max(containerHeight, 150),
    scale,
  };
};

/**
 * Detect if diagram is "large" and needs special handling
 */
export const isLargeDiagram = (dims: SvgDimensions): boolean => {
  const { width, height } = dims;
  const area = width * height;
  const pixelCount = area;
  
  // Consider diagrams over 2 megapixels as "large"
  return pixelCount > 2_000_000 || width > 2000 || height > 2000;
};

/**
 * Optimize SVG for performance based on size
 */
export const optimizeSvgForPerformance = (
  svgElement: SVGSVGElement,
  dims: SvgDimensions
): SVGSVGElement => {
  const optimizedSvg = svgElement.cloneNode(true) as SVGSVGElement;
  
  if (isLargeDiagram(dims)) {
    // For large diagrams, apply additional optimizations
    optimizedSvg.style.imageRendering = 'auto'; // Allow smoother scaling
    optimizedSvg.style.shapeRendering = 'optimizeSpeed';
    optimizedSvg.style.textRendering = 'optimizeSpeed';
    
    // Add performance hint
    optimizedSvg.setAttribute('data-large-diagram', 'true');
  }
  
  return optimizedSvg;
};

/**
 * Generate a unique ID for Mermaid diagrams
 */
export const generateDiagramId = (prefix = 'mermaid'): string => {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substr(2, 9);
  return `${prefix}-${timestamp}-${random}`;
};

/**
 * Check if Mermaid chart is valid before rendering
 */
export const validateMermaidChart = (chart: string): { isValid: boolean; error?: string } => {
  if (!chart || typeof chart !== 'string') {
    return { isValid: false, error: 'Chart must be a non-empty string' };
  }
  
  const trimmedChart = chart.trim();
  if (!trimmedChart) {
    return { isValid: false, error: 'Chart cannot be empty' };
  }
  
  // Basic validation for common Mermaid syntax patterns
  const validPatterns = [
    /^graph\s+(LR|RL|TB|BT|TD)/i,
    /^flowchart\s+(LR|RL|TB|BT|TD)/i,
    /^sequenceDiagram/i,
    /^classDiagram/i,
    /^stateDiagram/i,
    /^erDiagram/i,
    /^gantt/i,
    /^pie/i,
    /^journey/i,
    /^gitgraph/i,
    /^C4Context/i,
    /^mindmap/i,
    /^timeline/i,
    /^sankey/i,
    /^block/i,
    /^architecture/i,
  ];
  
  const isValidSyntax = validPatterns.some(pattern => pattern.test(trimmedChart));
  
  if (!isValidSyntax) {
    return { 
      isValid: false, 
      error: 'Chart does not appear to be valid Mermaid syntax' 
    };
  }
  
  return { isValid: true };
};