import { source } from '@/lib/source';
import fs from 'node:fs/promises';
import path from 'node:path';

export const dynamic = 'force-static';

const SITE_URL = 'https://movehat.dev';

export async function GET() {
  const pages = source.getPages();
  const blocks = await Promise.all(
    pages.map(async (p) => {
      const filePath = path.join(process.cwd(), 'content/docs', p.file.path);
      const raw = await fs.readFile(filePath, 'utf8');
      return `# ${p.data.title} (${SITE_URL}${p.url})\n\n${raw}`;
    }),
  );
  const body = blocks.join('\n\n---\n\n') + '\n';
  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
