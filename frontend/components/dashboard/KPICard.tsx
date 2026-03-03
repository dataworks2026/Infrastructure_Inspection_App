'use client';
import clsx from 'clsx';
import AnimatedCounter from '@/components/ui/AnimatedCounter';

interface KPICardProps {
  label:     string;
  value:     number | string;
  sublabel?: string;
  color?:    'blue' | 'green' | 'orange' | 'red';
  icon?:     React.ReactNode;
  delay?:    number;
}

const colorMap = {
  blue: {
    icon:    'bg-sky-500/15 text-sky-400',
    accent:  'bg-gradient-to-r from-sky-500 to-blue-500',
    glow:    'hover:shadow-glow-blue',
    border:  'hover:border-sky-500/40',
  },
  green: {
    icon:    'bg-emerald-500/15 text-emerald-400',
    accent:  'bg-gradient-to-r from-emerald-500 to-teal-500',
    glow:    'hover:shadow-glow-green',
    border:  'hover:border-emerald-500/40',
  },
  orange: {
    icon:    'bg-amber-500/15 text-amber-400',
    accent:  'bg-gradient-to-r from-amber-500 to-orange-500',
    glow:    'hover:shadow-glow-amber',
    border:  'hover:border-amber-500/40',
  },
  red: {
    icon:    'bg-red-500/15 text-red-400',
    accent:  'bg-gradient-to-r from-red-500 to-rose-500',
    glow:    'hover:shadow-glow-red',
    border:  'hover:border-red-500/40',
  },
};

export default function KPICard({ label, value, sublabel, color = 'blue', icon, delay = 0 }: KPICardProps) {
  const c = colorMap[color];
  return (
    <div
      className={clsx(
        'card-animate bg-card-dark border border-card-border rounded-xl p-5',
        'shadow-card-dark transition-all duration-200',
        'hover:shadow-card-dark-hover hover:-translate-y-0.5',
        c.glow, c.border,
      )}
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-center justify-between mb-4">
        <span className="text-[11px] font-semibold text-card-muted uppercase tracking-wider">{label}</span>
        {icon && (
          <span className={clsx('w-10 h-10 rounded-xl flex items-center justify-center', c.icon)}>
            {icon}
          </span>
        )}
      </div>

      <div className="text-3xl font-bold font-mono tracking-tight text-card-text">
        {typeof value === 'number'
          ? <AnimatedCounter value={value} />
          : value
        }
      </div>

      {sublabel && <div className="text-xs text-card-faint mt-1">{sublabel}</div>}

      {/* Colored accent bar */}
      <div className={clsx('mt-4 h-0.5 rounded-full opacity-60', c.accent)} />
    </div>
  );
}
