import "./globals.css";
import type { Metadata } from "next";
import ThemeManager from "@/components/ThemeManager";

export const metadata: Metadata = {
  title: "Tape — Equity Research",
  description:
    "Multi-universe equity research: charts, screening, financials, estimates, ownership, filings, options, macro, and news across US and international indices.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
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
