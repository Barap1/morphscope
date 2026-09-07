import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { ReactNode } from "react";
import { AppShell } from "../components/app-shell";
import { loadDashboardData } from "../lib/data";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "MorphScope",
    template: "%s | MorphScope",
  },
  description: "A trace-first workspace for understanding coding-agent experiments.",
  applicationName: "MorphScope",
  referrer: "origin-when-cross-origin",
  keywords: ["coding agents", "evaluation", "traces", "observability"],
};

export const viewport: Viewport = {
  themeColor: "#111310",
  colorScheme: "dark light",
  width: "device-width",
  initialScale: 1,
};

export const dynamic = "force-dynamic";

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const { runs } = loadDashboardData();
  const latestRun = runs[0];

  return (
    <html
      lang="en"
      className={`${GeistSans.className} ${GeistMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <Script id="morphscope-theme" strategy="beforeInteractive">
          {`try{const root=document.documentElement;root.classList.add("theme-initializing");const saved=localStorage.getItem("morphscope-theme");const theme=saved==="light"||saved==="dark"?saved:matchMedia("(prefers-color-scheme: light)").matches?"light":"dark";root.dataset.theme=theme;requestAnimationFrame(()=>root.classList.remove("theme-initializing"))}catch{}`}
        </Script>
      </head>
      <body>
        <AppShell
          workspaceStatus={
            latestRun
              ? {
                  label: "Latest run",
                  detail: `${latestRun.run.terminalState} · ${latestRun.run.id.slice(0, 8)}`,
                }
              : { label: "No persisted run", detail: "Trace store empty" }
          }
        >
          {children}
        </AppShell>
      </body>
    </html>
  );
}
