import { source } from '@/lib/source';
import fs from 'node:fs/promises';
import path from 'node:path';

export const dynamic = 'force-static';

export function generateStaticParams() {
  return source.generateParams();
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug?: string[] }> },
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
