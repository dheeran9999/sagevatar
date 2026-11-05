import { useCallback, useEffect, useState } from 'react';
import { api, type PosterStatus, type PosterTemplate } from '../../lib/api';
import { useToast } from '../../components/toast-context';
import { Button, Field, Panel, Pill, Skeleton } from '../../components/ui';
import { IconImage, IconTrash, IconUpload } from '../../components/icons';
import { ConfirmDialog } from '../../components/Modal';
import { PhotoTemplateDialog } from './PhotoTemplateDialog';

/** Creator only: the official anniversary poster template and the corporate branding on it. */
export function PosterTemplatesPanel() {
  const toast = useToast();
  const [templates, setTemplates] = useState<PosterTemplate[] | null>(null);
  const [branding, setBranding] = useState<PosterStatus['branding'] | null>(null);
  const [busy, setBusy] = useState('');
  const [photoDialog, setPhotoDialog] = useState<PosterTemplate | 'new' | null>(null);
  const [deleting, setDeleting] = useState<PosterTemplate | null>(null);

  const load = useCallback(() => {
    Promise.all([api.posterAdmin.templates(), api.posterAdmin.branding()])
      .then(([t, b]) => {
        setTemplates(t);
        setBranding(b);
      })
      .catch((e: Error) => toast.error('Could not load poster templates', e.message));
  }, [toast]);
  useEffect(load, [load]);

  const act = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    try {
      await fn();
      toast.success(ok);
      load();
    } catch (e) {
      toast.error('Something went wrong', (e as Error).message);
    } finally {
      setBusy('');
    }
  };

  return (
    <Panel
      title="Recognition poster templates"
      subtitle="Official “Happy Work Anniversary – Group Cake Cutting” designs and the corporate branding printed on every poster."
      actions={
        <Button icon={<IconImage size={16} />} onClick={() => setPhotoDialog('new')}>
          Add photo template
        </Button>
      }
    >
      {!templates || !branding ? (
        <Skeleton className="h-40" />
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void act(
                'branding',
                () =>
                  api.posterAdmin.updateBranding({
                    companyName: String(f.get('companyName')),
                    tagline: String(f.get('tagline') ?? ''),
                  }),
                'Branding saved',
              );
            }}
          >
            <h3 className="text-sm font-semibold">Corporate branding</h3>
            <Field label="Company name" name="companyName" defaultValue={branding.companyName} required maxLength={40} />
            <Field label="Tagline (optional)" name="tagline" defaultValue={branding.tagline} maxLength={80} />
            <div className="flex flex-wrap items-center gap-3">
              {branding.logoUrl ? (
                <img src={branding.logoUrl} alt="Approved logo" className="h-14 rounded-lg bg-white p-1" />
              ) : (
                <Pill tone="warn">No logo — the company name is shown as text</Pill>
              )}
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-glass-border px-3 py-1.5 text-sm hover:bg-glass">
                <IconUpload size={14} /> Upload approved logo
                <input
                  type="file"
                  accept="image/png,image/webp,image/jpeg"
                  className="sr-only"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void act('logo', () => api.posterAdmin.uploadLogo(file), 'Logo uploaded');
                  }}
                />
              </label>
              {branding.logoUrl && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  icon={<IconTrash size={14} />}
                  loading={busy === 'logo-del'}
                  onClick={() => act('logo-del', api.posterAdmin.removeLogo, 'Logo removed')}
                >
                  Remove
                </Button>
              )}
            </div>
            <p className="text-xs text-text-dim">Use a transparent PNG of the official logo. It appears on the wall and on the cake.</p>
            <Button type="submit" loading={busy === 'branding'} className="self-start">Save branding</Button>
          </form>

          {templates.filter((t) => t.kind === 'photo').map((t) => (
            <div key={t.key} className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold">{t.name}</h3>
                <Pill tone="brand">Photo · {t.slots.length} faces</Pill>
                <Pill tone={t.isPublished ? 'ok' : 'warn'}>{t.isPublished ? 'Published' : 'Unpublished'}</Pill>
              </div>
              <img src={t.previewUrl} alt={`${t.name} preview`} className="rounded-xl" />
              <p className="text-xs text-text-dim">
                Numbered faces are replaced by the selected employees (gold = cake cutters).
              </p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => setPhotoDialog(t)}>Edit faces</Button>
                <Button
                  size="sm"
                  variant="ghost"
                  loading={busy === `${t.key}-pub`}
                  onClick={() =>
                    act(`${t.key}-pub`, () => api.posterAdmin.updateTemplate(t.key, { isPublished: !t.isPublished }), t.isPublished ? 'Unpublished' : 'Published')
                  }
                >
                  {t.isPublished ? 'Unpublish' : 'Publish'}
                </Button>
                <Button size="sm" variant="danger" icon={<IconTrash size={14} />} onClick={() => setDeleting(t)}>
                  Delete
                </Button>
              </div>
            </div>
          ))}

          {templates.filter((t) => t.kind !== 'photo').map((t) => (
            <form
              key={t.key}
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void act(
                  t.key,
                  () =>
                    api.posterAdmin.updateTemplate(t.key, {
                      name: String(f.get('name')),
                      heading: String(f.get('heading')),
                      maxParticipants: Number(f.get('maxParticipants')),
                    }),
                  'Template saved',
                );
              }}
            >
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold">Template</h3>
                <Pill tone={t.isPublished ? 'ok' : 'warn'}>{t.isPublished ? 'Published' : 'Unpublished'}</Pill>
              </div>
              <img src={t.previewUrl} alt={`${t.name} preview`} className="rounded-xl" />
              <Field label="Name" name="name" defaultValue={t.name} required />
              <Field label="Heading" name="heading" defaultValue={t.heading} required maxLength={60} />
              <Field
                label="Maximum participants"
                name="maxParticipants"
                type="number"
                min={t.minParticipants}
                max={t.slots.length}
                defaultValue={t.maxParticipants}
              />
              <div className="flex flex-wrap gap-2">
                <Button type="submit" loading={busy === t.key}>Save template</Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() =>
                    act(`${t.key}-pub`, () => api.posterAdmin.updateTemplate(t.key, { isPublished: !t.isPublished }), t.isPublished ? 'Unpublished' : 'Published')
                  }
                >
                  {t.isPublished ? 'Unpublish' : 'Publish'}
                </Button>
              </div>
            </form>
          ))}
        </div>
      )}
      {photoDialog && (
        <PhotoTemplateDialog
          existing={photoDialog === 'new' ? undefined : photoDialog}
          onClose={() => setPhotoDialog(null)}
          onSaved={() => {
            setPhotoDialog(null);
            load();
          }}
        />
      )}
      <ConfirmDialog
        open={!!deleting}
        onCancel={() => setDeleting(null)}
        title={`Delete “${deleting?.name ?? ''}”?`}
        description="The template photo is deleted. Posters already generated from it are kept."
        confirmLabel="Delete template"
        danger
        onConfirm={async () => {
          if (deleting) await act('del', () => api.posterAdmin.deleteTemplate(deleting.key), 'Template deleted');
          setDeleting(null);
        }}
      />
    </Panel>
  );
}
