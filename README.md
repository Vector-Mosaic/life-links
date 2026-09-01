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
  direct physical-layer browsing, bounded search/path context, and cycle-safe
  moves;
- private Collections that reference Life Links without moving or copying them,
  with flat, overlapping Collection-local Sections and exhaustive membership
  details;
- optional QR binding at every level, public QR resolution, claim, batch
  export, and Find Mode;
- rich notes, truth-labelled Summary/Condition/Experience/Plan context, media,
  explicit public-field selection, authentication, and PostgreSQL persistence;
- one human/agent physical-locator derivation that selects the nearest
  QR-bound container from canonical ancestry without storing a second location
  field; and
- deterministic synthetic family-adventure context for a family of four,
  including 60 meaningful Life Links, six QR-labelled basement tubs, retained
  bag/pad QRs, and one Camping Gear Collection with 48 members, five Sections,
  and 52 Section assignments. Prior-trip experience, preferences, packing
  intent, and a planned-only pad upgrade remain attached to canonical context.

The web Field Ledger uses fixed-height navigation, independently scrolling
panels, shared Details, contextual creation controls, and light/dark and mobile
layouts. The obsolete Project compatibility model and its dependent iOS client
are retired; this successor is web-first. Forward PostgreSQL migration `007`
removes only the compatibility marker and guards, preserving canonical records
and associations. Historical migrations remain unchanged; Projects are not
automatically converted into Collections.

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
budget. It uses the ordinary revision-safe Life Links update to replace the
sleeping pad's structured Plan context. The result remains explicitly
planned—not
purchased, owned, or installed—and survives reload alongside the owner's saved
Agent connection.

The product vision is broad: a private, user-controlled context layer for
physical life. The judged path is deliberately narrow and repeatable: pack the
family, use recorded experience, improve one next-trip decision, and reconnect
the decision to the right physical tub.

## WebMCP Agent Access

An authenticated owner selects **Connect Agent** once on the owner workspace.
Life Links saves that connection for the owner across reloads, browser restarts,
logout/login, and future visits. Eligible signed-in owner pages then register
exactly fourteen page tools through `document.modelContext.registerTool` without a
second prompt. Only **Disconnect Agent** revokes the saved connection:

- `inspect_current_life_link`
- `search_my_life_links`
- `open_life_link`
- `update_life_link_content`
- `start_find_mode`
- `create_life_link`
- `move_life_link`
- `manage_life_link_qr`
- `list_my_collections`
- `inspect_collection`
- `maintain_collection`
- `prepare_life_link_change`
- `apply_life_link_change`
- `read_life_link_attachment`

The tools reuse the ordinary application controller and authorization paths.
They create visible page effects, reject stale or unauthorized context, and do
not give an agent a hidden or parallel write path. Inspection returns bounded
substantive selected-record context, and search returns bounded paths plus note
summaries. Both also return the same derived physical locator shown in human
detail/search: nearest QR-bound ancestor first, QR-bound subject only as a
complete-path fallback, and null for missing or truncated-ambiguous placement.
This is recorded placement, not live-location proof.
Every result is bounded to 2,048 UTF-8 JSON bytes with explicit truncation;
Collection members, Sections, and assignments expose resumable continuation.
`update_life_link_content` immediately saves a title, plain-text body, and/or
complete structured context replacement through the canonical owner PATCH,
using the exact `updatedAt` revision obtained from a prior read. It rejects stale
state, an open editor, a
saved human draft, unavailable owner source records, and access or owner-
surface changes. That content tool cannot change privacy, hierarchy, QR
bindings, media, or purchase state. The separate creation, move, QR/public-field,
and Collection tools reuse the corresponding ordinary owner operations and
their revision/retry rules. Sections are flat and nonexclusive; adding a
container to a Collection references that exact record, not its descendants.
Bulk move/delete uses a complete paged preview before the shared apply/Undo
path; deletion requires complete agent readback and one confirmation observed
by the app. The attachment tool reads exact revision-bound private extracted
text or explicit source-bound visual/audio representations through bounded
continuation. It does not upload attachments or provide arbitrary binary
transport.
Find Mode prepares the target; the human performs the scan.

Together these fourteen tools are the curated logical page-bound WebMCP
interface registered by an eligible live owner page. They are not a remote or
server MCP endpoint, background/delegated identity, or guarantee that any named
host implements the page registration API.

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
still resolves to the nearer Green tub ancestor. The successor journey exercises
all fourteen tools: physical folder/item creation and movement, explicit QR and
public-field changes, Collection and overlapping Section membership, complete
bulk-change preview/apply with the shared Undo path, private attachment reading,
and an exact-revision structured Plan update on the sleeping pad. It retrieves the
working bag, failed pad, family preferences, $250 budget, and prior-trip context
without creating a separate physical "upgrade plan" item. It reloads, logs out,
and signs in again to prove persisted context and the one-time Agent connection
without reconnecting. It rejects Blue Shelter Tub QR
`LL-WEBMCP-00003`, matches the Green tub in Find Mode, explicitly disconnects
the agent, and confirms a fresh logged-out context still receives only the
allowlisted public Green tub summary without hierarchy or private Collection
context. The synthetic plan explicitly remains planned
only—not purchased, owned, or installed.

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
`/version.competition_fixture_profile` identifies the exact
`webmcp-field-ledger-family-v3` fixture; a predecessor runtime identity is not
successor qualification.

## Third-party software

The prior production dependency inventory, selected dual-license options,
upstream attributions, and license terms are recorded in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Its qualification warning is
current: the notice body has not yet been regenerated for the successor's final
production lockfile/native closure, so it does not establish redistribution
eligibility.

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

The Field Ledger successor passes local controlled-host, native-Chrome, and
complete v3 family-journey verification with all fourteen tools and the 2 KB
output bound; it has not been deployed in this workstream. BC-270 qualification
is in progress: the clean projected clone's frozen install, selected
unit/contract/build checks, production dependency audit, browser, Postgres, and
interface execution pass at their recorded scopes. Release qualification is
still blocked on exact `@napi-rs/canvas` native Rust/Skia source/license closure.
Exact Debian corresponding-source retention is complete at its recorded
image-bound/offline-verified scope. The recorded BC-180 public/hosted
evidence belongs to the preceding five-tool family-adventure release, not this
fourteen-tool successor. Publication, hosted qualification, and submission
acceptance remain separate gates; BC-280 has not started.
