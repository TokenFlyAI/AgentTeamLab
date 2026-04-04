import type { Metadata } from 'next';
import './globals.css';
import { Sidebar } from '@/components/layout/Sidebar';
import { Header } from '@/components/layout/Header';

export const metadata: Metadata = {
  title: 'Kalshi Trading Dashboard',
  description: 'Real-time prediction market trading',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background">
        <Sidebar />
        <div className="pl-16 lg:pl-64">
          <Header />
          <main className="p-4 lg:p-6">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
