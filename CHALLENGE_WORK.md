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

Two canonical checkpoints intentionally produce no invented standalone product
commit: `2ada1078594cee1a6d3b46b48718b30a01b41736` changes release tooling outside
the admitted tree and maps to `74017e73046b7eb4901297a4f63c225620c1b1ba`;
`94855eb34b7ef865d03079de8f4cf6ddd9457499` changes the excluded deployment
binding and maps to `e674dabc7f058ef0be00b66057c8a8509d4428ad`.

The implemented WebMCP catalog is exactly:
`inspect_current_life_link`, `search_my_life_links`, `open_life_link`,
`draft_life_link_update`, and `start_find_mode`. Agent tools never bypass the
ordinary owner-session boundary, and the draft tool never persists a write.

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

The eventual public release head will be the commit containing this completed
mapping. Its full SHA will be verified from Git and `/version.build_sha` rather
than embedded as an impossible self-reference. The final deployment revision
remains unset
until clean-clone qualification, the rights/license gate, public release freeze,
and exact-identity redeployment pass. The earlier private hosted qualification
is a source-bound baseline, not the submitted public release.

## Rights, license, and submission boundary

This standalone release is licensed under the root MIT `LICENSE`, copyright
(c) 2026 Justin Sublette. The selected public repository owner is
`Vector-Mosaic`, and the public commit/tag identity is
`Justin Sublette <216620060+Vector-Mosaic@users.noreply.github.com>`. Neither
the project license nor this projection grants rights to monorepo-only files or
materials excluded from this standalone release.

Before publication, the project owner must factually confirm publication rights
for the included code, assets, name, and product identity, and the final
licensed tree, Git identity, projection, history, clean-clone build, and tests
must pass their release gates. Competition registration, terms acceptance,
judge credentials, and final submission remain owner-controlled actions.
