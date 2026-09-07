# Decision 0001: web shell stack and visual system

Status: accepted for CHECKPOINT 1
Date: September 2026

## Decision

MorphScope's first web surface is a Next.js App Router application in
`apps/web`, with shared UI primitives in `packages/ui`. The shell uses React
Server Components by default. Small client islands handle the command menu,
responsive navigation state, and the persisted theme toggle.

The exact versions selected for this checkpoint are:

- Next.js `16.3.4`
- React and React DOM `19.2.8`
- Tailwind CSS and `@tailwindcss/postcss` `4.3.3`
- PostCSS `8.5.28`
- Geist `1.7.2`
- `@phosphor-icons/react` `2.1.10`
- `clsx` `2.1.1`
- `eslint-config-next` `16.3.4`
- ESLint and `@eslint/js` `9.39.5`

Tailwind v4 is loaded through the PostCSS plugin and the CSS-first `@import
"tailwindcss"` entry point. Geist is self-hosted through the `geist/font/*`
exports. The initial shell uses named CSS transitions for simple navigation and
includes reduced-motion handling. No data layer, runner, provider integration,
or fake fixture data is introduced in this checkpoint.

Next.js 16 documents flat configuration in preparation for ESLint 10, but its
bundled `eslint-plugin-react@7.37.5` crashes under ESLint `10.10.0` while loading
`react/display-name` because it still calls the removed context API. MorphScope
therefore pins the newest ESLint 9 release until that upstream plugin is
compatible. The full Next, React, React Hooks, TypeScript, and project lint rule
sets remain enabled.

The production build uses Next's supported `--webpack` switch. In the managed
macOS build environment, Turbopack's PostCSS worker panics while trying to bind
an internal IPC port (`Operation not permitted`), including outside the normal
workspace sandbox. Webpack exercises the same application routes and production
optimizations without that environment-specific worker requirement.

## Visual language

The interface is dark-first and uses a graphite canvas, mineral paper text,
steel secondary semantics, and one restrained ember-coral accent. Statuses use
distinct icon and text labels in addition to color. The custom CSS aperture
mark and persistent vertical trace rail give the shell a trace-instrument
identity without introducing a hand-drawn SVG icon set. The generated optic
asset is used only as a low-opacity home hero atmosphere.
It is rendered with `next/image` and a constrained quality allowlist so the
original source PNG is not sent directly to the browser.

## Official references

- [Next.js App Router](https://nextjs.org/docs/app)
- [Next.js Server and Client Components](https://nextjs.org/docs/app/building-your-application/rendering/server-components)
- [Tailwind CSS v4 installation](https://tailwindcss.com/docs/installation/using-postcss)
- [Geist font package](https://vercel.com/font)
- [Phosphor Icons for React](https://github.com/phosphor-icons/react)

Server Components import Phosphor's official `/ssr` entry point so icons do not
depend on the client-only React Context API. Interactive client islands use the
standard entry point.

This decision does not deviate from the product requirements or the CHECKPOINT
1 section of `docs/build-spec.md`.
