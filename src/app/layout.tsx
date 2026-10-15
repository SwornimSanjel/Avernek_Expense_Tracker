import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import "./globals.css";

export const metadata: Metadata = {
  // scripts/healthcheck.sh matches this exact title after every deploy; change both together.
  title: "Avernek Finance Tracker",
  description: "Internal expense, income, and client payment tracker for Avernek Technologies.",
  icons: {
    icon: [{ url: "/avernek-mark.svg", type: "image/svg+xml" }],
    apple: "/avernek-logo.jpg",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#09090c" },
    { media: "(prefers-color-scheme: light)", color: "#f5f5f7" },
  ],
};

// Applies the saved theme and sidebar state before paint, so neither flashes.
const bootScript = `
try {
  var d = document.documentElement;
  d.dataset.theme = localStorage.getItem('avernek-theme') || 'dark';
  if (localStorage.getItem('avernek-sidebar') === 'collapsed') d.dataset.sidebar = 'collapsed';
} catch (e) {}
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" data-theme="dark" className={GeistSans.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: bootScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
