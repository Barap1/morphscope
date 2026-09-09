"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function SignOutButton() {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    setSigningOut(true);
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    router.push("/");
  }

  return (
    <button
      className="ui-button ui-button-quiet ui-button-sm"
      type="button"
      onClick={signOut}
      disabled={signingOut}
    >
      {signingOut ? "Signing out…" : "Sign out"}
    </button>
  );
}
