import { source } from '@/lib/source';
import fs from 'node:fs/promises';
import path from 'node:path';

export const dynamic = 'force-static';

/**
 * Index handler — serves the docs root (`content/docs/index.mdx`) as
 * raw markdown via `/raw/index`.
 *
 * Sibling `app/raw/[...slug]/route.ts` handles every deep path. We put
 * the index INSIDE the `/raw/` directory (not at `/raw` directly)
 * because Next.js static export can't have both:
 *   - `out/raw`  (a file produced by a base-level route)
 *   - `out/raw/` (a directory for child-route files)
 * The collision manifests as `EISDIR` during the export step. Hosting
 * the index at `/raw/index` keeps everything safely inside `out/raw/`
 * as a directory.
 *
 * Consumed by `app/docs/[[...slug]]/_components/llm-actions.tsx` —
 * when the current docs page has an empty slug, that component
 * requests `/raw/index` instead of `/raw`.
 */
export async function GET() {
  const page = source.getPage([]);
  if (!page) {
    return new Response('Not found', { status: 404 });
  }
  const filePath = path.join(process.cwd(), 'content/docs', page.file.path);
  const raw = await fs.readFile(filePath, 'utf8');
  return new Response(raw, {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
  });
}
