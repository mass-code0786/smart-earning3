import './globals.css';
import './dashboard.css';
import type { Metadata } from 'next';
import { WalletSessionBoundary } from '@/components/wallet-session-boundary';

export const metadata: Metadata = {
  title: 'Smart Earning — BNB Testnet',
  description: 'Smart Earning registration and Magic Level system on BNB Smart Chain Testnet',
  icons: { icon: '/logo.png', shortcut: '/logo.png', apple: '/logo.png' },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body><WalletSessionBoundary/>{children}</body></html>;
}
