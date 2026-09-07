# ADR 0015: Read-only hosted dashboard

## Status

Accepted for Checkpoint 16.

## Decision

The hosted web build uses the committed sanitized published snapshot in
`apps/web/src/lib/published-data.json` when local `.morphscope` evidence is unavailable. Vercel
deployments force that published-only path through the `VERCEL` runtime marker; a local developer
continues to read local persisted run and experiment artifacts. The web application has no runner,
provider, mutation, trace-import, or arbitrary-command route.

`vercel.json` pins the repository install and web build commands without embedding deployment
credentials. Vercel project settings should set the project root to `apps/web` or use the repository
root with the documented monorepo build command; any deployment token remains a CI secret and is
never placed in the application environment.

The published snapshot is generated from a real offline fixture run and includes only sanitized run,
trace, evaluation, and patch evidence. It contains no provider response body, credential, or task
execution capability. Hosted pages remain dynamically rendered read-only views over that snapshot.

## Consequences

- A public deployment is useful immediately and cannot execute a task repository.
- Local development keeps its live artifact workflow without making local files public.
- Updating public evidence requires a reviewed snapshot change and a normal build/deploy.
