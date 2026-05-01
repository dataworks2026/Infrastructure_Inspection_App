// Shared visual constants for the predictive analytics views.
// Imported by app/(dashboard)/analytics/page.tsx and
// app/(dashboard)/assets/[id]/AnalyticsPanel.tsx so both surfaces
// stay in lock-step. Edit colors here, not in the consumers.

import type { ElementType } from 'react';
import { ArrowUpRight, Minus, TrendingDown, TrendingUp } from 'lucide-react';

import type {
  PredictivePriorityLabel,
  PredictiveTrendDirection,
  PredictiveTtiLabel,
} from '@/types';


export const PRIORITY: Record<
  PredictivePriorityLabel,
  { color: string; bg: string; border: string }
> = {
  Critical: { color: '#B71C1C', bg: '#FEF2F2', border: '#FECACA' },
  High:     { color: '#C2410C', bg: '#FFF3E0', border: '#FFCCBC' },
  Medium:   { color: '#A16207', bg: '#FFFBEB', border: '#FDE68A' },
  Low:      { color: '#15803D', bg: '#F0FDF4', border: '#BBF7D0' },
  Minimal:  { color: '#6B7280', bg: '#F9FAFB', border: '#E5E7EB' },
};


export const TREND: Record<
  PredictiveTrendDirection,
  { icon: ElementType; color: string; label: string }
> = {
  accelerating: { icon: TrendingUp,   color: '#7F1D1D', label: 'Accelerating' },
  worsening:    { icon: TrendingUp,   color: '#B91C1C', label: 'Worsening'    },
  stable:       { icon: Minus,        color: '#6B7280', label: 'Stable'       },
  improving:    { icon: TrendingDown, color: '#15803D', label: 'Improving'    },
  fluctuating:  { icon: ArrowUpRight, color: '#C2410C', label: 'Fluctuating'  },
};


export const TTI_COLOR: Record<PredictiveTtiLabel, string> = {
  'Immediate':      '#B71C1C',
  'Near-term':      '#C2410C',
  'Medium-term':    '#A16207',
  'Long-term':      '#15803D',
  'Not applicable': '#6B7280',
};
