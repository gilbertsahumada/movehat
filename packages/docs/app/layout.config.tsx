import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';

export const baseOptions: BaseLayoutProps = {
  nav: {
    title: 'Movehat',
  },
  links: [
    {
      text: 'Docs',
      url: '/docs',
      active: 'nested-url',
    },
    {
      text: 'GitHub',
      url: 'https://github.com/gilbertsahumada/movehat',
      external: true,
    },
    {
      text: 'NPM',
      url: 'https://www.npmjs.com/package/movehat',
      external: true,
    },
  ],
};
