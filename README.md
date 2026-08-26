# Life Links

Life Links connects AI to a person's physical world through stable digital
records and optional QR bindings. A pantry, shelf, container, or individual
object can be a Life Link; every Life Link may contain more Life Links to any
supported depth and may have its own QR code.

This tree is a generated standalone projection of the implemented Life Links
release candidate for the 2026 WebMCP Challenge. `SOURCE_PROJECTION.json`
binds it to canonical source, normalized tree digests, and every reviewed
standalone-layout transform. `CHALLENGE_WORK.md` separates the pre-existing
application from work completed for the challenge.

## Implemented product surface

- arbitrary-depth owner hierarchy with stable Life Link identity, breadcrumbs,
  bounded search/path context, and cycle-safe moves;
- optional QR binding at every level, public QR resolution, claim, batch
  export, and Find Mode;
- rich notes, media, privacy, authentication, and PostgreSQL persistence; and
- deterministic synthetic camera-kit data for repeatable local and judge flows.

## WebMCP Agent Access

An authenticated owner can explicitly enable session-scoped Agent Access on
the owner workspace. Life Links then registers exactly five page tools through
`document.modelContext.registerTool`:

- `inspect_current_life_link`
- `search_my_life_links`
- `open_life_link`
- `draft_life_link_update`
- `start_find_mode`

The tools reuse the ordinary application controller and authorization paths.
They create visible page effects, reject stale or unauthorized context, and do
not give an agent a hidden write path. `draft_life_link_update` creates a
reviewable proposal only; a person must explicitly Apply it and use the normal
Save action before anything is persisted.

## Run locally

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm build
```

The standalone lockfile is generated from this collapsed workspace, reviewed,
and committed. The canonical monorepo lockfile is intentionally not copied
because its workspace importer paths are different.

The two automated browser journeys build their own application bundles. The
controlled-host test proves the full page-tool contract, while the native-host
test requires an installed Google Chrome with WebMCP testing support:

```bash
pnpm exec playwright install chromium
pnpm test:e2e:webmcp:local
pnpm test:e2e:webmcp:real
pnpm test:e2e:challenge
```

The PostgreSQL integration suite is opt-in and requires a disposable database:

```bash
LIFE_LINKS_TEST_DATABASE_URL=postgresql://... \
  LIFE_LINKS_ALLOW_TEST_DB_SCHEMA=1 \
  pnpm test:postgres
```

Start the disposable in-memory competition fixture after exporting the sample
environment into the current shell. On POSIX shells:

```bash
set -a
. ./.env.example
set +a
pnpm dev
```

On PowerShell:

```powershell
Get-Content .env.example |
  Where-Object { $_ -match '^[A-Za-z_][A-Za-z0-9_]*=' } |
  ForEach-Object {
    $name, $value = $_ -split '=', 2
    [Environment]::SetEnvironmentVariable($name, $value, 'Process')
  }
pnpm dev
```

The API reads process environment variables and intentionally does not load a
root `.env` implicitly. The sample binds only to `127.0.0.1`; exposing it on
other interfaces requires an explicit operator change and stronger credentials
and origin policy.
Hosted challenge startup is fail-closed: the service requires an exact HTTPS
`QR_BASE_URL` plus nonzero lowercase full-length `BUILD_SHA`,
`CANONICAL_SOURCE_SHA`, and `SOURCE_TREE_SHA256` values. `/healthz`, `/readyz`,
and `/version` expose the corresponding safe snake_case release fields for
qualification.

## Third-party software

The production dependency inventory, selected dual-license options, upstream
attributions, and license terms are recorded in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## License

Life Links in this standalone repository is licensed under the
[MIT License](LICENSE). Copyright (c) 2026 Justin Sublette. Third-party
components remain subject to the terms and attributions recorded in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

This MIT grant covers the files included in this standalone Life Links release.
Monorepo-only files and materials excluded from this release are outside the
grant.

## Prepublication status

The selected public repository target is
`https://github.com/Vector-Mosaic/life-links`. This licensed candidate remains
private until the project owner factually confirms publication rights for the
included code, assets, name, and product identity and its exact Git identity,
source projection, clean-clone build, and tests pass the release gate.
Competition terms acceptance, judge credentials, final deployment identity,
and final submission remain separate release actions.
