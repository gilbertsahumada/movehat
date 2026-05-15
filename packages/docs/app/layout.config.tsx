import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { Package } from 'lucide-react';

const githubIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56 0-.28-.01-1.02-.02-2-3.2.7-3.87-1.54-3.87-1.54-.52-1.32-1.28-1.67-1.28-1.67-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.71 1.26 3.37.96.1-.74.4-1.26.73-1.55-2.55-.29-5.24-1.27-5.24-5.66 0-1.25.45-2.27 1.18-3.07-.12-.29-.51-1.46.11-3.04 0 0 .96-.31 3.15 1.17a10.96 10.96 0 0 1 5.74 0c2.18-1.48 3.14-1.17 3.14-1.17.62 1.58.23 2.75.11 3.04.74.8 1.18 1.82 1.18 3.07 0 4.4-2.69 5.37-5.26 5.65.41.35.77 1.05.77 2.12 0 1.53-.01 2.77-.01 3.14 0 .31.21.68.8.56C20.21 21.39 23.5 17.07 23.5 12 23.5 5.65 18.35.5 12 .5z" />
  </svg>
);

export const baseOptions: BaseLayoutProps = {
  nav: {
    title: (
      <>
        <img
          src="/movehat.png"
          alt=""
          width={32}
          height={32}
          style={{ borderRadius: 6 }}
        />
        <span>Movehat</span>
      </>
    ),
  },
  links: [
    {
      text: 'Docs',
      url: '/docs',
      active: 'nested-url',
      on: 'nav',
    },
    {
      type: 'icon',
      label: 'GitHub',
      text: 'GitHub',
      icon: githubIcon,
      url: 'https://github.com/gilbertsahumada/movehat',
      external: true,
      on: 'menu',
    },
    {
      type: 'icon',
      label: 'NPM',
      text: 'NPM',
      icon: <Package className="size-4" />,
      url: 'https://www.npmjs.com/package/movehat',
      external: true,
      on: 'menu',
    },
  ],
};
