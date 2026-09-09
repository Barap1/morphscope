# ADR 0015: Public snapshot with authenticated workspace control plane

## Status

Accepted for Checkpoint 16.

## Decision

The public hosted web build uses the committed sanitized published snapshot in
`apps/web/src/lib/published-data.json` when local `.morphscope` evidence is unavailable. Vercel
deployments force that published-evidence path through the `VERCEL` runtime marker; a local
developer continues to read local persisted run and experiment artifacts.

The hosted application also exposes a deliberately narrow authenticated workspace control plane.
It stores validated task, experiment, and run metadata in Postgres behind a signed, single-workspace
password session. It does not execute agents, call providers, import traces, mutate repositories,
or expose arbitrary commands. Public pages remain useful without authentication and continue to
show only the sanitized snapshot; workspace records are private and are not merged into public
evidence until an explicit reviewed publication changes the snapshot.

`vercel.json` pins the repository install and web build commands without embedding deployment
credentials. Vercel project settings should set the project root to `apps/web` or use the repository
root with the documented monorepo build command; any deployment token remains a CI secret and is
never placed in the application environment.

The published snapshot is generated from a real offline fixture run and includes only sanitized run,
trace, evaluation, and patch evidence. It contains no provider response body, credential, or task
execution capability. Hosted pages remain dynamically rendered read-only views over that snapshot.

## Consequences

- A public deployment is useful immediately and cannot execute a task repository.
- A configured owner can manage durable metadata without making the public evidence store writable.
- Local development keeps its live artifact workflow without making local files public.
- Updating public evidence requires a reviewed snapshot change and a normal build/deploy.
- Hosted CRUD requires `DATABASE_URL`, `MORPHSCOPE_SESSION_SECRET`, and
  `MORPHSCOPE_WORKSPACE_PASSWORD_HASH`; without them, the app degrades to public snapshot mode.
