import { source } from '@/lib/source';

export const dynamic = 'force-static';

const SITE_URL = 'https://movehat.dev';

export function GET() {
  const pages = source.getPages();
  const body = [
    '# Movehat',
    '',
    '> A Hardhat-like development framework for Movement L1 and Aptos Move smart contracts. Write tests and deployment scripts in TypeScript.',
    '',
    '## Docs',
    '',
    ...pages.map((p) => {
      const desc = p.data.description ? `: ${p.data.description}` : '';
      return `- [${p.data.title}](${SITE_URL}${p.url})${desc}`;
    }),
    '',
  ].join('\n');
  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
