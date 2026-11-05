import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { motion } from 'framer-motion';
import { api, type Template } from '../../lib/api';
import { useToast } from '../../components/toast-context';
import { Button, EmptyState, Field, OrbitLoader, Panel, Pill } from '../../components/ui';
import { IconFrame, IconUpload } from '../../components/icons';
import { PosterTemplatesPanel } from './PosterTemplatesPanel';

export default function TemplatesTab() {
  const toast = useToast();
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(
    () =>
      api.creator
        .templates()
        .then(setTemplates)
        .catch((e: Error) => toast.error('Could not load templates', e.message)),
    [toast],
  );
  useEffect(() => {
    load();
  }, [load]);

  const act = async (key: string, fn: () => Promise<unknown>, success?: string) => {
    setBusy(key);
    try {
      await fn();
      if (success) toast.success(success);
      await load();
    } catch (e) {
      toast.error('Something went wrong', (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const upload = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    await act(
      'upload',
      async () => {
        await api.creator.uploadTemplate(new FormData(form));
        form.reset();
      },
      'Template uploaded — activate it when ready',
    );
  };

  return (
    <div className="flex flex-col gap-5">
      <PosterTemplatesPanel />
      <Panel
        title="Add corporate template"
        subtitle="A branded frame or overlay (PNG/WebP with transparency)."
      >
        <form
          onSubmit={upload}
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1.3fr_auto] lg:items-end"
        >
          <Field label="Name" name="name" required minLength={2} />
          <Field label="Description" name="description" />
          <label className="group flex cursor-pointer flex-col gap-1.5">
            <span className="text-[13px] font-medium text-text-muted">Frame image</span>
            <span className="flex h-10 items-center gap-2 rounded-full border border-dashed border-glass-edge bg-ink/40 px-3 text-xs text-text-muted transition group-hover:border-brand-2/60 group-focus-within:border-brand-2/70">
              <IconUpload size={15} />
              <input
                name="file"
                type="file"
                required
                accept="image/png,image/webp"
                className="min-w-0 flex-1 text-xs file:mr-2 file:rounded-full file:border-0 file:bg-fg/10 file:px-3 file:py-1 file:text-xs file:text-text"
              />
            </span>
          </label>
          <Button type="submit" loading={busy === 'upload'} className="h-10">
            Upload
          </Button>
        </form>
      </Panel>

      <Panel title="Templates">
        {templates === null ? (
          <OrbitLoader />
        ) : !templates.length ? (
          <EmptyState icon={<IconFrame size={24} />} title="No templates yet">
            Upload a branded frame above to offer it in the Studio.
          </EmptyState>
        ) : (
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {templates.map((t, i) => (
              <motion.li
                key={t.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0, transition: { delay: i * 0.03 } }}
                className="glass-subtle glass-interactive flex flex-col gap-3 p-3"
              >
                <div className="rounded-xl bg-[conic-gradient(#ffffff0d_25%,transparent_0_50%,#ffffff0d_0_75%,transparent_0)] bg-[length:16px_16px]">
                  <img
                    src={t.thumbnailUrl ?? t.fileUrl}
                    alt=""
                    className="aspect-video w-full object-contain"
                  />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium">{t.name}</span>
                  <Pill tone={t.isActive ? 'ok' : 'warn'}>{t.isActive ? 'Active' : 'Hidden'}</Pill>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  loading={busy === t.id}
                  onClick={() =>
                    act(
                      t.id,
                      () => api.creator.updateTemplate(t.id, { isActive: !t.isActive }),
                      t.isActive ? `${t.name} hidden` : `${t.name} is live`,
                    )
                  }
                >
                  {t.isActive ? 'Deactivate' : 'Activate'}
                </Button>
              </motion.li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
