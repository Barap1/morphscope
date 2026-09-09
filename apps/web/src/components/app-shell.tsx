"use client";

import {
  ArrowUpRight,
  CaretDown,
  Command,
  Flask,
  GearSix,
  List,
  Scales,
  Warning,
  X,
} from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  navigationItems,
  getBreadcrumb,
  isNavigationItemActive,
  type NavigationIcon,
} from "../lib/navigation";
import { BrandLockup, MorphMark } from "./brand-mark";
import { CommandMenu } from "./command-menu";
import { SignOutButton } from "./sign-out-button";
import { ThemeToggle } from "./theme-toggle";

function NavigationGlyph({ icon }: { icon: NavigationIcon }) {
  const props = { size: 17, weight: "regular" as const, "aria-hidden": true };

  switch (icon) {
    case "overview":
      return <Command {...props} />;
    case "experiments":
      return <Flask {...props} />;
    case "compare":
      return <Scales {...props} />;
    case "failures":
      return <Warning {...props} />;
    case "settings":
      return <GearSix {...props} />;
  }
}

export function AppShell({
  children,
  hosted,
  workspaceStatus,
  workspaceAccess,
}: {
  children: ReactNode;
  hosted: boolean;
  workspaceStatus: { label: string; detail: string };
  workspaceAccess: "unavailable" | "signed-out" | "signed-in";
}) {
  const pathname = usePathname() ?? "/";
  const [mobileOpen, setMobileOpen] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);
  const mobileMenuRef = useRef<HTMLButtonElement>(null);
  const mobileCloseRef = useRef<HTMLButtonElement>(null);
  const breadcrumbs = getBreadcrumb(pathname);

  useEffect(() => {
    document.body.dataset.navOpen = mobileOpen ? "true" : "false";

    const focusTimer = mobileOpen
      ? window.setTimeout(() => mobileCloseRef.current?.focus(), 0)
      : undefined;

    function handleEscape(event: KeyboardEvent) {
      if (event.key !== "Escape" || !mobileOpen) return;
      setMobileOpen(false);
      window.requestAnimationFrame(() => mobileMenuRef.current?.focus());
    }

    function containFocus(event: KeyboardEvent) {
      if (event.key !== "Tab" || !mobileOpen || !sidebarRef.current) return;

      const focusable = Array.from(
        sidebarRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      const first = focusable[0];
      const last = focusable.at(-1);

      if (!first || !last) return;

      if (!sidebarRef.current.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    const desktopQuery = window.matchMedia("(min-width: 981px)");
    function closeOnDesktopResize(event: MediaQueryListEvent) {
      if (event.matches) setMobileOpen(false);
    }

    document.addEventListener("keydown", handleEscape);
    document.addEventListener("keydown", containFocus);
    desktopQuery.addEventListener("change", closeOnDesktopResize);

    return () => {
      if (focusTimer) window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", handleEscape);
      document.removeEventListener("keydown", containFocus);
      desktopQuery.removeEventListener("change", closeOnDesktopResize);
      delete document.body.dataset.navOpen;
    };
  }, [mobileOpen]);

  return (
    <div className="app-frame">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>

      <aside
        id="primary-navigation"
        ref={sidebarRef}
        className={mobileOpen ? "sidebar is-open" : "sidebar"}
        aria-label="Primary navigation"
      >
        <div className="sidebar-inner">
          <div className="sidebar-brand-row">
            <BrandLockup />
            <button
              ref={mobileCloseRef}
              className="mobile-close-button"
              type="button"
              onClick={() => {
                setMobileOpen(false);
                window.requestAnimationFrame(() => mobileMenuRef.current?.focus());
              }}
              aria-label="Close navigation"
            >
              <X size={18} weight="bold" aria-hidden />
            </button>
          </div>

          <div className="sidebar-context" role="group" aria-label="Current workspace">
            <span className="sidebar-context-mark">
              <MorphMark compact />
            </span>
            <span className="sidebar-context-copy">
              <span className="sidebar-context-label">Workspace</span>
              <span className="sidebar-context-value">
                {hosted
                  ? workspaceAccess === "signed-in"
                    ? "Hosted / editable"
                    : "Hosted / snapshot"
                  : "Local / default"}
              </span>
            </span>
            <CaretDown size={14} weight="bold" aria-hidden />
          </div>

          <nav className="primary-nav">
            <p className="nav-section-label">Observe</p>
            <div className="nav-list">
              {navigationItems.slice(0, 2).map((item) => (
                <NavItem
                  key={item.href}
                  item={item}
                  active={isNavigationItemActive(pathname, item.href)}
                  onNavigate={() => setMobileOpen(false)}
                />
              ))}
            </div>

            <p className="nav-section-label nav-section-label-spaced">Analyze</p>
            <div className="nav-list">
              {navigationItems.slice(2, 4).map((item) => (
                <NavItem
                  key={item.href}
                  item={item}
                  active={isNavigationItemActive(pathname, item.href)}
                  onNavigate={() => setMobileOpen(false)}
                />
              ))}
            </div>

            <p className="nav-section-label nav-section-label-spaced">Configure</p>
            <div className="nav-list">
              {navigationItems.slice(4).map((item) => (
                <NavItem
                  key={item.href}
                  item={item}
                  active={isNavigationItemActive(pathname, item.href)}
                  onNavigate={() => setMobileOpen(false)}
                />
              ))}
            </div>
          </nav>

          <div className="sidebar-footer">
            <div className="sidebar-trace-status">
              <span className="trace-status-dot" aria-hidden />
              <span>
                <strong>{workspaceStatus.label}</strong>
                <small>{workspaceStatus.detail}</small>
              </span>
            </div>
            <div className="sidebar-footer-meta">
              <span>{hosted ? "HOSTED SNAPSHOT" : "LOCAL WORKSPACE"}</span>
              <span className="sidebar-footer-rule" aria-hidden />
              <span>v0.0</span>
            </div>
          </div>
        </div>
        <div className="sidebar-trace-rail" aria-hidden="true">
          <span className="trace-rail-line" />
          <span className="trace-rail-tick trace-rail-tick-one" />
          <span className="trace-rail-tick trace-rail-tick-two" />
          <span className="trace-rail-tick trace-rail-tick-three" />
          <span className="trace-rail-node" />
        </div>
      </aside>

      {mobileOpen ? (
        <button
          className="mobile-scrim"
          type="button"
          tabIndex={-1}
          onClick={() => {
            setMobileOpen(false);
            window.requestAnimationFrame(() => mobileMenuRef.current?.focus());
          }}
          aria-label="Close navigation"
        />
      ) : null}

      <div className="main-shell">
        <header className="global-header">
          <div className="header-leading">
            <button
              ref={mobileMenuRef}
              className="mobile-menu-button"
              type="button"
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation"
              aria-expanded={mobileOpen}
              aria-controls="primary-navigation"
            >
              <List size={20} weight="bold" aria-hidden />
            </button>
            <nav className="header-breadcrumbs" aria-label="Breadcrumb">
              {breadcrumbs.map((crumb, index) => (
                <span className="breadcrumb-item" key={`${crumb}-${index}`}>
                  {index > 0 ? (
                    <span className="breadcrumb-separator" aria-hidden>
                      /
                    </span>
                  ) : null}
                  <span
                    className={
                      index === breadcrumbs.length - 1 ? "breadcrumb-current" : "breadcrumb-muted"
                    }
                  >
                    {crumb}
                  </span>
                </span>
              ))}
            </nav>
          </div>
          <div className="header-actions">
            <CommandMenu onOpen={() => setMobileOpen(false)} />
            <span className="header-divider" aria-hidden />
            <ThemeToggle />
            {workspaceAccess === "signed-in" ? (
              <SignOutButton />
            ) : workspaceAccess === "signed-out" ? (
              <Link className="ui-button ui-button-quiet ui-button-sm" href="/login">
                Sign in to edit
              </Link>
            ) : null}
            <div
              className="header-identity"
              role="group"
              aria-label={hosted ? "Hosted published snapshot" : "Local workspace identity"}
            >
              <span className="header-identity-mark">MS</span>
              <span className="header-identity-copy">
                <strong>{hosted ? "Hosted" : "Local"}</strong>
                <small>{hosted ? "snapshot" : "workspace"}</small>
              </span>
            </div>
          </div>
        </header>

        <main id="main-content" className="main-content" tabIndex={-1}>
          {children}
        </main>

        <footer className="global-footer">
          <span>
            <MorphMark compact />
            {hosted
              ? workspaceAccess === "signed-in"
                ? " MorphScope / authenticated workspace"
                : " MorphScope / public evidence snapshot"
              : " MorphScope / local evaluation workspace"}
          </span>
          <span className="footer-capability">
            <ArrowUpRight size={13} weight="bold" aria-hidden /> Trace-first instrumentation
          </span>
        </footer>
      </div>
    </div>
  );
}

function NavItem({
  item,
  active,
  onNavigate,
}: {
  item: (typeof navigationItems)[number];
  active: boolean;
  onNavigate: () => void;
}) {
  return (
    <Link
      className={active ? "nav-item is-active" : "nav-item"}
      href={item.href}
      aria-current={active ? "page" : undefined}
      onClick={onNavigate}
    >
      <span className="nav-item-icon">
        <NavigationGlyph icon={item.icon} />
      </span>
      <span className="nav-item-label">{item.label}</span>
      {active ? <span className="nav-item-indicator" aria-hidden /> : null}
    </Link>
  );
}
