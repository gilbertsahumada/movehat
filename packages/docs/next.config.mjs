import { createMDX } from 'fumadocs-mdx/next';

// Set MOVEHAT_DOCS_BASE_PATH=/movehat when building for GitHub Pages
// (the published URL is gilbertsahumada.github.io/movehat/, so all
// internal links + asset URLs need the /movehat prefix). Local
// `pnpm dev:docs` and unsuffixed `pnpm build:docs` leave it empty so
// preview / Vercel / Netlify hosts keep working unchanged.
const basePath = process.env.MOVEHAT_DOCS_BASE_PATH ?? '';

/** @type {import('next').NextConfig} */
const config = {
  output: 'export',
  images: {
    unoptimized: true,
  },
  basePath,
  assetPrefix: basePath || undefined,
};

const withMDX = createMDX();

export default withMDX(config);
