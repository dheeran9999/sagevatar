import { useLayoutEffect, useState, type RefObject } from 'react';

/** Largest box with the given aspect ratio that fits inside `ref` (like object-fit: contain). */
export function useContainSize(ref: RefObject<HTMLElement | null>, ratio: number) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !ratio) return;
    const measure = () => {
      const W = el.clientWidth;
      const H = el.clientHeight;
      if (!W || !H) return;
      const width = Math.min(W, H * ratio);
      setSize({ width, height: width / ratio });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, ratio]);
  return size;
}
