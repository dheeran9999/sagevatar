import type { AppConfig } from '../../config.js';
import { HttpError } from '../http.js';

/**
 * Server-side OpenAI client (plain fetch, no SDK). The API key never leaves the server.
 * OPENAI_BASE_URL lets tests point this at a local stub that speaks the same API.
 */
export type ImageSize = '1024x1024' | '1024x1536' | '1536x1024';

export interface ImageProvider {
  provider: 'openai';
  model: string;
  generate(prompt: string, opts: { size: ImageSize; transparent: boolean }): Promise<Buffer>;
  /** Image edit: returns a new image based on `image` (PNG) and the prompt. */
  edit?(prompt: string, image: Buffer, opts: { size: ImageSize }): Promise<Buffer>;
}

export interface EmbeddingProvider {
  model: string;
  embed(texts: string[]): Promise<number[][]>;
}

export interface AiProviders {
  images: ImageProvider | null;
  embeddings: EmbeddingProvider | null;
}

/** Turns an OpenAI error body into something safe to show (never echoes the key). */
async function failure(res: Response, what: string): Promise<HttpError> {
  let message = '';
  try {
    const body = (await res.json()) as { error?: { message?: string; code?: string } };
    message = body.error?.message ?? '';
    if (body.error?.code === 'moderation_blocked' || /safety system/i.test(message)) {
      return new HttpError(
        422,
        'The AI service declined this description (content policy). Try describing it differently.',
      );
    }
  } catch {
    /* non-JSON error */
  }
  if (res.status === 401)
    return new HttpError(502, `${what}: the AI service rejected the API key.`);
  if (res.status === 429)
    return new HttpError(503, `${what}: the AI service is busy or out of quota. Try again later.`);
  return new HttpError(502, `${what} failed${message ? `: ${message.slice(0, 200)}` : ''}`);
}

export function createAiProviders(config: AppConfig): AiProviders {
  if (!config.aiConfigured) return { images: null, embeddings: null };
  const base = config.OPENAI_BASE_URL.replace(/\/$/, '');
  const headers = {
    Authorization: `Bearer ${config.OPENAI_API_KEY}`,
    'Content-Type': 'application/json',
  };

  const images: ImageProvider = {
    provider: 'openai',
    model: config.OPENAI_IMAGE_MODEL,
    async generate(prompt, { size, transparent }) {
      let res: Response;
      try {
        res = await fetch(`${base}/images/generations`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: config.OPENAI_IMAGE_MODEL,
            prompt,
            n: 1,
            size,
            quality: config.OPENAI_IMAGE_QUALITY,
            background: transparent ? 'transparent' : 'opaque',
            output_format: 'png',
          }),
          signal: AbortSignal.timeout(180_000),
        });
      } catch (e) {
        throw new HttpError(
          504,
          `Image generation timed out or could not connect (${(e as Error).name})`,
        );
      }
      if (!res.ok) throw await failure(res, 'Image generation');
      const body = (await res.json()) as { data?: { b64_json?: string }[] };
      const b64 = body.data?.[0]?.b64_json;
      if (!b64) throw new HttpError(502, 'The AI service returned no image');
      return Buffer.from(b64, 'base64');
    },
  };

  images.edit = async (prompt, image, { size }) => {
    const form = new FormData();
    form.append('model', config.OPENAI_IMAGE_MODEL);
    form.append('prompt', prompt);
    form.append('size', size);
    form.append('quality', config.OPENAI_IMAGE_QUALITY);
    form.append('n', '1');
    // Keep the layout (positions, sizes) as close to the input as possible.
    form.append('input_fidelity', 'high');
    form.append('image', new Blob([new Uint8Array(image)], { type: 'image/png' }), 'layout.png');
    let res: Response;
    try {
      res = await fetch(`${base}/images/edits`, {
        method: 'POST',
        headers: { Authorization: headers.Authorization },
        body: form,
        signal: AbortSignal.timeout(240_000),
      });
    } catch (e) {
      throw new HttpError(504, `Image editing timed out or could not connect (${(e as Error).name})`);
    }
    if (!res.ok) throw await failure(res, 'Image editing');
    const body = (await res.json()) as { data?: { b64_json?: string }[] };
    const b64 = body.data?.[0]?.b64_json;
    if (!b64) throw new HttpError(502, 'The AI service returned no image');
    return Buffer.from(b64, 'base64');
  };

  const embeddings: EmbeddingProvider = {
    model: config.OPENAI_EMBEDDING_MODEL,
    async embed(texts) {
      const res = await fetch(`${base}/embeddings`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model: config.OPENAI_EMBEDDING_MODEL, input: texts }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw await failure(res, 'Semantic search');
      const body = (await res.json()) as { data: { index: number; embedding: number[] }[] };
      return body.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
    },
  };

  return { images, embeddings };
}
