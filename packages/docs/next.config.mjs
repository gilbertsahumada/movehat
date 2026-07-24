import { createMDX } from 'fumadocs-mdx/next';

// Custom domain (movehat.org) serves the site at root, so no basePath
// is needed in production. The env var is kept conditional in case a
// future deployment needs a sub-path (e.g. preview deploys on Vercel
// under /docs/preview). Leave it unset for the default root-serving
// behavior.
const basePath = process.env.MOVEHAT_DOCS_BASE_PATH ?? '';

/** @type {import('next').NextConfig} */
const config = {
  output: 'export',
  // Next 15's legacy lint wrapper cannot consume the workspace flat config.
  // Docs sources are linted explicitly by the root `pnpm lint` quality gate.
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    unoptimized: true,
  },
  basePath,
  assetPrefix: basePath || undefined,
};

const withMDX = createMDX();

export default withMDX(config);
