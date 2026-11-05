import { motion } from 'framer-motion';
import { PASSWORD_RULES, passwordScore } from '../lib/password';
import { IconCheck } from './icons';

const LABELS = ['', 'Weak', 'Fair', 'Good', 'Strong'];
const COLORS = ['', 'bg-accent', 'bg-warning', 'bg-brand-2', 'bg-success'];

/** Live strength meter + checklist under a new-password field. */
export function PasswordStrength({ password }: { password: string }) {
  const score = passwordScore(password);
  const allMet = PASSWORD_RULES.every((r) => r.test(password));
  const shown = allMet ? Math.max(score, 3) : Math.min(score, 2);
  return (
    <div className="flex flex-col gap-2" aria-live="polite">
      <div className="flex items-center gap-2">
        <div className="flex flex-1 gap-1" aria-hidden>
          {[1, 2, 3, 4].map((i) => (
            <span key={i} className="h-1.5 flex-1 overflow-hidden rounded-full bg-fg/10">
              <motion.span
                className={`block h-full rounded-full ${COLORS[shown]}`}
                initial={false}
                animate={{ width: i <= shown ? '100%' : '0%' }}
                transition={{ duration: 0.3 }}
              />
            </span>
          ))}
        </div>
        <span className="w-14 text-right text-xs text-text-muted">
          {password ? `${LABELS[shown]}` : ''}
        </span>
      </div>
      <ul className="grid grid-cols-1 gap-x-3 gap-y-1 text-xs sm:grid-cols-2">
        {PASSWORD_RULES.map((r) => {
          const ok = r.test(password);
          return (
            <li
              key={r.id}
              className={`flex items-center gap-1.5 transition-colors ${ok ? 'text-success' : 'text-text-dim'}`}
            >
              <span
                className={`grid h-3.5 w-3.5 place-items-center rounded-full border ${ok ? 'border-success bg-success/20' : 'border-fg/20'}`}
              >
                {ok && <IconCheck size={10} />}
              </span>
              {r.label}
              <span className="sr-only">{ok ? ' (met)' : ' (not met)'}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
