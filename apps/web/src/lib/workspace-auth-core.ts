import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const PASSWORD_HASH_PREFIX = "scrypt";
const SESSION_VERSION = "v1";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

export function createPasswordHash(password: string): string {
  if (!password || password.length > 256)
    throw new Error("Password must be between 1 and 256 characters");
  const cost = 16_384;
  const blockSize = 8;
  const parallelization = 1;
  const salt = randomBytes(16);
  const digest = scryptSync(password, salt, 64, {
    N: cost,
    r: blockSize,
    p: parallelization,
    maxmem: 32 * 1024 * 1024,
  });
  return [
    PASSWORD_HASH_PREFIX,
    String(cost),
    String(blockSize),
    String(parallelization),
    salt.toString("base64url"),
    digest.toString("base64url"),
  ].join("$");
}

export function verifyPassword(password: string, encoded: string): boolean {
  if (!password || password.length > 256) return false;
  const parts = encoded.split("$");
  if (parts.length !== 6 || parts[0] !== PASSWORD_HASH_PREFIX) return false;
  const cost = Number(parts[1]);
  const blockSize = Number(parts[2]);
  const parallelization = Number(parts[3]);
  if (
    !Number.isInteger(cost) ||
    cost < 8_192 ||
    cost > 65_536 ||
    !Number.isInteger(blockSize) ||
    blockSize < 1 ||
    blockSize > 32 ||
    !Number.isInteger(parallelization) ||
    parallelization < 1 ||
    parallelization > 8
  ) {
    return false;
  }
  try {
    const salt = Buffer.from(parts[4], "base64url");
    const expected = Buffer.from(parts[5], "base64url");
    if (salt.length < 16 || expected.length !== 64) return false;
    const actual = scryptSync(password, salt, expected.length, {
      N: cost,
      r: blockSize,
      p: parallelization,
      maxmem: 32 * 1024 * 1024,
    });
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function createSessionToken(secret: string, now = Date.now()): string {
  const expiresAt = Math.floor(now / 1_000) + SESSION_TTL_SECONDS;
  const payload = `${SESSION_VERSION}.${expiresAt}.${randomBytes(18).toString("base64url")}`;
  return `${payload}.${sign(payload, secret)}`;
}

export function verifySessionToken(
  token: string | undefined,
  secret: string,
  now = Date.now(),
): boolean {
  if (!token || !secret) return false;
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== SESSION_VERSION) return false;
  const expiresAt = Number(parts[1]);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Math.floor(now / 1_000)) return false;
  const payload = parts.slice(0, 3).join(".");
  const expected = sign(payload, secret);
  const actual = parts[3];
  const expectedBytes = Buffer.from(expected);
  const actualBytes = Buffer.from(actual);
  return expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes);
}

export const workspaceSessionTtlSeconds = SESSION_TTL_SECONDS;

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}
