'use client';

import { useState } from 'react';

const SITE_URL = process.env.NEXT_PUBLIC_MOVEHAT_DOCS_SITE_URL ?? 'https://movehat.dev';

function buildProviderUrl(provider: 'chatgpt' | 'claude' | 'gemini', docUrl: string) {
  const prompt = `Read this Movehat documentation page and help me understand it: ${docUrl}`;
  const q = encodeURIComponent(prompt);
  switch (provider) {
    case 'chatgpt':
      return `https://chat.openai.com/?hints=search&q=${q}`;
    case 'claude':
      return `https://claude.ai/new?q=${q}`;
    case 'gemini':
      return `https://gemini.google.com/app?q=${q}`;
  }
}

const ChatGPTIcon = () => (
  <svg width="13" height="13" viewBox="0 0 41 41" fill="currentColor" aria-hidden>
    <path d="M37.532 16.87a9.963 9.963 0 0 0-.856-8.184 10.078 10.078 0 0 0-10.855-4.835A9.964 9.964 0 0 0 18.306.5a10.079 10.079 0 0 0-9.614 6.977 9.967 9.967 0 0 0-6.664 4.834 10.08 10.08 0 0 0 1.24 11.817 9.965 9.965 0 0 0 .856 8.185 10.079 10.079 0 0 0 10.855 4.835 9.965 9.965 0 0 0 7.516 3.35 10.078 10.078 0 0 0 9.617-6.981 9.967 9.967 0 0 0 6.663-4.834 10.079 10.079 0 0 0-1.243-11.813zM22.498 37.886a7.474 7.474 0 0 1-4.799-1.735l.237-.134 7.964-4.6a1.294 1.294 0 0 0 .655-1.134V19.054l3.366 1.946a.12.12 0 0 1 .066.092v9.299a7.505 7.505 0 0 1-7.49 7.495zM6.392 31.006a7.471 7.471 0 0 1-.894-5.023l.237.142 7.964 4.6a1.297 1.297 0 0 0 1.308 0l9.724-5.614v3.888a.12.12 0 0 1-.048.103l-8.051 4.649a7.504 7.504 0 0 1-10.24-2.745zM4.298 13.62a7.469 7.469 0 0 1 3.901-3.288v9.475a1.294 1.294 0 0 0 .654 1.132l9.723 5.614-3.366 1.946a.12.12 0 0 1-.114.01L7.04 23.86a7.504 7.504 0 0 1-2.743-10.24zm27.658 6.437-9.724-5.615 3.367-1.944a.12.12 0 0 1 .113-.011l8.052 4.648a7.498 7.498 0 0 1-1.158 13.528v-9.476a1.293 1.293 0 0 0-.65-1.13zm3.35-5.043-.236-.142-7.965-4.6a1.298 1.298 0 0 0-1.308 0l-9.723 5.614v-3.888a.12.12 0 0 1 .048-.103l8.05-4.645a7.497 7.497 0 0 1 11.135 7.764zm-21.063 6.929-3.367-1.945a.12.12 0 0 1-.065-.092v-9.299a7.497 7.497 0 0 1 12.293-5.756l-.236.134-7.965 4.6a1.294 1.294 0 0 0-.654 1.132zm1.829-3.943 4.33-2.501 4.332 2.5v5l-4.331 2.5-4.331-2.5z" />
  </svg>
);

const ClaudeIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M4.709 15.955l4.72-2.647.079-.23-.079-.128h-.23l-.785-.048-2.683-.073-2.324-.097-2.254-.121-.567-.121L0 11.762l.054-.352.473-.317.677.06 1.495.103 2.244.155 1.628.097 2.408.245h.382l.054-.155-.13-.094-.1-.094-2.292-1.554-2.482-1.642-1.302-.943-.704-.481-.353-.447-.155-.989.644-.708.864.06.219.06.881.677 1.882 1.456 2.46 1.81.36.301.144-.103.018-.072-.166-.276-1.367-2.47-1.46-2.512-.648-1.04-.17-.622a3.045 3.045 0 0 1-.105-.74L6.354.18 6.756 0l.962.18.398.348.586 1.339.948 2.107 1.47 2.864.43.85.23.78.085.245h.146V8.58l.117-1.575.215-1.92.21-2.472.073-.692.345-.836.687-.453.535.256.443.633-.062.405-.262 1.71-.516 2.674-.336 1.795h.196l.225-.226.91-1.205 1.524-1.906.673-.755.785-.834.504-.4h.952l.701.523-.31.674-1.385 1.755-1.151 1.491-1.652 2.22-1.034 1.781.098.146h.252l3.821-.815 2.063-.374 2.45-.421.998.466.117.473-.391.971-2.354.581-2.756.55-4.105.973-.054.038.066.082 1.847.175.79.043h1.929l3.59.267.94.622.563.756-.094.572-1.442.733-1.94-.46-4.525-1.075-1.553-.388-.222.024.027.097 1.299 1.27 2.376 2.142 2.974 2.766.15.682-.382.535-.402-.059-2.603-1.96-1.004-.882-2.282-1.92h-.155v.207l.526.768 2.766 4.156.144 1.272-.197.408-.703.244-.785-.146-1.604-2.25-1.665-2.547-1.336-2.28-.169.097-.802 8.6-.379.443-.881.339-.726-.553-.391-.892.39-1.795.469-2.341.379-1.866.345-2.318.197-.766-.014-.058-.169.022-1.736 2.383-2.643 3.572-2.09 2.23-.504.2-.872-.456.083-.808.487-.715 2.91-3.706 1.756-2.288 1.131-1.323-.007-.205h-.072L4.072 18.633l-1.355.18-.583-.546.072-.892.276-.292z" />
  </svg>
);

const GeminiIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M12 0c.42 6.13 5.87 11.58 12 12-6.13.42-11.58 5.87-12 12-.42-6.13-5.87-11.58-12-12C6.13 11.58 11.58 6.13 12 0z" />
  </svg>
);

export function LLMActions({ slug }: { slug: string[] }) {
  const [copied, setCopied] = useState(false);
  const slugPath = slug.length === 0 ? '' : `/${slug.join('/')}`;
  // The /raw/ route family is split: empty-slug → /raw/index (static
  // handler), deep slugs → /raw/<slug>/... (catch-all). The empty-slug
  // case can't live at /raw alone because Next.js static export
  // collides `out/raw` (file) with `out/raw/` (directory of deep
  // matches). See packages/docs/app/raw/index/route.ts for the full
  // EISDIR explanation.
  const rawUrl = slug.length === 0 ? '/raw/index' : `/raw${slugPath}`;
  const docUrl = `${SITE_URL}/docs${slugPath}`;

  async function copy() {
    try {
      const res = await fetch(rawUrl);
      const text = await res.text();
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="not-prose mb-5 flex items-center justify-end gap-2">
      <button
        type="button"
        onClick={copy}
        className="inline-flex items-center gap-1.5 rounded-md border border-fd-border bg-fd-card px-2.5 py-1.5 text-sm font-medium text-fd-foreground transition-colors hover:bg-fd-accent hover:text-fd-accent-foreground"
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
        {copied ? 'Copied!' : 'Copy as Markdown'}
      </button>

      <details className="relative">
        <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-md border border-fd-border bg-fd-card px-2.5 py-1.5 text-sm text-fd-foreground transition-colors hover:bg-fd-accent hover:text-fd-accent-foreground [&::-webkit-details-marker]:hidden">
          Open in
          <svg
            width="11"
            height="11"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </summary>
        <div className="absolute right-0 z-50 mt-1 min-w-[160px] overflow-hidden rounded-md border border-fd-border bg-fd-popover text-fd-popover-foreground shadow-lg">
          <a
            href={buildProviderUrl('chatgpt', docUrl)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-fd-accent hover:text-fd-accent-foreground"
          >
            <ChatGPTIcon />
            ChatGPT
          </a>
          <a
            href={buildProviderUrl('claude', docUrl)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-fd-accent hover:text-fd-accent-foreground"
          >
            <ClaudeIcon />
            Claude
          </a>
          <a
            href={buildProviderUrl('gemini', docUrl)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-fd-accent hover:text-fd-accent-foreground"
          >
            <GeminiIcon />
            Gemini
          </a>
        </div>
      </details>
    </div>
  );
}
