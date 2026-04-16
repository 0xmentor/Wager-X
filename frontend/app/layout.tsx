import "./globals.css";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Wager X",
  description: "Wager X - Solana betting and mini-game arcade",
  icons: {
    icon: "/brand/wagerx-logo.png"
  }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <Link href="/" className="brand">
            <Image src="/brand/wagerx-logo.png" alt="Wager X" width={48} height={48} className="brand-logo" />
            <span className="brand-text">WAGER X</span>
          </Link>
          <nav className="site-nav">
            <Link href="/" className="nav-link">Dashboard</Link>
            <Link href="/login" className="nav-link">Sign in</Link>
          </nav>
        </header>
        {children}
        <footer className="site-footer">made by marshall and 0xmentor 2026</footer>
      </body>
    </html>
  );
}
