import { source } from '@/lib/source';
import fs from 'node:fs/promises';
import path from 'node:path';

export const dynamic = 'force-static';

/**
 * Deep-path handler — required catch-all (`[...slug]`, not optional
 * `[[...slug]]`) so the empty-slug case is delegated to the sibling
 * `app/raw/route.ts` static handler. See that file for the rationale
 * (EISDIR collision during `output: 'export'`).
 */
export function generateStaticParams() {
  return source.generateParams().filter((p) => p.slug.length > 0);
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string[] }> },
) {
  const { slug } = await params;
  const page = source.getPage(slug);
  if (!page) {
    return new Response('Not found', { status: 404 });
  }
  const filePath = path.join(process.cwd(), 'content/docs', page.file.path);
  const raw = await fs.readFile(filePath, 'utf8');
  return new Response(raw, {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
  });
}
