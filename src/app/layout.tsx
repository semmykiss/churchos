import type { Metadata } from "next";
import { Inter, Sora, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const sora = Sora({
  variable: "--font-sora",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Grace ChMS — Church Management",
  description: "People, groups, check-in, giving, volunteers, care and reporting in one system. Local build with SQLite.",
  keywords: ["church management", "ChMS", "check-in", "giving", "volunteers"],
};

/**
 * Applied before first paint (blocking, inside <body> top) so the correct
 * theme renders with zero flash-of-wrong-theme. Reads churchos-theme from
 * localStorage; falls back to prefers-color-scheme on first visit. Dark
 * themes also toggle the `.dark` class for legacy `dark:` utilities.
 */
const themeNoFlashScript = `
(function(){try{
  var t = localStorage.getItem("churchos-theme");
  if (t !== "system" && t !== "sanctuary-light" && t !== "midnight" && t !== "harvest" && t !== "contrast") {
    t = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "midnight" : "sanctuary-light";
  }
  var el = document.documentElement;
  el.setAttribute("data-theme", t);
  if (t === "midnight" || t === "contrast") el.classList.add("dark");
  el.style.colorScheme = (t === "midnight" || t === "contrast") ? "dark" : "light";
}catch(e){}})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning data-theme="sanctuary-light">
      <body
        className={`${inter.variable} ${sora.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <script dangerouslySetInnerHTML={{ __html: themeNoFlashScript }} />
        {children}
        <Toaster />
      </body>
    </html>
  );
}
