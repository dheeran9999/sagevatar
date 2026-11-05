import { existsSync, mkdirSync, readdirSync, renameSync, rmdirSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import type { Avatar, CorporateTemplate } from '@prisma/client';
import type { AppConfig } from '../config.js';
import { HttpError } from './http.js';

/**
 * Library assets (avatars, templates) live in PRIVATE storage under library/<kind>/ and are
 * streamed by /api/assets/... only to signed-in users. The database stores relative keys,
 * never public URLs.
 */
export type LibraryKind = 'avatars' | 'templates';

export const libraryKey = (kind: LibraryKind, fileName: string) =>
  path.posix.join('library', kind, fileName);

export const libraryDir = (config: AppConfig, kind: LibraryKind) =>
  path.join(config.privateStorage, 'library', kind);

/** Resolves a stored key to an absolute path, refusing anything outside private storage. */
export function resolveKey(config: AppConfig, key: string): string {
  const root = path.resolve(config.privateStorage);
  const full = path.resolve(root, key);
  if (!full.startsWith(root + path.sep)) throw new HttpError(404, 'Not found');
  return full;
}

export async function removeKeys(config: AppConfig, keys: (string | null | undefined)[]) {
  const unique = [...new Set(keys.filter((k): k is string => !!k))];
  await Promise.all(unique.map((k) => rm(resolveKey(config, k), { force: true })));
}

/**
 * One-time move of files from the old public /media folders into private storage.
 * Safe to call on every start; does nothing once the public folders are gone.
 */
export function relocateLegacyLibraryFiles(config: AppConfig): number {
  let moved = 0;
  for (const kind of ['avatars', 'templates'] as const) {
    const from = path.join(config.publicStorage, kind);
    if (!existsSync(from)) continue;
    const to = libraryDir(config, kind);
    mkdirSync(to, { recursive: true });
    for (const f of readdirSync(from)) {
      const target = path.join(to, f);
      if (!existsSync(target)) {
        renameSync(path.join(from, f), target);
        moved++;
      }
    }
    try {
      rmdirSync(from);
    } catch {
      /* not empty (name clash) — leave it for manual review */
    }
  }
  return moved;
}

const version = (d: Date) => d.getTime().toString(36);

/** Public shape of an avatar: storage keys are replaced by authenticated asset URLs. */
export function avatarUrls(a: Pick<Avatar, 'id' | 'thumbKey' | 'updatedAt'>) {
  const v = version(a.updatedAt);
  const fileUrl = `/api/assets/avatars/${a.id}/file?v=${v}`;
  return {
    fileUrl,
    thumbnailUrl: a.thumbKey ? `/api/assets/avatars/${a.id}/thumb?v=${v}` : fileUrl,
  };
}

export function templateUrls(t: Pick<CorporateTemplate, 'id' | 'thumbKey' | 'updatedAt'>) {
  const v = version(t.updatedAt);
  const fileUrl = `/api/assets/templates/${t.id}/file?v=${v}`;
  return {
    fileUrl,
    thumbnailUrl: t.thumbKey ? `/api/assets/templates/${t.id}/thumb?v=${v}` : fileUrl,
  };
}

export const splitTags = (tags: string) =>
  tags
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);

export const normalizeTags = (tags: string[] | string) =>
  [
    ...new Set(
      (Array.isArray(tags) ? tags : tags.split(','))
        .map((t) =>
          t
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9 -]/g, ''),
        )
        .filter(Boolean),
    ),
  ]
    .slice(0, 20)
    .join(',');
