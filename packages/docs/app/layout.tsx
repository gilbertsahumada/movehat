import { RootProvider } from 'fumadocs-ui/provider/next';
import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import './global.css';

const siteUrl = 'https://movehat.dev';
const description =
  'A Hardhat-like development framework for Movement L1 and Aptos Move smart contracts. Write tests and deployment scripts in TypeScript.';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    template: '%s | Movehat',
    default: 'Movehat - Move Development Framework',
  },
  description,
  icons: {
    icon: '/movehat.png',
    apple: '/movehat.png',
  },
  openGraph: {
    title: 'Movehat - Move Development Framework',
    description,
    url: siteUrl,
    siteName: 'Movehat',
    images: [
      {
        url: '/movehat-banner.png',
        width: 560,
        height: 320,
        alt: 'Movehat',
      },
    ],
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Movehat - Move Development Framework',
    description,
    images: ['/movehat-banner.png'],
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  );
}
