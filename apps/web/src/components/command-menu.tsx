"use client";

import {
  ArrowRight,
  Command,
  Flask,
  GearSix,
  MagnifyingGlass,
  Scales,
  Warning,
  X,
} from "@phosphor-icons/react";
import { usePathname, useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { navigationItems, type NavigationIcon } from "../lib/navigation";
import { Kbd } from "./kbd";

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

export function CommandMenu({ onOpen }: { onOpen?: () => void }) {
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    if (!normalizedQuery) return navigationItems;

    return navigationItems.filter((item) =>
      `${item.label} ${item.description}`.toLowerCase().includes(normalizedQuery),
    );
  }, [query]);

  const resolvedActiveIndex = Math.min(activeIndex, Math.max(filteredItems.length - 1, 0));

  const openMenu = useCallback(() => {
    onOpen?.();
    setQuery("");
    setActiveIndex(0);
    setOpen(true);
  }, [onOpen]);

  const closeMenu = useCallback(() => {
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (open) closeMenu();
        else openMenu();
      }

      if (event.key === "Escape" && open) {
        closeMenu();
      }
    }

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [closeMenu, open, openMenu]);

  useEffect(() => {
    if (!open) return;

    const focusTimer = window.setTimeout(() => inputRef.current?.focus(), 0);

    function containFocus(event: KeyboardEvent) {
      if (event.key !== "Tab" || !dialogRef.current) return;

      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      const first = focusable[0];
      const last = focusable.at(-1);

      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", containFocus);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", containFocus);
    };
  }, [open]);

  function navigate(href: string) {
    closeMenu();
    router.push(href);
  }

  function handleInputKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) =>
        filteredItems.length ? (current + 1) % filteredItems.length : 0,
      );
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) =>
        filteredItems.length ? (current - 1 + filteredItems.length) % filteredItems.length : 0,
      );
    }

    if (event.key === "Enter" && filteredItems[resolvedActiveIndex]) {
      event.preventDefault();
      navigate(filteredItems[resolvedActiveIndex].href);
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        className="command-trigger"
        type="button"
        onClick={openMenu}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Open command menu"
      >
        <MagnifyingGlass size={16} weight="bold" aria-hidden />
        <span className="command-trigger-text">Search workspace</span>
        <Kbd>⌘K</Kbd>
      </button>

      {open ? (
        <div className="command-backdrop" role="presentation" onMouseDown={closeMenu}>
          <div
            ref={dialogRef}
            className="command-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="command-dialog-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="command-dialog-header">
              <MagnifyingGlass size={19} weight="bold" aria-hidden />
              <label className="sr-only" htmlFor="command-search">
                Search workspace
              </label>
              <input
                ref={inputRef}
                id="command-search"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActiveIndex(0);
                }}
                onKeyDown={handleInputKeyDown}
                role="combobox"
                aria-autocomplete="list"
                aria-controls="command-results"
                aria-expanded="true"
                aria-activedescendant={
                  filteredItems.length ? `command-option-${resolvedActiveIndex}` : undefined
                }
                placeholder="Search views and workspace actions…"
                autoComplete="off"
                spellCheck={false}
              />
              <button
                className="command-close"
                type="button"
                onClick={closeMenu}
                aria-label="Close command menu"
              >
                <X size={17} weight="bold" aria-hidden />
              </button>
            </div>
            <div className="command-dialog-meta">
              <span id="command-dialog-title">Navigate</span>
              <span className="command-dialog-hint">
                <Kbd>↑</Kbd>
                <Kbd>↓</Kbd> to move <Kbd>Enter</Kbd> to open
              </span>
            </div>
            <div
              id="command-results"
              className="command-list"
              role="listbox"
              aria-label="Workspace views"
            >
              {filteredItems.length ? (
                filteredItems.map((item, index) => {
                  const selected = index === resolvedActiveIndex;
                  const current = pathname === item.href;

                  return (
                    <button
                      className={selected ? "command-item is-selected" : "command-item"}
                      type="button"
                      key={item.href}
                      id={`command-option-${index}`}
                      role="option"
                      aria-selected={selected}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => navigate(item.href)}
                    >
                      <span className="command-item-icon">
                        <NavigationGlyph icon={item.icon} />
                      </span>
                      <span className="command-item-copy">
                        <span>{item.label}</span>
                        <small>{item.description}</small>
                      </span>
                      {current ? (
                        <span className="command-current">Current</span>
                      ) : (
                        <ArrowRight size={16} weight="bold" aria-hidden />
                      )}
                    </button>
                  );
                })
              ) : (
                <div className="command-empty">No workspace views match “{query}”.</div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
