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
- rich notes, media, privacy, authentication, and PostgreSQL persistence;
- one human/agent physical-locator derivation that selects the nearest
  QR-bound container from canonical ancestry without storing a second location
  field; and
- deterministic synthetic family-adventure context for a family of four,
  including 60 meaningful Life Links, six QR-labelled basement tubs, retained
  bag/pad QRs, prior-trip experience, preferences, packing intent, and a
  planned-only upgrade record.

## Challenge story: pack -> experience -> improve

**AI already knows the world. Life Links lets it know yours.**

The challenge proof follows one family across time instead of presenting a
collection of disconnected tool calls. Two adults and two children keep enough
gear for a multi-day camping, hiking, and cycling trip in six large labelled
tubs on a basement rack. Their Life Links record what they own, how kits are
configured, where each item returns, what condition it is in, what the family
prefers, what happened last time, and what they intend to change.

Before the trip, the owner can ask the page agent where to find the family tent,
four sleep systems, stove, first-aid kit, rain layers, or bike repair kit. Life
Links searches the private hierarchy but returns the useful physical answer:
the nearest QR-bound tub and its QR ID. The human UI shows the same result, and
Find Mode still requires the person to scan the physical container.

After the trip, a durable experience record says what actually worked and
failed. The existing bag kept its user warm around 35°F, cold came through the
low-R sleeping pad, and child bike-light mounts loosened on rough ground. When
planning next year, the agent combines those facts with the family's warmth-
over-weight preference, instruction not to replace working gear, and $250
budget. It uses the ordinary revision-safe Life Links update to record the pad
as the next planned upgrade. The result remains explicitly planned—not
purchased, owned, or installed—and survives reload after Agent Access expires.

The product vision is broad: a private, user-controlled context layer for
physical life. The judged path is deliberately narrow and repeatable: pack the
family, use recorded experience, improve one next-trip decision, and reconnect
the decision to the right physical tub.

## WebMCP Agent Access

An authenticated owner can explicitly enable session-scoped Agent Access on
the owner workspace. Life Links then registers exactly five page tools through
`document.modelContext.registerTool`:

- `inspect_current_life_link`
- `search_my_life_links`
- `open_life_link`
- `update_life_link_content`
- `start_find_mode`

The tools reuse the ordinary application controller and authorization paths.
They create visible page effects, reject stale or unauthorized context, and do
not give an agent a hidden or parallel write path. Inspection returns bounded
substantive selected-record context, and search returns bounded paths plus note
summaries. Both also return the same derived physical locator shown in human
detail/search: nearest QR-bound ancestor first, QR-bound subject only as a
complete-path fallback, and null for missing or truncated-ambiguous placement.
This is recorded placement, not live-location proof.
`update_life_link_content` immediately saves only a title and/or
plain-text body through the canonical owner PATCH, using the exact `updatedAt`
revision obtained from a prior read. It rejects stale state, an open editor, a
saved human draft, unavailable owner source records, and access or owner-
surface changes. It cannot change privacy, hierarchy, QR bindings, media, or
purchase state. Find Mode prepares the target; the human performs the scan.

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

The three automated browser journeys build their own application bundles. The
controlled-host test proves the page-tool contract and human-draft conflict
boundary. The native-host test requires an installed Google Chrome with WebMCP
testing support. The challenge test runs the complete family-adventure proof:

```bash
pnpm exec playwright install chromium
pnpm test:e2e:webmcp:local
pnpm test:e2e:webmcp:real
pnpm test:e2e:challenge
```

The challenge journey starts at public Green Family Sleep Systems Tub QR
`LL-WEBMCP-00004`, proves public hierarchy redaction, and enters the owner
workspace. Packing searches cover representative gear in all six tubs and show
the same exact tub locator in agent and human output. The retained QR-bound pad
still resolves to the nearer Green tub ancestor. The journey then retrieves the
working bag, failed pad, family preferences, $250 budget, and prior four-day
trip before using one four-source `update_life_link_content` call to persist a
sleeping-pad priority in the private Next-Year Upgrade Plan. It reloads to prove
the new revision persisted and Agent Access reset, rejects Blue Shelter Tub QR
`LL-WEBMCP-00003`, matches the Green tub in Find Mode, revokes tool access, and
confirms a fresh logged-out context still receives only the generic public
Green tub. The synthetic plan explicitly remains planned only—not purchased,
owned, or installed.

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

## Release status

The project owner confirmed on August 26, 2026 that he has the rights and
authority to publish the admitted code and assets, the Life Links name, and
product identity under MIT. The public repository is
`https://github.com/Vector-Mosaic/life-links`, with a preserved
`pre-webmcp-existing-app` baseline. `SOURCE_PROJECTION.json` in each generated
release binds that tree to its exact canonical source. The family-adventure
projection, clean-clone qualification, deployed revision, hosted journey,
competition registration, terms acceptance, judge credentials, and final
submission remain separately verifiable; this source tree does not infer those
events merely because the implementation or documentation exists.
