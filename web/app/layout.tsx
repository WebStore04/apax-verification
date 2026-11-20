import React from "react"
import type { Metadata, Viewport } from 'next'
import { Inter, Playfair_Display, Geist_Mono } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import Script from 'next/script'
import './globals.css'
import './start'
import { HumanVerification } from '@/components/human-verification'

const _inter = Inter({
  subsets: ["latin"],
  variable: '--font-inter'
});
const _playfair = Playfair_Display({
  subsets: ["latin"],
  variable: '--font-playfair'
});
const _geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: '--font-geist-mono'
});

export const metadata: Metadata = {
  title: 'APAX - The Precious Metal Token Vault',
  description: 'The world\'s first RWA-Compliant Real World Asset (RWA) platform. Tokenized Gold, Silver, and Platinum on SidraChain.',
  generator: 'APAX',
  keywords: ['APAX', 'precious metals', 'tokenization', 'gold', 'silver', 'platinum', 'Islamic finance', 'RWA-Compliant', 'RWA', 'SidraChain'],
  authors: [{ name: 'APAX' }],
  icons: {
    icon: [
      {
        url: '/apax-logo.png',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/apax-logo.png',
        media: '(prefers-color-scheme: dark)',
      },
    ],
    apple: '/apple-icon.png',
  },
}

export const viewport: Viewport = {
  themeColor: '#D4AF37',
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className="dark">
      <body className="font-sans antialiased bg-[#0A0A0A] text-[#E8E8E8]">
        <Script id="reload-stale-chunk" strategy="beforeInteractive">
          {`(function(){function reload(){var k="apax-chunk-reload",n=Date.now(),p=0;try{p=Number(sessionStorage.getItem(k)||0)}catch(e){return}if(n-p<15000)return;try{sessionStorage.setItem(k,String(n))}catch(e){return}location.reload()}function bad(v){v=String(v||"");return v.indexOf("ChunkLoadError")!==-1||v.indexOf("Failed to load chunk")!==-1}window.addEventListener("error",function(e){var m=(e&&e.message)||(e&&e.error&&((e.error.name||"")+" "+(e.error.message||"")))||"";if(bad(m))reload()});window.addEventListener("unhandledrejection",function(e){var r=e&&e.reason;var m=(r&&r.name||"")+" "+(r&&r.message||"");if(bad(m)||bad(r))reload()})})();`}
        </Script>
        {children}
        <HumanVerification />
        <Analytics />
      </body>
    </html>
  )
}
