import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Avernek Expense Tracker",
  description: "Internal spend tracker for Avernek Technologies.",
  icons: {
    icon: "/avernek-logo.jpg",
  },
};

// Applies the saved theme before paint to avoid a flash.
const themeScript = `
try {
  var t = localStorage.getItem('avernek-theme') || 'dark';
  document.documentElement.dataset.theme = t;
} catch (e) {}
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
