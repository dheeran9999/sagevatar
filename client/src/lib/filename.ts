/**
 * Download names that say what the photo is:
 *   SageVatar_<Event ID or "Personal">_<avatar>_<YYYY-MM-DD_HH-mm>.<ext>
 * Mirrors server/src/lib/share.ts photoFilename.
 */
export function photoFilename(parts: {
  context: string;
  avatar?: string | null;
  at?: Date;
  ext: string;
}) {
  const clean = (s: string) =>
    s
      .normalize('NFKD')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 40);
  const d = parts.at ?? new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}`;
  return ['SageVatar', clean(parts.context), parts.avatar ? clean(parts.avatar) : null, stamp]
    .filter(Boolean)
    .join('_')
    .concat(`.${parts.ext}`);
}
