import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError, type CreatorCreationView, type Poster } from '../lib/api';
import { EmptyState, Pill, Skeleton } from '../components/ui';
import { IconAlert, IconDownload } from '../components/icons';

function Missing({ text }: { text: string }) {
  return (
    <EmptyState icon={<IconAlert size={22} />} title="Not available">
      {text}
    </EmptyState>
  );
}

/** /creator/creations/:id — a Creator's read-only view of an employee's saved photo. */
export function CreatorCreationPage() {
  const { id = '' } = useParams();
  const [c, setC] = useState<CreatorCreationView | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api.creatorCreations.get(id).then(setC).catch((e: ApiError) => setError(e.status === 404 ? 'This creation was deleted.' : e.message));
  }, [id]);
  if (error) return <Missing text={error} />;
  if (!c) return <Skeleton className="h-96 !rounded-3xl" />;
  return (
    <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
      <img src={c.imageUrl} alt={c.title} className="glass w-full !rounded-3xl p-2" />
      <aside className="glass flex flex-col gap-3 p-5 text-sm">
        <p className="text-xs uppercase tracking-wider text-text-dim">Employee creation</p>
        <h1 className="text-xl font-semibold">{c.title}</h1>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <dt className="text-text-dim">Employee</dt>
          <dd>{c.owner.name}</dd>
          <dt className="text-text-dim">Employee ID</dt>
          <dd>{c.owner.employeeCode ?? c.owner.email}</dd>
          <dt className="text-text-dim">Avatar</dt>
          <dd>{c.avatar ?? 'No avatar'}</dd>
          <dt className="text-text-dim">Created</dt>
          <dd>{new Date(c.createdAt).toLocaleString()}</dd>
          <dt className="text-text-dim">Type</dt>
          <dd>{c.kind === 'poster' ? 'Recognition poster' : `Avatar photograph (${c.source === 'CAMERA' ? 'camera' : 'upload'})`}</dd>
        </dl>
        <a href={c.downloadUrl} className="inline-flex items-center gap-2 self-start rounded-full border border-glass-border px-3 py-1.5 hover:bg-glass">
          <IconDownload size={14} /> Download JPG
        </a>
        <Link to={`/creator/employees?user=${c.owner.id}`} className="text-brand-2 hover:underline">
          View {c.owner.name}’s activity
        </Link>
      </aside>
    </div>
  );
}

/** /posters/:id — a recognition poster (owner, Creators, or the people in a shared poster). */
export function PosterViewPage() {
  const { id = '' } = useParams();
  const [p, setP] = useState<Poster | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api.posters.get(id).then(setP).catch((e: ApiError) => setError(e.status === 404 ? 'This poster isn’t available to you.' : e.message));
  }, [id]);
  if (error) return <Missing text={error} />;
  if (!p) return <Skeleton className="h-96 !rounded-3xl" />;
  return (
    <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
      {p.imageUrl ? (
        <img src={p.imageUrl} alt={p.title} className="glass w-full !rounded-3xl p-2" />
      ) : (
        <Missing text="This poster is still being generated." />
      )}
      <aside className="glass flex flex-col gap-3 p-5 text-sm">
        <p className="text-xs uppercase tracking-wider text-text-dim">Recognition poster</p>
        <h1 className="text-xl font-semibold">{p.title}</h1>
        <div className="flex flex-wrap gap-1">
          <Pill tone="brand">{p.templateName}</Pill>
          {p.event && <Pill>{p.event.name}</Pill>}
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          {p.createdBy && (
            <>
              <dt className="text-text-dim">Created by</dt>
              <dd>{p.createdBy}</dd>
            </>
          )}
          <dt className="text-text-dim">Created</dt>
          <dd>{new Date(p.createdAt).toLocaleString()}</dd>
        </dl>
        <p className="text-xs uppercase tracking-wider text-text-dim">Featuring</p>
        <ul>{p.participants.map((x) => <li key={x.userId}>{x.name}</li>)}</ul>
        {p.downloadPngUrl && (
          <div className="flex gap-2">
            <a href={p.downloadPngUrl} className="inline-flex items-center gap-2 rounded-full border border-glass-border px-3 py-1.5 hover:bg-glass">
              <IconDownload size={14} /> PNG
            </a>
            <a href={p.downloadJpgUrl!} className="inline-flex items-center gap-2 rounded-full border border-glass-border px-3 py-1.5 hover:bg-glass">
              <IconDownload size={14} /> JPG
            </a>
          </div>
        )}
      </aside>
    </div>
  );
}
