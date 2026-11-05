import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  api,
  type AssetSource,
  type AvatarType,
  type AvatarTypeInfo,
  type Category,
  type LibraryAvatar,
} from '../../lib/api';
import { Select } from '../../components/Select';
import { ConfirmDialog } from '../../components/Modal';
import { useToast } from '../../components/toast-context';
import {
  Button,
  EmptyState,
  IconButton,
  OrbitLoader,
  Panel,
  Pill,
  inputClass,
} from '../../components/ui';
import { IconEye, IconLayers, IconSparkles, IconTrash, IconUpload } from '../../components/icons';
import { AvatarFormDialog } from './library/AvatarFormDialog';
import { AvatarDetailDialog } from './library/AvatarDetailDialog';
import { Checkerboard } from './library/shared';
import { SOURCE_LABEL, TYPE_LABEL } from './library/labels';

export function Toggle({
  on,
  label,
  onChange,
  busy,
}: {
  on: boolean;
  label: string;
  onChange: () => void;
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={busy}
      onClick={onChange}
      className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors duration-300 disabled:opacity-50 ${
        on ? 'border-transparent bg-gradient-brand' : 'border-glass-border bg-ink/60'
      }`}
    >
      <motion.span
        layout
        transition={{ type: 'spring', stiffness: 600, damping: 32 }}
        className={`absolute top-0.5 h-[18px] w-[18px] rounded-full bg-white shadow ${on ? 'right-0.5' : 'left-0.5'}`}
      />
    </button>
  );
}

type StatusFilter = 'all' | 'active' | 'hidden' | 'attention';

export default function LibraryTab() {
  const toast = useToast();
  const [categories, setCategories] = useState<Category[]>([]);
  const [types, setTypes] = useState<AvatarTypeInfo[]>([]);
  const [avatars, setAvatars] = useState<LibraryAvatar[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [q, setQ] = useState('');
  const [cat, setCat] = useState('all');
  const [type, setType] = useState<AvatarType | 'all'>('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [source, setSource] = useState<AssetSource | 'all'>('all');

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<LibraryAvatar | null>(null);
  const [viewing, setViewing] = useState<LibraryAvatar | null>(null);
  const [removing, setRemoving] = useState<LibraryAvatar | null>(null);
  const [newCategory, setNewCategory] = useState('');

  const load = useCallback(
    () =>
      Promise.all([api.creator.categories(), api.creator.types(), api.creator.avatars()])
        .then(([c, t, a]) => {
          setCategories(c);
          setTypes(t);
          setAvatars(a);
        })
        .catch((e: Error) => toast.error('Could not load the library', e.message)),
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

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (avatars ?? []).filter(
      (a) =>
        (cat === 'all' || a.categoryId === cat) &&
        (type === 'all' || a.typeCode === type) &&
        (source === 'all' || a.sourceType === source) &&
        (status === 'all' ||
          (status === 'active' && a.isActive) ||
          (status === 'hidden' && !a.isActive) ||
          (status === 'attention' && (a.licenseExpired || !a.rightsConfirmedAt))) &&
        (!needle ||
          a.name.toLowerCase().includes(needle) ||
          a.description.toLowerCase().includes(needle) ||
          a.tags.some((t) => t.includes(needle))),
    );
  }, [avatars, q, cat, type, status, source]);

  const counts = useMemo(
    () => ({
      total: avatars?.length ?? 0,
      active: avatars?.filter((a) => a.isActive).length ?? 0,
      attention: avatars?.filter((a) => a.licenseExpired || !a.rightsConfirmedAt).length ?? 0,
    }),
    [avatars],
  );

  if (avatars === null) return <OrbitLoader label="Loading library…" />;

  const openEdit = (a: LibraryAvatar) => {
    setViewing(null);
    setEditing(a);
    setFormOpen(true);
  };

  return (
    <div className="flex flex-col gap-5">
      <Panel
        title="Avatar library"
        subtitle={`${counts.total} avatars · ${counts.active} live in the Studio${counts.attention ? ` · ${counts.attention} need attention` : ''}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="ghost"
              size="sm"
              loading={busy === 'cleanup'}
              onClick={() =>
                act('cleanup', async () => {
                  const r = await api.creator.cleanupAvatarFiles();
                  toast.info(
                    'Storage tidied',
                    `${r.removed} unused file(s) removed, ${r.kept} kept.`,
                  );
                })
              }
            >
              Clean up unused files
            </Button>
            <Button
              size="sm"
              icon={<IconUpload size={15} />}
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              Upload avatar
            </Button>
          </div>
        }
      >
        <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr_1fr]">
          <input
            type="search"
            aria-label="Search avatars"
            placeholder="Search name, description or tag"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className={`${inputClass} !py-2 px-4`}
          />
          <Select
            label="Category"
            hideLabel
            value={cat}
            onChange={setCat}
            options={[
              { value: 'all', label: 'All categories' },
              ...categories.map((c) => ({ value: c.id, label: c.name })),
            ]}
          />
          <Select
            label="Type"
            hideLabel
            value={type}
            onChange={setType}
            options={[
              { value: 'all', label: 'All types' },
              ...(Object.keys(TYPE_LABEL) as AvatarType[]).map((t) => ({
                value: t,
                label: TYPE_LABEL[t],
              })),
            ]}
          />
          <Select
            label="Status"
            hideLabel
            value={status}
            onChange={setStatus}
            options={[
              { value: 'all', label: 'Any status' },
              { value: 'active', label: 'Active' },
              { value: 'hidden', label: 'Hidden' },
              { value: 'attention', label: 'Needs attention' },
            ]}
          />
          <Select
            label="Source"
            hideLabel
            value={source}
            onChange={setSource}
            options={[
              { value: 'all', label: 'Any source' },
              ...(Object.keys(SOURCE_LABEL) as AssetSource[]).map((s) => ({
                value: s,
                label: SOURCE_LABEL[s],
              })),
            ]}
          />
        </div>

        {visible.length === 0 ? (
          <EmptyState icon={<IconLayers size={24} />} title="No avatars match">
            Try another search or filter, or upload a new avatar.
          </EmptyState>
        ) : (
          <motion.ul
            layout
            className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
          >
            <AnimatePresence>
              {visible.map((a) => {
                const canDelete = !a.isActive && a.usageCount === 0;
                return (
                  <motion.li
                    key={a.id}
                    layout
                    initial={{ opacity: 0, scale: 0.96 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    className={`glass-subtle glass-interactive group flex flex-col gap-2 p-2.5 ${a.isActive ? '' : 'opacity-70'}`}
                  >
                    <button
                      onClick={() => setViewing(a)}
                      aria-label={`Preview ${a.name}`}
                      className="block"
                    >
                      <Checkerboard className="grid aspect-square place-items-center">
                        <img
                          src={a.thumbnailUrl}
                          alt=""
                          loading="lazy"
                          className="max-h-full max-w-full object-contain p-1.5 transition-transform duration-300 group-hover:scale-105"
                        />
                        <span className="absolute inset-0 grid place-items-center bg-ink/40 opacity-0 transition-opacity group-hover:opacity-100">
                          <IconEye size={20} />
                        </span>
                      </Checkerboard>
                    </button>
                    <div className="min-w-0 px-0.5">
                      <div className="truncate text-sm font-medium">{a.name}</div>
                      <div className="truncate text-[11px] text-text-muted">
                        {a.category.name} · {TYPE_LABEL[a.typeCode]}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1 px-0.5">
                      <Pill tone={a.sourceType === 'LICENSED' ? 'brand' : 'neutral'}>
                        {SOURCE_LABEL[a.sourceType]}
                      </Pill>
                      {a.licenseExpired && <Pill tone="warn">Licence expired</Pill>}
                      {!a.rightsConfirmedAt && <Pill tone="warn">Rights unconfirmed</Pill>}
                      {a.usageCount > 0 && <Pill>{a.usageCount} uses</Pill>}
                    </div>
                    <div className="mt-auto flex items-center justify-between gap-1 px-0.5">
                      <Toggle
                        on={a.isActive}
                        label={`${a.isActive ? 'Deactivate' : 'Activate'} ${a.name}`}
                        busy={busy === a.id}
                        onChange={() =>
                          act(
                            a.id,
                            () => api.creator.updateAvatar(a.id, { isActive: !a.isActive }),
                            a.isActive ? `${a.name} hidden` : `${a.name} is live`,
                          )
                        }
                      />
                      <div className="flex gap-1">
                        <IconButton
                          label={`Edit ${a.name}`}
                          size="sm"
                          variant="subtle"
                          icon={<IconSparkles size={14} />}
                          onClick={() => openEdit(a)}
                        />
                        <IconButton
                          label={
                            canDelete
                              ? `Remove ${a.name}`
                              : a.isActive
                                ? 'Deactivate before removing'
                                : 'In use — keep it deactivated'
                          }
                          size="sm"
                          variant="subtle"
                          disabled={!canDelete}
                          icon={<IconTrash size={14} />}
                          onClick={() => setRemoving(a)}
                        />
                      </div>
                    </div>
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </motion.ul>
        )}
      </Panel>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Categories" subtitle="Hidden categories disappear from the Studio tray.">
          <form
            className="mb-4 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              act(
                'cat',
                async () => {
                  await api.creator.createCategory(newCategory);
                  setNewCategory('');
                },
                'Category added',
              );
            }}
          >
            <input
              aria-label="New category name"
              placeholder="New category name"
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              className={`${inputClass} !py-2 px-4`}
            />
            <Button type="submit" loading={busy === 'cat'} disabled={newCategory.trim().length < 2}>
              Add
            </Button>
          </form>
          <ul className="flex flex-col gap-2">
            {categories.map((c) => (
              <li key={c.id} className="glass-subtle flex items-center gap-3 px-4 py-2.5">
                <span className="flex-1 text-sm">{c.name}</span>
                <span className="text-xs text-text-dim">{c._count?.avatars ?? 0} avatars</span>
                <Toggle
                  on={!!c.isActive}
                  label={`Show ${c.name} in the Studio`}
                  busy={busy === c.id}
                  onChange={() =>
                    act(c.id, () => api.creator.updateCategory(c.id, { isActive: !c.isActive }))
                  }
                />
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Avatar types" subtitle="The four fixed types and where they land by default.">
          <ul className="flex flex-col gap-2">
            {types.map((t) => (
              <li key={t.code} className="glass-subtle flex items-center gap-3 px-4 py-2.5">
                <span className="flex-1 text-sm">{t.name}</span>
                <Pill>{t.defaultPlacement.layer}</Pill>
                <Toggle
                  on={!!t.isActive}
                  label={`Enable ${t.name} avatars`}
                  busy={busy === t.code}
                  onChange={() =>
                    act(t.code, () => api.creator.updateType(t.code, { isActive: !t.isActive }))
                  }
                />
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      {formOpen && (
        <AvatarFormDialog
          open
          editing={editing}
          categories={categories}
          onClose={() => setFormOpen(false)}
          onSaved={() => {
            setFormOpen(false);
            load();
          }}
        />
      )}
      <AvatarDetailDialog avatar={viewing} onClose={() => setViewing(null)} onEdit={openEdit} />
      <ConfirmDialog
        open={!!removing}
        title={`Remove ${removing?.name ?? ''}?`}
        description="The image and its record are deleted permanently. This can’t be undone."
        confirmLabel="Remove"
        danger
        busy={busy === 'remove'}
        onCancel={() => setRemoving(null)}
        onConfirm={() =>
          act(
            'remove',
            async () => {
              await api.creator.deleteAvatar(removing!.id);
              setRemoving(null);
            },
            'Avatar removed',
          )
        }
      />
    </div>
  );
}
