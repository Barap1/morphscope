import { describe, expect, it } from "vitest";
import {
  createPasswordHash,
  createSessionToken,
  verifyPassword,
  verifySessionToken,
} from "./workspace-auth-core";

describe("workspace authentication primitives", () => {
  it("verifies scrypt password hashes without accepting another password", () => {
    const encoded = createPasswordHash("correct horse battery staple");
    expect(verifyPassword("correct horse battery staple", encoded)).toBe(true);
    expect(verifyPassword("wrong password", encoded)).toBe(false);
  });

  it("rejects tampered and expired signed sessions", () => {
    const now = Date.parse("2026-09-08T12:00:00.000Z");
    const token = createSessionToken("test-session-secret", now);
    expect(verifySessionToken(token, "test-session-secret", now)).toBe(true);
    expect(verifySessionToken(`${token}tampered`, "test-session-secret", now)).toBe(false);
    expect(verifySessionToken(token, "test-session-secret", now + 8 * 24 * 60 * 60 * 1_000)).toBe(
      false,
    );
  });
});
