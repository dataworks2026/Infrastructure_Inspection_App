'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import {
  LayoutDashboard, Building2, Map, Upload, Search,
  X, Sparkles, Rocket, ArrowRight, Activity, Eye,
  ChevronRight, ChevronLeft, Crosshair, Zap,
} from 'lucide-react';

/* ── Tour step definition ── */
interface TourStep {
  target: string | null;
  route?: string;
  title: string;
  subtitle?: string;
  description: string;
  icon: React.ElementType;
  placement: 'bottom' | 'right' | 'left' | 'top' | 'center';
  hint?: string;
  /** Step number label like "Step 1 of 5" — auto-calculated */
  cta?: string;
}

const STEPS: TourStep[] = [
  /* 0 — Welcome splash */
  {
    target: null,
    title: 'Welcome to Mira Intel',
    subtitle: 'AI-Powered Infrastructure Inspection',
    description: 'We\'ll walk you through the platform in under 30 seconds. Here\'s how your drone inspection workflow works — from adding assets to AI-powered damage detection.',
    icon: Sparkles,
    placement: 'center',
    hint: 'Quick walkthrough — 30 seconds',
    cta: 'Let\'s Go',
  },
  /* 1 — Dashboard KPIs */
  {
    target: '[data-tour="dashboard-kpis"]',
    route: '/dashboard',
    title: 'Your Command Center',
    subtitle: 'Dashboard',
    description: 'See your active assets, total detections, and images analyzed at a glance. These KPIs update in real time as new inspections are processed.',
    icon: LayoutDashboard,
    placement: 'bottom',
    hint: 'Live data — auto-refreshes every 2 min',
  },
  /* 2 — Asset Health & Severity */
  {
    target: '[data-tour="dashboard-health"]',
    route: '/dashboard',
    title: 'Track Damage Severity',
    subtitle: 'Asset Health',
    description: 'Monitor each asset\'s condition with severity levels S1–S4. The donut chart shows your fleet\'s damage distribution — spot critical issues instantly.',
    icon: Activity,
    placement: 'top',
  },
  /* 3 — Assets page */
  {
    target: '[data-tour="assets-header"]',
    route: '/assets',
    title: 'Register Your Infrastructure',
    subtitle: 'Assets',
    description: 'Add wind turbines, piers, coastal structures, and more. Use quick-fill presets for known locations or enter GPS coordinates manually.',
    icon: Building2,
    placement: 'bottom',
    hint: 'Tip: Use "New Asset" with Quick Fill presets',
  },
  /* 4 — Upload & Analyze */
  {
    target: '[data-tour="upload-form"]',
    route: '/upload',
    title: 'Upload & Run AI Analysis',
    subtitle: 'Inspection Upload',
    description: 'Select an asset, name your inspection, then drag & drop drone images. Our YOLOv8 AI model detects damage types, confidence scores, and severity levels automatically.',
    icon: Upload,
    placement: 'right',
    hint: 'Supports JPG, PNG, TIFF — batch processing',
  },
  /* 5 — Map */
  {
    target: null,
    route: '/map',
    title: 'Explore the Map',
    subtitle: 'Interactive Map',
    description: 'Visualize all your assets on a live map. Toggle photo overlays, filter by infrastructure type, and click assets to see inspection details.',
    icon: Map,
    placement: 'center',
    hint: 'Toggle the Photos button to see GPS-tagged imagery',
  },
  /* 6 — Done */
  {
    target: null,
    route: '/dashboard',
    title: 'You\'re All Set!',
    subtitle: 'Ready to Inspect',
    description: 'Start by adding an asset, then upload drone images to run your first AI inspection. You can replay this tour anytime from the sidebar.',
    icon: Rocket,
    placement: 'center',
    cta: 'Start Inspecting',
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
      const timer = setTimeout(() => setActive(true), 600);
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
  const [phase, setPhase]     = useState<'enter' | 'idle' | 'exit'>('enter');
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

    const timer = setTimeout(measure, 120);
    window.addEventListener('resize', measure);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', measure);
    };
  }, [active, step, current.target]);

  /* Entrance animation */
  useEffect(() => {
    if (active) {
      setPhase('enter');
      const t = setTimeout(() => setPhase('idle'), 250);
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, step]);

  const finish = useCallback(() => {
    setPhase('exit');
    localStorage.setItem(STORAGE_KEY, 'true');
    setTimeout(() => {
      setPhase('enter');
      setStep(0);
      onClose();
    }, 200);
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

    const gap = 14;
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
  const pad = 10;
  const spot = rect ? {
    x: rect.x - pad,
    y: rect.y - pad,
    w: rect.width + pad * 2,
    h: rect.height + pad * 2,
    r: 16,
  } : null;

  const overlayClass = phase === 'exit'
    ? 'tour-overlay tour-fade-out'
    : phase === 'enter'
      ? 'tour-overlay tour-fade-in'
      : 'tour-overlay';

  const tooltipClass = phase === 'exit'
    ? 'tour-tooltip tour-tooltip-out'
    : phase === 'enter'
      ? 'tour-tooltip tour-tooltip-in'
      : 'tour-tooltip';

  /* Progress percentage for the bar */
  const progress = ((step + 1) / total) * 100;

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
          fill="rgba(4, 20, 18, 0.68)"
          mask="url(#tour-spotlight-mask)"
        />
        {/* Glow ring around spotlight */}
        {spot && (
          <rect
            x={spot.x - 2} y={spot.y - 2}
            width={spot.w + 4} height={spot.h + 4}
            rx={spot.r + 2} ry={spot.r + 2}
            fill="none"
            stroke="rgba(8,145,178,0.45)"
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
          maxWidth: current.placement === 'center' ? 460 : 380,
          zIndex: 10000,
        }}
      >
        {/* Close button */}
        <button
          onClick={finish}
          className="tour-close-btn"
          title="Skip tour (Esc)"
        >
          <X size={15} />
        </button>

        {/* Progress bar */}
        <div className="tour-progress-bar">
          <div className="tour-progress-fill" style={{ width: `${progress}%` }} />
        </div>

        {/* Subtitle tag */}
        {current.subtitle && (
          <div className="tour-subtitle-tag">
            <Icon size={12} />
            <span>{current.subtitle}</span>
          </div>
        )}

        {/* Icon */}
        <div className="tour-icon-wrap">
          <Icon size={current.placement === 'center' ? 28 : 22} />
        </div>

        {/* Content */}
        <h3 className="tour-title">{current.title}</h3>
        <p className="tour-desc">{current.description}</p>

        {current.hint && (
          <div className="tour-hint">
            <Zap size={12} style={{ flexShrink: 0, opacity: 0.8 }} />
            <span>{current.hint}</span>
          </div>
        )}

        {/* Actions */}
        <div className="tour-actions">
          {isFirst ? (
            <button onClick={finish} className="tour-btn-skip">
              Skip
            </button>
          ) : (
            <button onClick={prev} className="tour-btn-back">
              <ChevronLeft size={15} />
              Back
            </button>
          )}

          <button onClick={next} className="tour-btn-next">
            {isLast ? (
              <>
                {current.cta || 'Get Started'}
                <Rocket size={15} />
              </>
            ) : (
              <>
                {current.cta || 'Next'}
                <ArrowRight size={15} />
              </>
            )}
          </button>
        </div>

        {/* Step counter */}
        <div className="tour-step-counter">
          {step + 1} of {total}
        </div>
      </div>

      {/* Click blocker on overlay area */}
      <div
        style={{ position: 'absolute', inset: 0, zIndex: 9998 }}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('.tour-tooltip')) return;
        }}
      />
    </div>
  );
}
