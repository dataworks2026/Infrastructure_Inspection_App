'use client';
import { useEffect, useRef, useState } from 'react';

interface AnimatedCounterProps {
  value: number;
  duration?: number;
}

export default function AnimatedCounter({ value, duration = 1100 }: AnimatedCounterProps) {
  const [display, setDisplay] = useState(0);
  const rafRef    = useRef<number>();
  const startRef  = useRef<number | undefined>();
  const fromRef   = useRef(0);

  useEffect(() => {
    const from = fromRef.current;
    const diff = value - from;

    const animate = (ts: number) => {
      if (startRef.current === undefined) startRef.current = ts;
      const elapsed  = ts - startRef.current;
      const progress = Math.min(elapsed / duration, 1);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(from + diff * eased));
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(animate);
      } else {
        fromRef.current   = value;
        startRef.current  = undefined;
      }
    };

    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    startRef.current = undefined;
    rafRef.current   = requestAnimationFrame(animate);

    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [value, duration]);

  return <>{display.toLocaleString()}</>;
}
