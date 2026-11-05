import { IconSparkles } from './icons';

export const PRODUCT_NAME = 'SageVatar';
export const PRODUCT_TAGLINE = 'AI Avatar & Event Photo Studio';

/** Logo mark + wordmark. The large size adds the tagline. */
export function Brand({ size = 'md' }: { size?: 'md' | 'lg' }) {
  const lg = size === 'lg';
  return (
    <span className="inline-flex items-center gap-2.5">
      <span
        aria-hidden
        className={`bg-gradient-brand grid shrink-0 place-items-center rounded-xl text-white shadow-[var(--shadow-glow)] ${
          lg ? 'h-11 w-11' : 'h-8 w-8'
        }`}
      >
        <IconSparkles size={lg ? 22 : 17} />
      </span>
      <span className="flex flex-col leading-tight">
        <span
          className={`font-display font-semibold tracking-tight ${lg ? 'text-2xl sm:text-[28px]' : 'text-lg'}`}
        >
          Sage<span className="text-gradient">Vatar</span>
        </span>
        {lg && <span className="text-xs text-text-muted">{PRODUCT_TAGLINE}</span>}
      </span>
    </span>
  );
}
