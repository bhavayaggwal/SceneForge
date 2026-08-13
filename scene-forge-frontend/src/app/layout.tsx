import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import Navbar from '@/components/layout/Navbar';
import { ToastProvider } from '@/components/ui/Toast';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'SceneForge — Phone to 3D Scene Editor',
  description: 'Turn phone videos into photorealistic 3D scenes using advanced rendering',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.className} bg-navy text-white min-h-screen flex flex-col`}>
        <ToastProvider>
          <Navbar />
          <main className="flex-grow flex flex-col pt-20">
            {children}
          </main>
        </ToastProvider>
      </body>
    </html>
  );
}
