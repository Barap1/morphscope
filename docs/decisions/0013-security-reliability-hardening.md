# ADR 0013: Security and reliability hardening

## Status

Accepted for Checkpoint 14.

## Decision

The local sandbox treats task repositories and model output as untrusted at every file and command
boundary. Workspace paths are canonicalized and checked against the workspace root, patch paths are
validated before `git apply`, symlink reads are rejected when they resolve outside the workspace,
child environments are rebuilt from a small allowlist, command output is bounded, and command
timeouts are persisted as evidence rather than hidden.

Content-addressed artifact reads and the web data loader reject symlink-backed files and enforce
repository containment. Provider/spike errors and persisted command output pass through the existing
redaction boundary, and the adversarial fixture verifies credential-free task execution, hostile text
capture, output truncation, timeouts, path rejection, and symlink containment.

This is intentionally a local developer-mode boundary. It does not claim kernel-level filesystem,
network, memory, or disk isolation for arbitrary code executed by an allowlisted interpreter. A
future hosted runner must add an OS/container policy with explicit network, process, memory, and disk
limits; it must not mount the host Docker socket or expose orchestration credentials.

## Consequences

- The common accidental escape and persistence paths fail closed before mutation or rendering.
- Adversarial behavior remains visible in traces and failed runs instead of being discarded.
- The remaining process-boundary limitation is explicit and prevents local mode from being mistaken
  for a multi-tenant execution service.
