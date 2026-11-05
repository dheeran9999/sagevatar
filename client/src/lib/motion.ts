import type { Transition, Variants } from 'framer-motion';

/** Shared motion language — one place to tune how the whole studio moves. */
export const spring: Transition = { type: 'spring', stiffness: 380, damping: 30, mass: 0.8 };
export const softSpring: Transition = { type: 'spring', stiffness: 160, damping: 22 };
export const easeOut: Transition = { duration: 0.35, ease: [0.16, 1, 0.3, 1] };

export const page: Variants = {
  initial: { opacity: 0, y: 14, filter: 'blur(6px)' },
  enter: {
    opacity: 1,
    y: 0,
    filter: 'blur(0px)',
    transition: { duration: 0.45, ease: [0.16, 1, 0.3, 1] },
  },
  exit: { opacity: 0, y: -8, filter: 'blur(4px)', transition: { duration: 0.2, ease: 'easeIn' } },
};

export const pop: Variants = {
  initial: { opacity: 0, scale: 0.96, y: 6 },
  enter: { opacity: 1, scale: 1, y: 0, transition: spring },
  exit: { opacity: 0, scale: 0.97, y: 4, transition: { duration: 0.15 } },
};

export const stagger = (step = 0.035): Variants => ({
  enter: { transition: { staggerChildren: step } },
});

export const rise: Variants = {
  initial: { opacity: 0, y: 12 },
  enter: { opacity: 1, y: 0, transition: easeOut },
};
