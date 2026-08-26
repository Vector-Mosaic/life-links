# Life Links

Life Links connects AI to a person's physical world through stable digital
records and optional QR bindings. This standalone tree is the public-release
projection for the 2026 WebMCP Challenge.

This initial snapshot intentionally contains the working Life Links application
as it existed before any WebMCP product implementation. Challenge-specific work
will be recorded transparently in `CHALLENGE_WORK.md` and in dated commits.

The final submission README, license, deployment URL, judge walkthrough, and
WebMCP tool documentation will be completed only after the implementation and
release checks pass.

## Local commands

```bash
pnpm install --no-frozen-lockfile
pnpm test
pnpm build
pnpm typecheck
pnpm dev
```

The canonical monorepo lockfile is intentionally not copied because its
workspace importer paths do not match this collapsed standalone layout. The
first install creates the standalone `pnpm-lock.yaml`; commit that generated
lockfile before enabling frozen-lockfile CI.

The service uses an in-memory store when `DATABASE_URL` is absent. Copy
`.env.example` to a local untracked `.env` only when you need explicit values.
