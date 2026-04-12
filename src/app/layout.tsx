import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { PrivacyFooter } from "@/components/privacy-footer";
import { ThemeProvider } from "@/components/theme-provider";
import { ServiceWorkerRegister } from "@/components/sw-register";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "HO3",
  description: "Personal, Business & Nonprofit Money App",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    title: "HO3",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: "/favicon.ico",
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#1a1a1a",
  viewportFit: "cover",
};

// Runs before React hydrates. Sets data-theme from localStorage so there's
// no flash of the wrong theme on first paint.
const themeInitScript = `(function(){try{var t=localStorage.getItem('ho3-theme');if(t!=='light'&&t!=='dark'){t='dark';}document.documentElement.setAttribute('data-theme',t);}catch(e){document.documentElement.setAttribute('data-theme','dark');}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      data-theme="dark"
      className={`${inter.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script
          dangerouslySetInnerHTML={{ __html: themeInitScript }}
        />
      </head>
      <body className="min-h-full flex flex-col bg-background text-foreground font-sans">
        <ThemeProvider>
          <div className="flex-1 flex flex-col">{children}</div>
          <ServiceWorkerRegister />
          <PrivacyFooter />
        </ThemeProvider>
      </body>
    </html>
  );
}
