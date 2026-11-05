/**
 * Slow-moving light behind the glass. Pure CSS transform animation on three
 * pre-blurred layers (composited on the GPU, no per-frame JS).
 */
export function AuroraBackground() {
  return (
    <div aria-hidden className="bg-effect aurora-backdrop pointer-events-none fixed inset-0 -z-20 overflow-hidden">
      <div className="absolute -left-[20%] -top-[25%] h-[70vmax] w-[70vmax] rounded-full bg-brand/25 blur-[110px] animate-aurora will-change-transform" />
      <div
        className="absolute -bottom-[30%] -right-[20%] h-[65vmax] w-[65vmax] rounded-full bg-brand-2/18 blur-[110px] animate-aurora will-change-transform"
        style={{ animationDelay: '-8s' }}
      />
      <div
        className="absolute left-[30%] top-[35%] h-[40vmax] w-[40vmax] rounded-full bg-blue/20 blur-[100px] animate-aurora will-change-transform"
        style={{ animationDelay: '-15s' }}
      />
    </div>
  );
}
