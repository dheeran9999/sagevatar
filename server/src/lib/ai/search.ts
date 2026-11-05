import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { EmbeddingProvider } from './openai.js';
import { splitTags } from '../library-storage.js';

/** Fields the finder needs from each avatar. */
export interface SearchDoc {
  id: string;
  name: string;
  description: string;
  tags: string;
  style: string;
  typeCode: string;
  sourceType: string;
  category: { name: string; slug: string };
  type: { name: string };
  embedding: string | null;
  embeddingModel: string | null;
  embeddingHash: string | null;
}

/** Everyday words → words the library actually uses. Keeps keyword search useful without AI. */
const SYNONYMS: Record<string, string[]> = {
  superhero: ['hero', 'cape', 'mask', 'superhero'],
  hero: ['superhero', 'cape'],
  female: ['woman', 'girl', 'she', 'her', 'heroine', 'female'],
  woman: ['female', 'girl', 'she', 'her'],
  male: ['man', 'boy', 'he', 'his', 'male'],
  man: ['male', 'boy', 'he', 'his'],
  business: ['professional', 'office', 'suit', 'business', 'corporate'],
  professional: ['business', 'office', 'suit'],
  corporate: ['office', 'business', 'brand', 'corporate'],
  mascot: ['brand', 'cheerful', 'corporate', 'mascot'],
  anime: ['anime', 'manga'],
  robot: ['robot', 'android', 'futuristic', 'mech', 'tech'],
  futuristic: ['futuristic', 'neon', 'tech', 'sci-fi'],
  cute: ['cute', 'cheerful', 'chibi', 'friendly', 'kawaii'],
  cartoon: ['cartoon', 'cute', 'friendly'],
  character: [],
  background: ['background', 'scene', 'backdrop'],
};

const STOP = new Set([
  'a',
  'an',
  'the',
  'with',
  'and',
  'or',
  'of',
  'in',
  'for',
  'to',
  'some',
  'me',
  'i',
  'want',
  'like',
  'avatar',
  'avatars',
  'character',
]);

export const tokenize = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/[\s-]+/)
    .filter((t) => t.length > 1 && !STOP.has(t));

/** 0..1 keyword relevance. Exact name phrase > name word > tag > category/type > description. */
export function keywordScore(doc: SearchDoc, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const name = doc.name.toLowerCase();
  const tags = splitTags(doc.tags).join(' ').toLowerCase();
  const desc = doc.description.toLowerCase();
  const cat = `${doc.category.name} ${doc.category.slug}`.toLowerCase();
  const type = `${doc.type.name} ${doc.typeCode}`.toLowerCase().replace('_', ' ');
  const style = doc.style.toLowerCase();

  let score = name.includes(q) ? 6 : 0;
  const tokens = tokenize(q);
  if (!tokens.length) return score ? 1 : 0;
  let matched = 0;
  for (const t of tokens) {
    const words = [t, ...(SYNONYMS[t] ?? [])];
    const hit = (hay: string) => words.some((w) => new RegExp(`\\b${w}`, 'i').test(hay));
    let best = 0;
    if (hit(name)) best = 3;
    else if (hit(tags)) best = 2;
    else if (hit(cat) || hit(type) || hit(style)) best = 1.6;
    else if (hit(desc)) best = 1;
    if (best) matched++;
    score += best;
  }
  // Every query word should count for something; mostly-unmatched queries rank low.
  const coverage = matched / tokens.length;
  return Math.min(1, (score / (3 * tokens.length + 6)) * (0.4 + 0.6 * coverage) * 2);
}

export const embeddingText = (d: SearchDoc) =>
  `${d.name}. ${d.description}. Tags: ${splitTags(d.tags).join(', ')}. Category: ${d.category.name}. Type: ${d.type.name}. Style: ${d.style.toLowerCase()}.`;

const hashOf = (s: string) => createHash('sha1').update(s).digest('hex');

export function cosine(a: number[], b: number[]) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** Embeds avatars whose text changed (or never embedded) and stores the vectors. */
export async function ensureEmbeddings(
  prisma: PrismaClient,
  provider: EmbeddingProvider,
  docs: SearchDoc[],
): Promise<Map<string, number[]>> {
  const out = new Map<string, number[]>();
  const stale: { doc: SearchDoc; text: string; hash: string }[] = [];
  for (const d of docs) {
    const text = embeddingText(d);
    const hash = hashOf(text);
    if (d.embedding && d.embeddingHash === hash && d.embeddingModel === provider.model) {
      out.set(d.id, JSON.parse(d.embedding) as number[]);
    } else stale.push({ doc: d, text, hash });
  }
  for (let i = 0; i < stale.length; i += 64) {
    const batch = stale.slice(i, i + 64);
    const vectors = await provider.embed(batch.map((b) => b.text));
    await prisma.$transaction(
      batch.map((b, j) =>
        prisma.avatar.update({
          where: { id: b.doc.id },
          data: {
            embedding: JSON.stringify(vectors[j]),
            embeddingModel: provider.model,
            embeddingHash: b.hash,
          },
        }),
      ),
    );
    batch.forEach((b, j) => out.set(b.doc.id, vectors[j]));
  }
  return out;
}

const queryCache = new Map<string, number[]>();

export async function embedQuery(provider: EmbeddingProvider, q: string) {
  const key = `${provider.model}:${q.toLowerCase()}`;
  const hit = queryCache.get(key);
  if (hit) return hit;
  const [v] = await provider.embed([q]);
  if (queryCache.size > 500) queryCache.clear();
  queryCache.set(key, v);
  return v;
}

/** Semantic similarity below this isn't shown as a match. */
export const SEMANTIC_THRESHOLD = 0.3;
