"use client";

import { Moon, Sun } from "@phosphor-icons/react";
import { useEffect, useState } from "react";

type Theme = "dark" | "light";
const storageKey = "morphscope-theme";

function getStoredTheme(): Theme {
  try {
    const value = window.localStorage.getItem(storageKey);
    if (value === "light" || value === "dark") return value;
  } catch {
    // Local storage can be unavailable in privacy-restricted browsers.
  }

  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const storedTheme = getStoredTheme();
      setTheme(storedTheme);
      document.documentElement.dataset.theme = storedTheme;
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  function toggleTheme() {
    const nextTheme: Theme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    document.documentElement.dataset.theme = nextTheme;

    try {
      window.localStorage.setItem(storageKey, nextTheme);
    } catch {
      // The visual preference still applies for this session.
    }
  }

  const nextLabel = theme === "dark" ? "Switch to light theme" : "Switch to dark theme";

  return (
    <button
      className="icon-button"
      type="button"
      onClick={toggleTheme}
      aria-label={nextLabel}
      title={nextLabel}
    >
      {theme === "dark" ? (
        <Sun size={17} weight="bold" aria-hidden />
      ) : (
        <Moon size={17} weight="bold" aria-hidden />
      )}
    </button>
  );
}
