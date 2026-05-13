'use client';

import { useState } from 'react';

const SITE_URL = 'https://movehat.dev';

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

export function LLMActions({ slug }: { slug: string[] }) {
  const [copied, setCopied] = useState(false);
  const slugPath = slug.length === 0 ? '' : `/${slug.join('/')}`;
  const rawUrl = `/docs${slugPath}/raw`;
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
    <div className="not-prose mb-6 flex items-center gap-2">
      <button
        type="button"
        onClick={copy}
        className="inline-flex items-center gap-2 rounded-md border border-fd-border bg-fd-card px-3 py-1.5 text-sm font-medium text-fd-foreground transition-colors hover:bg-fd-accent hover:text-fd-accent-foreground"
      >
        <svg
          width="14"
          height="14"
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
        <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-md border border-fd-border bg-fd-card px-2 py-1.5 text-sm text-fd-foreground transition-colors hover:bg-fd-accent hover:text-fd-accent-foreground [&::-webkit-details-marker]:hidden">
          Open in
          <svg
            width="12"
            height="12"
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
            className="block px-3 py-2 text-sm hover:bg-fd-accent hover:text-fd-accent-foreground"
          >
            ChatGPT
          </a>
          <a
            href={buildProviderUrl('claude', docUrl)}
            target="_blank"
            rel="noopener noreferrer"
            className="block px-3 py-2 text-sm hover:bg-fd-accent hover:text-fd-accent-foreground"
          >
            Claude
          </a>
          <a
            href={buildProviderUrl('gemini', docUrl)}
            target="_blank"
            rel="noopener noreferrer"
            className="block px-3 py-2 text-sm hover:bg-fd-accent hover:text-fd-accent-foreground"
          >
            Gemini
          </a>
        </div>
      </details>
    </div>
  );
}
