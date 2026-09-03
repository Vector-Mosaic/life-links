# WebMCP Challenge work boundary

Life Links is a pre-existing full-stack application. The challenge work extends
that one application; it does not reclassify the original product as newly
built. This record preserves the distinction.

## Pre-existing baseline

Before the challenge implementation, Life Links already provided human-facing
QR resolution and claim, owner notes and Projects, rich editing, media,
privacy, authentication, search, Find Mode, batch export, and PostgreSQL
persistence. The accepted provenance boundaries are:

- last observed pre-window product-feature commit:
  `03185817d68e0ca3dc5740aff4bd4e76c24c72af` (2026-05-07);
- last pre-WebMCP Life Links implementation-affecting qualification checkpoint:
  `da91c072896e587996390cdc0bd7578cec1d5693` (2026-08-12); and
- promoted challenge plan source:
  `544c0c88e82364fa3bfda19678aa487a0a5aea8e`.

The preserved standalone baseline commit is
`b9f55167afcc150ba009266d55a814b3bae4a2fa`, tagged
`pre-webmcp-existing-app`. Its generated evidence names canonical source
`a1f09d1bd6ceb1b8088ca7d632df69889442fed3`; the only admitted-area difference
from `da91c072896e587996390cdc0bd7578cec1d5693` is an excluded application
README, so the projected product tree is equivalent. The baseline is preserved
and disclosed rather than rewritten. The post-window standalone import is
labeled as imported pre-existing work and is not described as challenge-created
functionality.

## Implemented challenge extensions

| Extension | Before challenge | Canonical checkpoint | Standalone projection commit | Evidence |
|---|---:|---|---|---|
| Shared workspace controller and direct WebMCP compatibility proof | No | `c82109e07b812bb5ed2ac191a5b428323dfeb9db` | `74017e73046b7eb4901297a4f63c225620c1b1ba` | Behavior-neutral controller tests and direct host compatibility proof |
| Canonical arbitrary-depth Life Link domain and legacy conversion | No | `4486c6ef15bb17b36730263279f75b846d8efbc3` | `cc8f7a22eaced768171934ca1679b6fe63e3d510` | Recursive core contract, fixtures, and tests |
| Transactional recursive stores and PostgreSQL migration | No | `cfff61da84be673dda38b08e450a8c49ec40c8ea` | `2716bee9f35928c24baa2c1b0d1c3f862531a391` | Store contracts, migration, rollback, and Postgres tests |
| Recursive HTTP/OpenAPI surface | No | `da9b1a3fcc268b8eed3bd1b69232a1ce232ab75c` | `58788853baf9e2460000bcad8eebf1177ac3fe1b` | Versioned OpenAPI and API contract tests |
| Recursive owner tree, paths, editor, and navigation | No | `da131ba2f158244527fa3b394aab748a0255cf27` | `38fe4974ed296aecd68d6fff3c7a6acb8c8771ea` | Workspace/controller/unit and browser tests |
| Five page-bound WebMCP tools with explicit Agent Access | No | `21858e1d27c0041c7ff593aeee932660009dd51a` | `a162451367b6e72c679252d642e82111327ca31f` | Direct `registerTool` implementation, unit tests, controlled-host and native-Chrome tests |
| Reviewable agent draft followed by ordinary human Apply and Save | No | `21858e1d27c0041c7ff593aeee932660009dd51a` | `a162451367b6e72c679252d642e82111327ca31f` | Proposal isolation, zero-write, stale-base, Apply/Undo, and one-Save tests |
| Deterministic camera-kit fixture, guarded reset, and complete challenge journey | No | `b0316f418eb8be3d44850513fbf0759a06b1cb29` | `e674dabc7f058ef0be00b66057c8a8509d4428ad` | Reset atomicity plus local and hosted journey tests |
| Hosted qualification hardening | No | `ef5dd310fcb6647155b80be2a075284055bfaec3` | `e102bba78d2082dbd91b4f722d063c995f5b3228` | Runtime identity gates and hosted acceptance lane |
| Preserve newer navigation when Save completes after navigation | No | `5b850e618c88c50b8079305b1314df1c38cb52e3` | `6e0d1cf28a91485ab690fff67050a704d4ee327d` | Workspace controller regression tests |
| Rich physical-context retrieval, revision-safe direct update, and deterministic camping challenge loop | No | `2fff0f5d8bd791cd43e5fef4f7640b4a7a563552` | `bbdfba3f1eccd7d2ff4f3905c17eb2ecb9ea2c36` | BC-120/130/140 unit, contract, controlled-host, native-Chrome, persistence, and complete local challenge-loop evidence |
| Sixty-record family-adventure fixture and shared nearest-QR physical locator | No | exact canonical source recorded by this release's `SOURCE_PROJECTION.json` | this forward-only release projection | Fixture/reset counts and identity tests; core locator edge cases; handler and human-UI parity; controlled and native family journey tests |
| Judged-path presentation, trust-state clarity, and responsive accessibility | No | exact canonical source recorded by this release's `SOURCE_PROJECTION.json` | this forward-only release projection | Public, private, owner-only, unclaimed, and missing-state regression coverage; keyboard focus transfer; desktop and phone browser qualification; light/dark contrast and reduced-motion checks |
| One-time durable owner Agent connection with explicit disconnect | No | exact canonical source recorded by this release's `SOURCE_PROJECTION.json` | this forward-only release projection | Additive `agent_connected_at` migration; idempotent connect/disconnect API and store contracts; reload, browser-restart, logout/login, fresh-context, reset-preservation, controlled-host, and native-Chrome qualification |

Two canonical checkpoints intentionally produce no invented standalone product
commit: `2ada1078594cee1a6d3b46b48718b30a01b41736` changes release tooling outside
the admitted tree and maps to `74017e73046b7eb4901297a4f63c225620c1b1ba`;
`94855eb34b7ef865d03079de8f4cf6ddd9457499` changes the excluded deployment
binding and maps to `e674dabc7f058ef0be00b66057c8a8509d4428ad`.

The draft tool, camera fixture, six-record camping, and five-tool
family-adventure rows above preserve earlier locally and hosted-qualified
challenge checkpoints as history, including BC-180. They do not describe the
current Field Ledger successor or qualify its deployment. The retained legacy
v1 WebMCP catalog is exactly:
`inspect_current_life_link`, `search_my_life_links`, `open_life_link`,
`update_life_link_content`, `start_find_mode`, `create_life_link`,
`move_life_link`, `manage_life_link_qr`, `list_my_collections`,
`inspect_collection`, `maintain_collection`, `prepare_life_link_change`,
`apply_life_link_change`, and `read_life_link_attachment`. Inspect and search
return substantive but bounded owner context. Every output is at most 2,048
UTF-8 JSON bytes; bounded Collection members, Sections, assignments, bulk-change
scope, and attachment reads have resumable continuation rather than silently
omitted edges. The content update tool
requires the exact base revision and changes title, body, and/or complete
truth-labelled structured context through the ordinary canonical PATCH,
may validate up to eight same-owner source Life Link IDs, and rejects open
editor, saved human draft, stale-revision, owner/surface, or access conflicts.
The saved Agent connection survives application sessions, but page tools are
registered only on an eligible authenticated owner workspace. Agent tools never
bypass the ordinary owner-session boundary. Separate tools now support physical
creation/movement, explicit QR/public-projection controls, and Collection and
Section maintenance through those same owner operations. Bulk move/delete uses
a complete preview plus the shared apply/Undo path, with complete readback and
one app-observed confirmation before deletion. Attachment reading is private,
revision-bound, and read-only; upload/change and arbitrary binary transport,
ownership transfer, and purchase operations remain outside this catalog.
Together these fourteen tools are the curated legacy page-bound WebMCP interface,
not a remote/server MCP endpoint, background or delegated identity, or named-host
support guarantee.

Explicit Calendar-v2 consent adds seven Calendar tools for twenty-one total.
The implemented Workspace-v3 source adds `list_my_routines`,
`prepare_collection_change`, `apply_collection_change`,
`prepare_routine_deletion` and `apply_routine_deletion`, for twenty-six total.
Existing v1/v2 grants never expand silently. The new tools reuse the human
controller/API/store and exact preview text. Collection organization changes
retain atomic apply and the five-change Undo history without changing physical
Life Links. Routine removal archives exact targets sequentially, preserves
completed history and active Runs, and reports confirmed and remaining targets
for partial retry; it is neither atomic nor part of Collection Undo. After full
paged readback, deletion returns a nonblocking pending state and requires the
owner's actual in-app Yes. Polling the same preview cannot supply consent.
Exact Collection moves do not need that deletion prompt. Routine discovery and
removal do not imply general Routine authoring, scheduling or execution tools.
Search-v4 adds `search_my_records` for twenty-seven tools, with a separate
explicit owner upgrade. Earlier v1/v2/v3 grants retain exactly 14/21/26 tools;
none silently acquire whole-app search. The human Search records page and new
tool share one category-paged owner API for Life Links, Collections, current
Routines, recorded Session history, authorized Calendar events and attachment
text. Collection members retain their physical Life Link identity, and Session
results open the recorded Routine revision rather than its current definition.
Calendar results cover synchronized provider projections, not a provider crawl.
Attachment search reuses the existing reader with migration 017's private,
source/extractor-revision-bound disposable cache; original bytes stay canonical.
Coverage warnings and continuations distinguish partial scans or unreadable
text from a complete no-match result. Agent output remains bounded to 2,048
UTF-8 bytes without silently dropping hits, and returned text is untrusted.
The original physical search endpoint/tool and per-calendar permissions are
unchanged; this adds no hidden agent backend or general Routine mutation tool.

Earlier 14/21/26-tool evidence retains its exact release scope and does not
qualify a newer deployed release; deployment identity and proof are recorded
separately from this source capability description.

The successor `webmcp-field-ledger-family-v3` fixture contains exactly one
synthetic owner, 60 physical Life Links, eight QR inventory rows/bindings, one
batch, one Camping Gear Collection with 48 direct members, five flat Sections,
and 52 assignments, including four overlapping memberships in Next-year
upgrades. It has no Project compatibility marker, sessions, media, or claims.
Hierarchies describe physical placement; private Collections and their
nonexclusive Sections organize purpose without moving or duplicating Life
Links. Adding a container references only that exact record, not its
descendants. Six QRs identify labelled basement tubs for shelter, family
sleep systems, kitchen/water, safety/lighting, hiking/weather, and cycling/
repairs. Stable Sleeping Bag and Sleeping Pad QRs `LL-WEBMCP-00001` and
`LL-WEBMCP-00002` retain their stable bindings. Public Green Family Sleep
Systems Tub QR `LL-WEBMCP-00004` is the start and Find Mode target; private
Blue Shelter Tub QR `LL-WEBMCP-00003` is the deterministic decoy.

The web Field Ledger presents direct physical layers, Collections, shared
Details with exhaustive memberships, contextual creation, structured context,
and explicit public-field selection. The next-year pad decision is the sleeping
pad's Plan context with truth state `planned`, not a separate physically placed
plan record. The retained complete local v1 journey exercises all fourteen tool jobs,
including complete reversible-change preview/apply and private attachment
reading, reload and login persistence, overlapping Sections, explicit public
redaction, and deterministic Find Mode target checks, not physical-camera
acceptance. The decision remains planned, not purchased or owned.

Forward migration `007_remove_project_compat.sql` removes only the obsolete
Project compatibility marker and guards, preserving canonical records,
relationships, QRs, media, and saved Agent connection state. Earlier migrations
remain unchanged and no automatic Project-to-Collection conversion occurs.
Traced Project routes, DTO/CSV fields, the web compatibility writer, and the
dependent Expo/iOS source and distribution lane are retired. Browser cookie and
operator/API bearer authentication remain supported; this is a web-first
successor, not a new native-client implementation.

Physical inspect and search retain one `physicalLocator` object or null,
using the same core derivation as human detail/search. The nearest QR-bound
ancestor excluding the subject wins, even if the subject retains its own QR;
the subject is a fallback only when a complete path proves no QR-bound ancestor
exists. Missing or truncated-ambiguous evidence returns null. Locator derivation
adds no stored location, agent-only hierarchy, or independent write authority.
It lets the family ask where gear is packed, use prior-trip
experience and preferences to update a planned-only next-year decision, and
then reconnect that decision to the physical tub through unchanged human-
scanned Find Mode.

The retained fourteen-tool successor passed local controlled-host, native-Chrome
and complete v3-fixture family-journey verification with the 2 KB output bound.
Subsequent Field Ledger, Routines, Calendar and provider releases were published
and deployed with their recorded frozen-install, focused API/UI/provider and
PostgreSQL checks, production builds and bounded hosted checks. The two-build
Rust/Skia reconstruction formerly tracked as BC-270 is not a current release
gate. Retained native/source/license material remains scoped evidence, not a
claim of universal redistribution clearance. Neither the earlier fourteen-tool
journey nor the twenty-one-tool provider checks substitute for exact-release
Workspace-v3 or Search-v4 qualification evidence.
Final competition submission remains separate from implementation and release.

## Projection and deployed-source mapping

The generated `SOURCE_PROJECTION.json` binds a release tree to the exact
canonical product commit, committed projection definition, canonical and
projected tree SHA-256 values, every exact transform result, the exactly-one
selected variant when a profile defines alternatives, and scaffold digests.
The deterministic projection-definition contract was introduced at
`46047d48875116664d5465686000a45dae712d42`. The private history was rebuilt
through committed, fail-closed sanitation profiles before publication. The
full release-document projection is generated from this committed template at
release freeze; its public commit is recorded by Git and runtime identity after
creation rather than embedded as a self-reference. At release freeze, record
all three runtime identities without inventing or abbreviating them:

- `BUILD_SHA` / `/version.build_sha`: nonzero full lowercase 40-hex public
  release commit;
- `CANONICAL_SOURCE_SHA` / `/version.canonical_source_sha`: nonzero full
  lowercase 40-hex canonical commit; and
- `SOURCE_TREE_SHA256` / `/version.source_tree_sha256`: nonzero lowercase
  64-hex normalized release-tree digest.

The forward-only public commit containing this completed mapping is the
selected family-adventure candidate. Git resolves its full SHA, while the live
`/version` response must report that same public commit, this projection's
canonical source, and this projection's normalized source-tree digest before
submission. This file intentionally avoids embedding its own commit or a
mutable deployment occurrence. Exact release, deployment, reset, and hosted-
qualification identities belong in the current submission handoff and
operational evidence. The six-record public release and hosted qualification
remain source-bound predecessor checkpoints, not the current submission
candidate.

## Rights, license, and submission boundary

This standalone release is licensed under the root MIT `LICENSE`, copyright
(c) 2026 Justin Sublette. The selected public repository owner is
`Vector-Mosaic`, and the public release identity is
`Justin Sublette <216620060+Vector-Mosaic@users.noreply.github.com>`. Neither
the project license nor this projection grants rights to monorepo-only files or
materials excluded from this standalone release.

On August 26, 2026, the project owner confirmed that he has the rights and
authority to publish the included code and assets, the Life Links name, and
product identity under MIT. The final licensed tree, Git identity, projection,
history, clean-clone build, and tests passed their private release gates before
first publication. The existing public repository and baseline tag have been
read back; each forward-only family-adventure commit and its exact Git identity
must be read back again after publication. Competition registration, terms
acceptance, judge credentials, and final submission remain owner-controlled
actions.
