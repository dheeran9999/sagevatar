import { useEffect, useState, type DragEvent, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  api,
  ApiError,
  type AssetSource,
  type AvatarStyle,
  type AvatarType,
  type Category,
  type LibraryAvatar,
} from '../../../lib/api';
import { sniffImageType } from '../../../lib/image';
import { Modal } from '../../../components/Modal';
import { Select } from '../../../components/Select';
import { useToast } from '../../../components/toast-context';
import { Button, ErrorText, Field, Pill } from '../../../components/ui';
import { IconAlert, IconCheck, IconUpload } from '../../../components/icons';
import { Checkerboard, TextArea } from './shared';
import { formatBytes, SOURCE_LABEL, STYLE_LABEL, TYPE_LABEL } from './labels';

const MAX_MB = 10;

interface Inspection {
  url: string;
  width: number;
  height: number;
  format: 'image/png' | 'image/webp' | 'image/jpeg';
  transparent: boolean;
}

/** Decodes the chosen file locally to preview it and check for transparency before upload. */
async function inspect(file: File): Promise<Inspection> {
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const format = sniffImageType(head);
  if (!format) throw new Error('Choose a PNG or WebP image (JPEG is allowed for backgrounds).');
  if (file.size > MAX_MB * 1024 * 1024)
    throw new Error(`That file is ${formatBytes(file.size)}. The limit is ${MAX_MB} MB.`);
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error('This image couldn’t be opened.');
  });
  const c = document.createElement('canvas');
  const k = Math.min(1, 256 / Math.max(bitmap.width, bitmap.height));
  c.width = Math.max(1, Math.round(bitmap.width * k));
  c.height = Math.max(1, Math.round(bitmap.height * k));
  const ctx = c.getContext('2d', { willReadFrequently: true });
  let transparent = false;
  if (ctx && format !== 'image/jpeg') {
    ctx.drawImage(bitmap, 0, 0, c.width, c.height);
    const data = ctx.getImageData(0, 0, c.width, c.height).data;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 250) {
        transparent = true;
        break;
      }
    }
  }
  const out = {
    url: URL.createObjectURL(file),
    width: bitmap.width,
    height: bitmap.height,
    format,
    transparent,
  };
  bitmap.close();
  return out;
}

interface FormState {
  name: string;
  description: string;
  tags: string;
  style: AvatarStyle;
  categoryId: string;
  type: AvatarType;
  sourceType: AssetSource;
  sourceName: string;
  sourceUrl: string;
  licenseName: string;
  licenseUrl: string;
  licenseNotes: string;
  attribution: string;
  licenseExpiresAt: string;
  rightsConfirmed: boolean;
  activate: boolean;
}

const blank = (categoryId: string): FormState => ({
  name: '',
  description: '',
  tags: '',
  style: 'CASUAL',
  categoryId,
  type: 'HALF_BODY',
  sourceType: 'IN_HOUSE',
  sourceName: '',
  sourceUrl: '',
  licenseName: '',
  licenseUrl: '',
  licenseNotes: '',
  attribution: '',
  licenseExpiresAt: '',
  rightsConfirmed: false,
  activate: false,
});

const fromAvatar = (a: LibraryAvatar): FormState => ({
  name: a.name,
  description: a.description,
  tags: a.tags.join(', '),
  style: a.style,
  categoryId: a.categoryId,
  type: a.typeCode,
  sourceType: a.sourceType,
  sourceName: a.sourceName,
  sourceUrl: a.sourceUrl ?? '',
  licenseName: a.licenseName,
  licenseUrl: a.licenseUrl ?? '',
  licenseNotes: a.licenseNotes,
  attribution: a.attribution,
  licenseExpiresAt: a.licenseExpiresAt?.slice(0, 10) ?? '',
  rightsConfirmed: !!a.rightsConfirmedAt,
  activate: a.isActive,
});

/** Upload a new avatar, or edit an existing one's details and licensing. */
export function AvatarFormDialog({
  open,
  editing,
  categories,
  onClose,
  onSaved,
}: {
  open: boolean;
  editing: LibraryAvatar | null;
  categories: Category[];
  onClose: () => void;
  onSaved: (a: LibraryAvatar) => void;
}) {
  const toast = useToast();
  const [f, setF] = useState<FormState>(() =>
    editing ? fromAvatar(editing) : blank(categories[0]?.id ?? ''),
  );
  const [file, setFile] = useState<File | null>(null);
  const [info, setInfo] = useState<Inspection | null>(null);
  const [fileError, setFileError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);

  useEffect(
    () => () => {
      if (info) URL.revokeObjectURL(info.url);
    },
    [info],
  );

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((s) => ({ ...s, [k]: v }));

  const choose = async (next: File | undefined) => {
    if (!next) return;
    setFileError('');
    setInfo(null);
    setFile(null);
    try {
      const i = await inspect(next);
      setFile(next);
      setInfo(i);
      if (!f.name)
        set(
          'name',
          next.name
            .replace(/\.[^.]+$/, '')
            .replace(/[-_]+/g, ' ')
            .slice(0, 80),
        );
      if (i.width > i.height * 1.4) set('type', 'BACKGROUND');
    } catch (e) {
      setFileError((e as Error).message);
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    choose(e.dataTransfer.files?.[0]);
  };

  const needsCutout = f.type !== 'BACKGROUND';
  const fileProblem =
    info && needsCutout && (info.format === 'image/jpeg' || !info.transparent)
      ? 'Character avatars need a transparent background. Use a PNG or WebP cut-out, or choose the Background type.'
      : '';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!editing && !file) return setError('Choose an image to upload.');
    if (fileProblem) return setError(fileProblem);
    if (!f.rightsConfirmed) return setError('Confirm that SageIT has the right to use this image.');
    setBusy(true);
    try {
      let saved: LibraryAvatar;
      if (editing) {
        saved = await api.creator.updateAvatar(editing.id, {
          name: f.name,
          description: f.description,
          tags: f.tags
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean),
          style: f.style,
          categoryId: f.categoryId,
          type: f.type,
          sourceType: f.sourceType,
          sourceName: f.sourceName,
          sourceUrl: f.sourceUrl || null,
          licenseName: f.licenseName,
          licenseUrl: f.licenseUrl || null,
          licenseNotes: f.licenseNotes,
          attribution: f.attribution,
          licenseExpiresAt: f.licenseExpiresAt || null,
        });
        toast.success('Avatar updated', saved.name);
      } else {
        const form = new FormData();
        form.append('file', file!);
        (
          [
            'name',
            'description',
            'tags',
            'style',
            'categoryId',
            'type',
            'sourceType',
            'sourceName',
            'sourceUrl',
            'licenseName',
            'licenseUrl',
            'licenseNotes',
            'attribution',
            'licenseExpiresAt',
          ] as const
        ).forEach((k) => form.append(k, String(f[k])));
        form.append('rightsConfirmed', 'true');
        form.append('isActive', String(f.activate));
        saved = await api.creator.uploadAvatar(form);
        toast.success(
          'Avatar uploaded',
          f.activate ? 'It’s live in the Studio.' : 'It’s hidden until you activate it.',
        );
      }
      onSaved(saved);
    } catch (err) {
      setError(
        err instanceof ApiError && err.details?.length
          ? `${err.details[0].message}`
          : (err as Error).message,
      );
    } finally {
      setBusy(false);
    }
  };

  const licensed = f.sourceType === 'LICENSED';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? `Edit ${editing.name}` : 'Upload avatar'}
      size="lg"
    >
      <form onSubmit={submit} className="flex max-h-[70vh] flex-col gap-5 overflow-y-auto pr-1">
        <div className="grid gap-5 md:grid-cols-[220px_1fr]">
          {/* Asset */}
          <div className="flex flex-col gap-2">
            {editing ? (
              <Checkerboard className="grid aspect-square place-items-center">
                <img
                  src={editing.fileUrl}
                  alt=""
                  className="max-h-full max-w-full object-contain p-2"
                />
              </Checkerboard>
            ) : (
              <label
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                className={`group relative grid aspect-square cursor-pointer place-items-center overflow-hidden rounded-xl border-2 border-dashed transition ${
                  dragging
                    ? 'border-brand-2 bg-brand-2/10'
                    : 'border-glass-edge hover:border-brand-2/60'
                }`}
              >
                <input
                  type="file"
                  accept="image/png,image/webp,image/jpeg"
                  className="sr-only"
                  aria-label="Avatar image file"
                  onChange={(e) => choose(e.target.files?.[0])}
                />
                {info ? (
                  <Checkerboard className="absolute inset-0 grid place-items-center">
                    <img
                      src={info.url}
                      alt="Selected avatar preview"
                      className="max-h-full max-w-full object-contain p-2"
                    />
                  </Checkerboard>
                ) : (
                  <span className="flex flex-col items-center gap-2 px-4 text-center text-xs text-text-muted">
                    <IconUpload size={22} />
                    Drop a transparent PNG or WebP here, or click to choose
                  </span>
                )}
              </label>
            )}
            <AnimatePresence>
              {info && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex flex-wrap gap-1.5"
                >
                  <Pill>{info.format.replace('image/', '').toUpperCase()}</Pill>
                  <Pill>
                    {info.width}×{info.height}
                  </Pill>
                  <Pill>{formatBytes(file?.size)}</Pill>
                  {info.format !== 'image/jpeg' && (
                    <Pill tone={info.transparent ? 'ok' : 'warn'}>
                      {info.transparent ? <IconCheck size={11} /> : <IconAlert size={11} />}
                      {info.transparent ? 'Transparent' : 'No transparency'}
                    </Pill>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
            {fileError && <p className="text-xs text-accent">{fileError}</p>}
            {fileProblem && <p className="text-xs text-accent">{fileProblem}</p>}
          </div>

          {/* Details */}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Name"
              required
              minLength={2}
              maxLength={80}
              value={f.name}
              onChange={(e) => set('name', e.target.value)}
              className="sm:col-span-2"
            />
            <div className="sm:col-span-2">
              <TextArea
                label="Description"
                maxLength={500}
                value={f.description}
                onChange={(e) => set('description', e.target.value)}
                placeholder="What this avatar looks like and when to use it"
              />
            </div>
            <Select
              label="Category"
              value={f.categoryId}
              onChange={(v) => set('categoryId', v)}
              options={categories.map((c) => ({ value: c.id, label: c.name }))}
            />
            <Select
              label="Avatar type"
              value={f.type}
              onChange={(v) => set('type', v)}
              options={(Object.keys(TYPE_LABEL) as AvatarType[]).map((t) => ({
                value: t,
                label: TYPE_LABEL[t],
              }))}
            />
            <Select
              label="Style"
              value={f.style}
              onChange={(v) => set('style', v)}
              options={(Object.keys(STYLE_LABEL) as AvatarStyle[]).map((s) => ({
                value: s,
                label: STYLE_LABEL[s],
              }))}
            />
            <Field
              label="Tags"
              hint="Comma separated, e.g. smile, wave, suit"
              value={f.tags}
              maxLength={400}
              onChange={(e) => set('tags', e.target.value)}
            />
          </div>
        </div>

        {/* Source & licence */}
        <fieldset className="glass-subtle flex flex-col gap-3 p-4">
          <legend className="px-1 text-sm font-semibold">Source & licence</legend>
          <p className="text-xs text-text-muted">
            Recorded for every asset. Third-party characters (e.g. Marvel or DC heroes) may only be
            added as <strong>Licensed</strong>, with the licence on file.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Select
              label="Source"
              value={f.sourceType}
              onChange={(v) => set('sourceType', v)}
              options={(Object.keys(SOURCE_LABEL) as AssetSource[]).map((s) => ({
                value: s,
                label: SOURCE_LABEL[s],
              }))}
            />
            <Field
              label={f.sourceType === 'ORIGINAL' ? 'Author (optional)' : 'Author, studio or vendor'}
              required={f.sourceType !== 'ORIGINAL'}
              maxLength={120}
              value={f.sourceName}
              onChange={(e) => set('sourceName', e.target.value)}
            />
            <Field
              label="Licence"
              required
              placeholder="e.g. Original work, Adobe Stock Standard, CC0"
              maxLength={120}
              value={f.licenseName}
              onChange={(e) => set('licenseName', e.target.value)}
            />
            <Field
              label="Licence URL"
              type="url"
              placeholder="https://"
              value={f.licenseUrl}
              onChange={(e) => set('licenseUrl', e.target.value)}
            />
            <Field
              label="Source URL"
              type="url"
              placeholder="https://"
              value={f.sourceUrl}
              onChange={(e) => set('sourceUrl', e.target.value)}
            />
            <Field
              label="Licence expires"
              type="date"
              value={f.licenseExpiresAt}
              onChange={(e) => set('licenseExpiresAt', e.target.value)}
            />
            <Field
              label="Attribution text"
              placeholder="Credit line, if the licence requires one"
              maxLength={200}
              value={f.attribution}
              onChange={(e) => set('attribution', e.target.value)}
              className="sm:col-span-2"
            />
            <div className="sm:col-span-2">
              <TextArea
                label={licensed ? 'Licence reference (required without a URL)' : 'Notes'}
                maxLength={1000}
                rows={2}
                value={f.licenseNotes}
                onChange={(e) => set('licenseNotes', e.target.value)}
                placeholder={
                  licensed
                    ? 'Order number, agreement ID, permitted uses…'
                    : 'Anything worth knowing about this asset'
                }
              />
            </div>
          </div>
          {!editing && (
            <label className="flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                checked={f.rightsConfirmed}
                onChange={(e) => set('rightsConfirmed', e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-brand"
              />
              <span>
                I confirm SageIT has the right to use this image for employee photos, and the
                details above are accurate.
              </span>
            </label>
          )}
        </fieldset>

        {!editing && (
          <label className="flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={f.activate}
              onChange={(e) => set('activate', e.target.checked)}
              className="h-4 w-4 accent-brand"
            />
            Make it available in the Studio straight away
          </label>
        )}

        <ErrorText>{error}</ErrorText>
        <div className="sticky bottom-0 flex justify-end gap-2 bg-gradient-to-t from-[#0d1332] to-transparent pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            loading={busy}
            icon={editing ? <IconCheck size={16} /> : <IconUpload size={16} />}
          >
            {editing ? 'Save changes' : 'Upload avatar'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
