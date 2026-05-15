'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

interface CopyButtonProps {
  text: string;
  className?: string;
  label?: string;
}

export function CopyButton({ text, className, label = 'Copy to clipboard' }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Older browsers / non-https contexts. Silent fail — user can still select+copy.
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={label}
      className={
        className ??
        'inline-flex items-center justify-center rounded-md p-1.5 text-fd-muted-foreground transition-colors hover:bg-fd-accent hover:text-fd-foreground'
      }
    >
      {copied ? <Check className="size-3.5 text-green-500" /> : <Copy className="size-3.5" />}
    </button>
  );
}
