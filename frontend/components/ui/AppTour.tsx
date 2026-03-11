'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import {
  LayoutDashboard, Building2, Map, ClipboardList, Upload,
  Search, ChevronRight, ChevronLeft, X, Sparkles, Rocket,
  MousePointerClick, Eye, ArrowRight,
} from 'lucide-react';

/* ── Tour step definition ── */
interface TourStep {
  /** CSS selector to spotlight (null = centered modal) */
  target: string | null;
  /** Which route the user should be on */
  route?: string;
  title: string;
  description: string;
  icon: React.ElementType;
  /** Where to place the tooltip relative to the target */
  placement: 'bottom' | 'right' | 'left' | 'top' | 'center';
  /** Extra hint shown below description */
  hint?: string;
}

const STEPS: TourStep[] = [
  {
    target: null,
    title: 'Welcome to Mira Intel',
    description: 'Your AI-powered infrastructure inspection platform. Let\u2019s take a quick tour to get you up to speed.',
    icon: Sparkles,
    placement: 'center',
    hint: 'Takes about 60 seconds',
  },
  {
    target: 'aside',
    title: 'Navigation Sidebar',
    description: 'Your command center. Access every section of the platform from here. Press [ to collapse it anytime.',
    icon: MousePointerClick,
    placement: 'right',
    hint: 'Tip: Use \u2318K to search anything',
  },
  {
    target: '[data-tour="nav-dashboard"]',
    route: '/dashboard',
    title: 'Dashboard',
    description: 'Get a real-time overview of your assets, detections, and severity breakdown\u2014all at a glance.',
    icon: LayoutDashboard,
    placement: 'right',
  },
  {
    target: '[data-tour="nav-assets"]',
    route: '/assets',
    title: 'Assets',
    description: 'Manage your infrastructure assets\u2014wind turbines, piers, coastal structures. Add new ones with quick-fill locations.',
    icon: Building2,
    placement: 'right',
  },
  {
    target: '[data-tour="nav-map"]',
    route: '/map',
    title: 'Interactive Map',
    description: 'Visualize all assets on a live map. Toggle photo overlays and filter by infrastructure type.',
    icon: Map,
    placement: 'right',
  },
  {
    target: '[data-tour="nav-upload"]',
    route: '/upload',
    title: 'Upload & Analyze',
    description: 'Drag and drop drone images. Our YOLOv8 AI model detects damage types, confidence scores, and severity levels automatically.',
    icon: Upload,
    placement: 'right',
    hint: 'Supports JPG, PNG, and TIFF',
  },
  {
    target: '[data-tour="nav-inspections"]',
    route: '/inspections',
    title: 'Inspections',
    description: 'Track all inspection records. Sort, filter by status, and drill into AI-annotated images with bounding boxes.',
    icon: ClipboardList,
    placement: 'right',
  },
  {
    target: '[data-tour="search-trigger"]',
    title: 'Quick Search',
    description: 'Find any asset, inspection, or page instantly with the command palette.',
    icon: Search,
    placement: 'right',
    hint: 'Shortcut: \u2318K or Ctrl+K',
  },
  {
    target: null,
    route: '/dashboard',
    title: 'You\u2019re All Set!',
    description: 'Start by uploading drone images or exploring your dashboard. You can replay this tour anytime from the sidebar.',
    icon: Rocket,
    placement: 'center',
  },
];

const STORAGE_KEY = 'mira-tour-completed';

export function useAppTour() {
  const [active, setActive] = useState(false);

  const start = useCallback(() => setActive(true), []);
  const stop  = useCallback(() => setActive(false), []);

  /* Auto-show on first visit */
  useEffect(() => {
    const done = localStorage.getItem(STORAGE_KEY);
    if (!done) {
      const timer = setTimeout(() => setActive(true), 800);
      return () => clearTimeout(timer);
    }
  }, []);

  return { active, start, stop };
}

/* ── Main Tour Overlay ── */
export default function AppTour({
  active,
  onClose,
}: {
  active: boolean;
  onClose: () => void;
}) {
  const router   = useRouter();
  const pathname = usePathname();
  const [step, setStep]       = useState(0);
  const [rect, setRect]       = useState<DOMRect | null>(null);
  const [entering, setEntering] = useState(true);
  const [exiting, setExiting]   = useState(false);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const current = STEPS[step];
  const total   = STEPS.length;
  const isFirst = step === 0;
  const isLast  = step === total - 1;
  const Icon    = current.icon;

  /* Navigate to step route if needed */
  useEffect(() => {
    if (!active) return;
    if (current.route && pathname !== current.route) {
      router.push(current.route);
    }
  }, [active, step, current.route, pathname, router]);

  /* Find & measure the target element */
  useEffect(() => {
    if (!active) return;
    if (!current.target) { setRect(null); return; }

    const measure = () => {
      const el = document.querySelector(current.target!);
      if (el) {
        setRect(el.getBoundingClientRect());
      } else {
        setRect(null);
      }
    };

    /* Small delay to let route transitions settle */
    const timer = setTimeout(measure, 150);
    window.addEventListener('resize', measure);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', measure);
    };
  }, [active, step, current.target]);

  /* Entrance animation */
  useEffect(() => {
    if (active) {
      setEntering(true);
      const t = setTimeout(() => setEntering(false), 350);
      return () => clearTimeout(t);
    }
  }, [active, step]);

  /* Keyboard navigation */
  useEffect(() => {
    if (!active) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { finish(); return; }
      if (e.key === 'ArrowRight' || e.key === 'Enter') { next(); return; }
      if (e.key === 'ArrowLeft') { prev(); return; }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [active, step]);

  const finish = useCallback(() => {
    setExiting(true);
    localStorage.setItem(STORAGE_KEY, 'true');
    setTimeout(() => {
      setExiting(false);
      setStep(0);
      onClose();
    }, 300);
  }, [onClose]);

  const next = useCallback(() => {
    if (isLast) { finish(); return; }
    setStep(s => s + 1);
  }, [isLast, finish]);

  const prev = useCallback(() => {
    if (!isFirst) setStep(s => s - 1);
  }, [isFirst]);

  if (!active) return null;

  /* ── Tooltip positioning ── */
  const getTooltipStyle = (): React.CSSProperties => {
    if (current.placement === 'center' || !rect) {
      return {
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
      };
    }

    const gap = 16;
    const base: React.CSSProperties = { position: 'fixed' };

    switch (current.placement) {
      case 'right':
        base.left  = rect.right + gap;
        base.top   = rect.top + rect.height / 2;
        base.transform = 'translateY(-50%)';
        break;
      case 'left':
        base.right = window.innerWidth - rect.left + gap;
        base.top   = rect.top + rect.height / 2;
        base.transform = 'translateY(-50%)';
        break;
      case 'bottom':
        base.left  = rect.left + rect.width / 2;
        base.top   = rect.bottom + gap;
        base.transform = 'translateX(-50%)';
        break;
      case 'top':
        base.left  = rect.left + rect.width / 2;
        base.bottom = window.innerHeight - rect.top + gap;
        base.transform = 'translateX(-50%)';
        break;
    }
    return base;
  };

  /* Spotlight cutout dimensions with padding */
  const pad = 8;
  const spot = rect ? {
    x: rect.x - pad,
    y: rect.y - pad,
    w: rect.width + pad * 2,
    h: rect.height + pad * 2,
    r: 16,
  } : null;

  const overlayClass = exiting
    ? 'tour-overlay tour-fade-out'
    : entering
      ? 'tour-overlay tour-fade-in'
      : 'tour-overlay';

  const tooltipClass = exiting
    ? 'tour-tooltip tour-tooltip-out'
    : entering
      ? 'tour-tooltip tour-tooltip-in'
      : 'tour-tooltip';

  return (
    <div className={overlayClass} style={{ position: 'fixed', inset: 0, zIndex: 9999 }}>
      {/* SVG overlay with spotlight cutout */}
      <svg
        className="tour-svg-overlay"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
      >
        <defs>
          <mask id="tour-spotlight-mask">
            <rect x="0" y="0" width="100%" height="100%" fill="white" />
            {spot && (
              <rect
                x={spot.x} y={spot.y}
                width={spot.w} height={spot.h}
                rx={spot.r} ry={spot.r}
                fill="black"
                className="tour-spotlight-rect"
              />
            )}
          </mask>
        </defs>
        <rect
          x="0" y="0"
          width="100%" height="100%"
          fill="rgba(4, 20, 18, 0.72)"
          mask="url(#tour-spotlight-mask)"
        />
        {/* Glow ring around spotlight */}
        {spot && (
          <rect
            x={spot.x - 2} y={spot.y - 2}
            width={spot.w + 4} height={spot.h + 4}
            rx={spot.r + 2} ry={spot.r + 2}
            fill="none"
            stroke="rgba(8,145,178,0.5)"
            strokeWidth="2"
            className="tour-glow-ring"
          />
        )}
      </svg>

      {/* Tooltip card */}
      <div
        ref={tooltipRef}
        className={tooltipClass}
        style={{
          ...getTooltipStyle(),
          maxWidth: current.placement === 'center' ? 440 : 360,
          zIndex: 10000,
        }}
      >
        {/* Close button */}
        <button
          onClick={finish}
          className="tour-close-btn"
          title="Skip tour (Esc)"
        >
          <X size={16} />
        </button>

        {/* Step indicator dots */}
        <div className="tour-dots">
          {STEPS.map((_, i) => (
            <div
              key={i}
              className={`tour-dot ${i === step ? 'tour-dot-active' : i < step ? 'tour-dot-done' : ''}`}
            />
          ))}
        </div>

        {/* Icon */}
        <div className="tour-icon-wrap">
          <Icon size={current.placement === 'center' ? 30 : 24} />
        </div>

        {/* Content */}
        <h3 className="tour-title">{current.title}</h3>
        <p className="tour-desc">{current.description}</p>

        {current.hint && (
          <div className="tour-hint">
            <Eye size={14} style={{ flexShrink: 0, opacity: 0.7 }} />
            <span>{current.hint}</span>
          </div>
        )}

        {/* Actions */}
        <div className="tour-actions">
          {isFirst ? (
            <button onClick={finish} className="tour-btn-skip">
              Skip tour
            </button>
          ) : (
            <button onClick={prev} className="tour-btn-back">
              <ChevronLeft size={16} />
              Back
            </button>
          )}

          <button onClick={next} className="tour-btn-next">
            {isLast ? (
              <>
                Get Started
                <Rocket size={16} />
              </>
            ) : (
              <>
                Next
                <ChevronRight size={16} />
              </>
            )}
          </button>
        </div>

        {/* Step counter */}
        <div className="tour-step-counter">
          {step + 1} / {total}
        </div>
      </div>

      {/* Click blocker on overlay area (outside spotlight) */}
      <div
        style={{ position: 'absolute', inset: 0, zIndex: 9998 }}
        onClick={(e) => {
          /* Only close if clicking the dark overlay, not the tooltip */
          if ((e.target as HTMLElement).closest('.tour-tooltip')) return;
          /* Don't close - let them interact with spotted element */
        }}
      />
    </div>
  );
}
