import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Koito Celebration',
  description: 'Official Koito Event & High-Level Gala Dinner',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className="bg-[#060e08] text-white min-h-screen antialiased"
        suppressHydrationWarning
      >
        {children}
      </body>
    </html>
  );
}
