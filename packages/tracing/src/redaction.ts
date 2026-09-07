const REDACTED = "[REDACTED]";

export type RedactionResult = {
  value: string;
  redacted: boolean;
};

const sensitiveKeyPattern =
  /(api[-_]?key|access[-_]?token|auth|authorization|credential|password|private[-_]?key|secret|token)/i;
const secretValuePatterns = [
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\b(?:morph|ms)_[A-Za-z0-9_-]{20,}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/-]{12,}/gi,
  /\b(?:MORPH_API_KEY|OPENAI_API_KEY|GITHUB_TOKEN|AWS_SECRET_ACCESS_KEY)\s*=\s*[^\s,;]+/g,
];

export function redactText(input: string): RedactionResult {
  let value = input;
  let redacted = false;

  for (const pattern of secretValuePatterns) {
    const nextValue = value.replace(pattern, (match) => {
      redacted = true;
      const keyPrefix = match.includes("=") ? match.slice(0, match.indexOf("=") + 1) : "";
      return `${keyPrefix}${REDACTED}`;
    });
    value = nextValue;
  }

  return { value, redacted };
}

export function redactSecrets<T>(input: T): T {
  if (typeof input === "string") return redactText(input).value as T;
  if (Array.isArray(input)) {
    return input.map((item) => redactSecrets(item)) as T;
  }
  if (!isRecord(input)) return input;

  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    output[key] = sensitiveKeyPattern.test(key) ? REDACTED : redactSecrets(value);
  }
  return output as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
