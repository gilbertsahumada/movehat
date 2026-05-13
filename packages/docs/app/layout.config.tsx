import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';

export const baseOptions: BaseLayoutProps = {
  nav: {
    title: (
      <>
        <img
          src="/movehat.png"
          alt=""
          width={24}
          height={24}
          style={{ borderRadius: 4 }}
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
