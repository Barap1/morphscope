"use client";

import { Check, Copy } from "@phosphor-icons/react";
import { useState } from "react";

export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function copyValue() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button className="ui-button ui-button-quiet ui-button-sm" type="button" onClick={copyValue}>
      {copied ? (
        <Check size={13} weight="bold" aria-hidden />
      ) : (
        <Copy size={13} weight="bold" aria-hidden />
      )}
      {copied ? "Copied" : label}
    </button>
  );
}
