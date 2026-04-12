import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { PrivacyFooter } from "@/components/privacy-footer";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "HO3",
  description: "Personal, Business & Nonprofit Money App",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased dark`}>
      <body className="min-h-full flex flex-col bg-background text-foreground font-sans">
        <div className="flex-1 flex flex-col">{children}</div>
        <PrivacyFooter />
      </body>
    </html>
  );
}
