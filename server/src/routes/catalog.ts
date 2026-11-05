import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { AVATAR_TYPES } from '../lib/domain.js';
import { parse } from '../lib/http.js';
import { avatarUrls, splitTags, templateUrls } from '../lib/library-storage.js';
import type { EmbeddingProvider } from '../lib/ai/openai.js';
import {
  cosine,
  embedQuery,
  ensureEmbeddings,
  keywordScore,
  SEMANTIC_THRESHOLD,
  type SearchDoc,
} from '../lib/ai/search.js';
import { originalAlternative, protectedTermIn } from '../lib/copyright.js';

const SearchQuery = z.object({
  q: z.string().trim().min(1, 'Type something to search for').max(200),
  category: z.string().max(60).optional(),
  type: z.enum(AVATAR_TYPES).optional(),
});

/** Avatar fields every Studio listing returns (incl. source information). */
const avatarSelect = {
  id: true,
  name: true,
  description: true,
  tags: true,
  style: true,
  typeCode: true,
  thumbKey: true,
  updatedAt: true,
  mimeType: true,
  isAnimated: true,
  width: true,
  height: true,
  defaultPlacement: true,
  attribution: true,
  sourceType: true,
  sourceName: true,
  licenseName: true,
  category: { select: { slug: true, name: true } },
} as const;

type AvatarRow = {
  id: string;
  typeCode: string;
  thumbKey: string | null;
  updatedAt: Date;
  tags: string;
  sourceType: string;
  sourceName: string;
  licenseName: string;
  [k: string]: unknown;
};

const toDto = ({
  typeCode,
  thumbKey,
  updatedAt,
  tags,
  sourceType,
  sourceName,
  licenseName,
  embedding,
  embeddingModel,
  embeddingHash,
  ...a
}: AvatarRow) => ({
  ...a,
  type: typeCode,
  tags: splitTags(tags),
  source: { type: sourceType, name: sourceName, license: licenseName },
  ...avatarUrls({ id: a.id, thumbKey, updatedAt }),
});

const AvatarQuery = z.object({
  category: z.string().max(60).optional(),
  type: z.enum(AVATAR_TYPES).optional(),
  style: z.enum(['PROFESSIONAL', 'CASUAL', 'THEMED']).optional(),
  /** Free-text search over name, description and tags. */
  q: z.string().trim().max(60).optional(),
});

/**
 * What the Camera Studio can use: active avatars in active categories/types,
 * and active corporate templates. Requires `avatar.browse` (both roles).
 */
export function catalogRouter(
  prisma: PrismaClient,
  embeddings: EmbeddingProvider | null = null,
): Router {
  const router = Router();

  router.get('/categories', async (_req, res) => {
    res.json(
      await prisma.avatarCategory.findMany({
        where: { isActive: true },
        orderBy: { sortOrder: 'asc' },
        select: { id: true, name: true, slug: true, description: true },
      }),
    );
  });

  router.get('/avatar-types', async (_req, res) => {
    res.json(
      await prisma.avatarType.findMany({
        where: { isActive: true },
        orderBy: { sortOrder: 'asc' },
        select: { code: true, name: true, description: true, defaultPlacement: true },
      }),
    );
  });

  router.get('/avatars', async (req, res) => {
    const q = parse(AvatarQuery, req.query);
    const avatars = await prisma.avatar.findMany({
      where: {
        isActive: true,
        type: { isActive: true, ...(q.type ? { code: q.type } : {}) },
        category: { isActive: true, ...(q.category ? { slug: q.category } : {}) },
        ...(q.style ? { style: q.style } : {}),
        ...(q.q
          ? {
              OR: [
                { name: { contains: q.q } },
                { description: { contains: q.q } },
                { tags: { contains: q.q.toLowerCase() } },
              ],
            }
          : {}),
      },
      orderBy: [
        { category: { sortOrder: 'asc' } },
        { type: { sortOrder: 'asc' } },
        { name: 'asc' },
      ],
      select: avatarSelect,
    });
    res.json(avatars.map((x) => toDto(x as AvatarRow)));
  });

  /**
   * AI Avatar Finder. Searches ONLY the approved company library (active avatars):
   *  - keyword relevance over name, tags, category, type, style and description (always);
   *  - semantic similarity via embeddings when an OpenAI key is configured.
   * Searches naming protected characters get a rights notice + original alternatives.
   */
  router.get('/search', async (req, res) => {
    const q = parse(SearchQuery, req.query);
    const rows = await prisma.avatar.findMany({
      where: {
        isActive: true,
        type: { isActive: true, ...(q.type ? { code: q.type } : {}) },
        category: { isActive: true, ...(q.category ? { slug: q.category } : {}) },
      },
      select: {
        ...avatarSelect,
        embedding: true,
        embeddingModel: true,
        embeddingHash: true,
        type: { select: { name: true } },
      },
    });
    const docs = rows as unknown as (SearchDoc & AvatarRow)[];

    let mode: 'semantic' | 'keyword' = 'keyword';
    let semanticError: string | null = null;
    const semantic = new Map<string, number>();
    if (embeddings) {
      try {
        const [vectors, qv] = await Promise.all([
          ensureEmbeddings(prisma, embeddings, docs),
          embedQuery(embeddings, q.q),
        ]);
        for (const d of docs) {
          const v = vectors.get(d.id);
          if (v) semantic.set(d.id, cosine(qv, v));
        }
        mode = 'semantic';
      } catch (e) {
        // Semantic search is an enhancement: fall back to keywords, and say so.
        semanticError = (e as Error).message;
      }
    }

    const scored = docs
      .map((d) => {
        const kw = keywordScore(d, q.q);
        const sim = semantic.get(d.id) ?? 0;
        const sem = sim >= SEMANTIC_THRESHOLD ? Math.min(1, (sim - 0.2) / 0.4) : 0;
        const score = Math.max(kw, sem);
        const matchType = kw >= sem ? 'keyword' : 'semantic';
        return { d, score, matchType, similarity: semantic.has(d.id) ? sim : null };
      })
      .filter((r) => r.score > 0.08)
      .sort((x, y) => y.score - x.score || x.d.name.localeCompare(y.d.name))
      .slice(0, 48);

    let notice: { kind: 'rights'; term: string; message: string; suggestion: string } | null = null;
    const term = protectedTermIn(q.q);
    if (term) {
      const licensed = scored.some(
        (r) =>
          r.d.sourceType === 'LICENSED' &&
          protectedTermIn(r.d.name)?.toLowerCase() === term.toLowerCase(),
      );
      if (!licensed) {
        notice = {
          kind: 'rights',
          term,
          message: `SageIT has no licensed “${term}” artwork in the library, and exact ${term} artwork needs usage rights from its owner. Here are original superhero-inspired alternatives.`,
          suggestion: originalAlternative(term),
        };
        // Offer original superheroes rather than an empty page.
        if (!scored.length) {
          for (const d of docs.filter((x) => x.category.slug === 'superhero')) {
            scored.push({ d, score: 0.5, matchType: 'keyword', similarity: null });
          }
        }
      }
    }

    res.json({
      query: q.q,
      mode,
      semanticError,
      notice,
      results: scored.map((r) => ({
        ...toDto(r.d),
        match: { type: r.matchType, score: Number(r.score.toFixed(3)) },
      })),
    });
  });

  router.get('/templates', async (_req, res) => {
    const templates = await prisma.corporateTemplate.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        description: true,
        thumbKey: true,
        updatedAt: true,
        width: true,
        height: true,
        layout: true,
      },
    });
    res.json(
      templates.map(({ thumbKey, updatedAt, ...t }) => ({
        ...t,
        ...templateUrls({ id: t.id, thumbKey, updatedAt }),
      })),
    );
  });

  return router;
}
