// Type declaration for the JS helper exported from postprocess-typedoc.mjs.
// Lets vitest tests (in src/__tests__/) consume the helper without TS7016.
// The script body itself stays untyped JS; only the public helper is declared.

export function groupPagesByCategory(pages: readonly string[]): string[];
