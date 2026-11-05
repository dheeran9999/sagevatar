import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { useAppearance } from '../auth/AppearanceContext';
import { ACCENTS, type Appearance } from '../lib/appearance';
import { Chips } from './Chips';
import { Modal } from './Modal';
import { Button, Spinner } from './ui';
import { IconCheck } from './icons';

const onOff = [
  { value: 'on', label: 'On' },
  { value: 'off', label: 'Off' },
];

/** Per-user look & feel. Changes apply instantly and are saved to the user's account. */
export function AppearanceDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { appearance: a, update, reset, saving, error } = useAppearance();

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Appearance"
      description="Changes apply right away and follow you to any device you sign in on."
      footer={
        <div className="flex w-full flex-wrap items-center gap-3">
          <span role="status" className={`text-xs ${error ? 'text-accent' : 'text-text-dim'}`}>
            {error ? (
              error
            ) : saving ? (
              <span className="inline-flex items-center gap-1.5">
                <Spinner size={12} /> Saving…
              </span>
            ) : (
              'Saved to your account'
            )}
          </span>
          <div className="ml-auto flex gap-2">
            <Button variant="ghost" onClick={reset}>
              Reset to defaults
            </Button>
            <Button onClick={onClose}>Done</Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        <Row label="Theme">
          <Chips
            label="Theme"
            role="radiogroup"
            layoutId="pref-theme"
            wrap
            value={a.theme}
            onChange={(v) => update({ theme: v as Appearance['theme'] })}
            options={[
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
              { value: 'system', label: 'System default' },
            ]}
          />
        </Row>

        <Row label="Accent colour">
          <div role="radiogroup" aria-label="Accent colour" className="flex flex-wrap gap-2">
            {ACCENTS.map((c) => {
              const active = a.accent === c.id;
              return (
                <button
                  key={c.id}
                  role="radio"
                  aria-checked={active}
                  title={c.label}
                  onClick={() => update({ accent: c.id })}
                  className={`group flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-xs transition hover:-translate-y-0.5 active:scale-95 ${
                    active
                      ? 'border-fg/30 bg-fg/10 text-text'
                      : 'border-glass-border text-text-muted hover:border-glass-edge hover:text-text'
                  }`}
                >
                  <span
                    className="relative grid h-6 w-6 place-items-center rounded-full text-white shadow-sm"
                    style={{
                      background: `linear-gradient(135deg, ${c.swatch[0]}, ${c.swatch[1]})`,
                    }}
                  >
                    {active && (
                      <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }}>
                        <IconCheck size={13} />
                      </motion.span>
                    )}
                  </span>
                  {c.label}
                </button>
              );
            })}
          </div>
        </Row>

        <Row label="Glass effect">
          <Chips
            label="Glass effect"
            role="radiogroup"
            layoutId="pref-glass"
            wrap
            value={a.glass}
            onChange={(v) => update({ glass: v as Appearance['glass'] })}
            options={[
              { value: 'subtle', label: 'Subtle' },
              { value: 'standard', label: 'Standard' },
              { value: 'strong', label: 'Strong' },
            ]}
          />
        </Row>

        <div className="grid gap-5 sm:grid-cols-2">
          <Row label="Animations" hint="Off makes every change instant.">
            <Chips
              label="Animations"
              role="radiogroup"
              layoutId="pref-anim"
              wrap
              value={a.animations ? 'on' : 'off'}
              onChange={(v) => update({ animations: v === 'on' })}
              options={onOff}
            />
          </Row>
          <Row label="Motion" hint="Reduced stops looping and moving effects.">
            <Chips
              label="Motion"
              role="radiogroup"
              layoutId="pref-motion"
              wrap
              value={a.motion}
              onChange={(v) => update({ motion: v as Appearance['motion'] })}
              options={[
                { value: 'reduced', label: 'Reduced' },
                { value: 'standard', label: 'Standard' },
              ]}
            />
          </Row>
          <Row label="Background effects" hint="Soft colour glow behind the app.">
            <Chips
              label="Background effects"
              role="radiogroup"
              layoutId="pref-bg"
              wrap
              value={a.backgroundEffects ? 'on' : 'off'}
              onChange={(v) => update({ backgroundEffects: v === 'on' })}
              options={onOff}
            />
          </Row>
          <Row label="Layout">
            <Chips
              label="Layout"
              role="radiogroup"
              layoutId="pref-density"
              wrap
              value={a.density}
              onChange={(v) => update({ density: v as Appearance['density'] })}
              options={[
                { value: 'compact', label: 'Compact' },
                { value: 'comfortable', label: 'Comfortable' },
              ]}
            />
          </Row>
        </div>
      </div>
    </Modal>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <div>
        <div className="text-sm font-medium">{label}</div>
        {hint && <div className="text-xs text-text-dim">{hint}</div>}
      </div>
      {children}
    </div>
  );
}
