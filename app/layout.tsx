import "./globals.css";
import type { Metadata } from "next";
import ThemeManager from "@/components/ThemeManager";

export const metadata: Metadata = {
  title: "S&P 500 Sector Screener",
  description:
    "Track S&P 500 constituents by sector and industry, and spot 52-week highs and lows.",
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
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
