import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { ReactNode } from "react";
import { AppShell } from "../components/app-shell";
import { isPublishedDashboard, loadDashboardData } from "../lib/data";
import { hasWorkspaceSession, workspaceAuthConfigured } from "../lib/workspace-auth";
import "./globals.css";

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ||
  (process.env.VERCEL_ENV === "production"
    ? "https://morphscope.vercel.app"
    : process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000");

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "MorphScope",
    template: "%s | MorphScope",
  },
  description: "A trace-first workspace for understanding coding-agent experiments.",
  applicationName: "MorphScope",
  referrer: "origin-when-cross-origin",
  keywords: ["coding agents", "evaluation", "traces", "observability"],
  openGraph: {
    type: "website",
    siteName: "MorphScope",
    title: "MorphScope | See the work between the prompt and the patch.",
    description: "A trace-first workspace for understanding coding-agent experiments.",
    images: [
      {
        url: "/brand/morphscope-optic.png",
        width: 1857,
        height: 847,
        alt: "An optic instrument with an ember trace line on a dark field.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "MorphScope | See the work between the prompt and the patch.",
    description: "A trace-first workspace for understanding coding-agent experiments.",
    images: ["/brand/morphscope-optic.png"],
  },
};

export const viewport: Viewport = {
  themeColor: "#111310",
  colorScheme: "dark light",
  width: "device-width",
  initialScale: 1,
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const { runs } = loadDashboardData();
  const latestRun = runs[0];
  const hosted = isPublishedDashboard();
  const workspaceAccess = workspaceAuthConfigured()
    ? (await hasWorkspaceSession())
      ? "signed-in"
      : "signed-out"
    : "unavailable";

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
          hosted={hosted}
          workspaceAccess={workspaceAccess}
          workspaceStatus={
            latestRun
              ? {
                  label: hosted ? "Published snapshot" : "Latest run",
                  detail: hosted
                    ? `${workspaceAccess === "signed-in" ? "editable workspace" : "public snapshot"} · ${latestRun.run.id.slice(0, 8)}`
                    : `${latestRun.run.terminalState} · ${latestRun.run.id.slice(0, 8)}`,
                }
              : hosted
                ? {
                    label: "Published snapshot",
                    detail:
                      workspaceAccess === "signed-in"
                        ? "workspace access enabled"
                        : "public evidence",
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
