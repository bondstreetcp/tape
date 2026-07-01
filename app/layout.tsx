import "./globals.css";
import type { Metadata, Viewport } from "next";
import ThemeManager from "@/components/ThemeManager";

export const metadata: Metadata = {
  title: "Tape — Equity Research",
  description:
    "Multi-universe equity research: charts, screening, financials, estimates, ownership, filings, options, macro, and news across US and international indices.",
  applicationName: "Tape",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Tape", statusBarStyle: "black-translucent" },
  icons: {
    icon: [
      { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon.svg", type: "image/svg+xml" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0b0e14",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Belt-and-suspenders for older iOS full-screen home-screen apps (Next emits mobile-web-app-capable). */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(localStorage.getItem('theme')==='light')document.documentElement.classList.add('light')}catch(e){}`,
          }}
        />
      </head>
      <body className="min-h-screen">
        <ThemeManager />
        {children}
      </body>
    </html>
  );
}
