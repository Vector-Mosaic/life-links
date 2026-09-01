# Third-party notices and source-material routes

This file records engineering evidence for the third-party material incorporated
in `@napi-rs/canvas-linux-x64-gnu@0.1.100`. It applies only to the native addon
whose SHA-256 is
`081f48cae55e9527cdac35f4f22a0165f465d27d442f89ea7a8119aade984894`
and size is `33,483,200` bytes. It is not legal advice and does not claim legal
review or redistribution clearance.

The complete byte-identical license and patent-notice files referenced below
are under `LICENSES/`. `SOURCE_MATERIALS.json` is the retained engineering
inventory that binds those files to the exact source, final-link evidence,
binary, and toolchain. Its sidecar is `SOURCE_MATERIALS.json.sha256`.

## Source-material handle

The primary corresponding-source and reproducibility handle is the separately
retained `normalized-canvas-materials.tar`:

- SHA-256:
  `410a39ed4f7a9d8b8f63386d144aec969fec35b88206c51c85948c85af2ac5aa`
- size: `7,919,534,080` bytes
- contents: the exact base canvas, Cargo, Skia, depot_tools, and recorded Skia
  dependency source graph normalized for deterministic builds

The complete effective canvas source is that unchanged base archive plus the
canonical committed patch
`native-build/patches/0001-backport-draw-image-source-napi-3.12.patch`
(SHA-256
`60162360c684e27225636031b5727b6bdf8e736d9ef0b615eb23e13917350298`).
The patch backports upstream commit
`6be5aa2c664dd077513aa8c89a93531cc568adef`, changes only `src/ctx.rs`, and
transforms base canvas tree `7186ab69c2228f109c5cbe21a4d3b406468c2b41`
into effective tree `a8286ad26dba37e3f18c50665d0b640006f89b85`.
The bootstrap evidence is bound to package commit
`c80cdf7b3afd8f81062075a432610f16f13652ad`; its fresh relink is
byte-identical to the addon identified above. The normalized archive alone is
base material, not the complete effective source.

The separately retained source records for Rust 1.94.1, LLVM 19, GCC 4.8.5,
and glibc 2.17 are indexed by `SOURCE_MATERIALS.json`. The large source archive
and toolchain archives are release/source-store artifacts rather than duplicated
inside this npm package.

## Incorporated components

The following inventory is based on the exact final ELF, linker map, selected
archive members, Cargo lock, and active bundled source graph. The listed paths
route to the complete retained notices rather than paraphrasing their terms.

| Component | Retained license or notice material |
| --- | --- |
| `@napi-rs/canvas` | `LICENSES/canvas/LICENSE` |
| Cargo dependency closure | `LICENSES/cargo/<crate-version>/...` as enumerated by `SOURCE_MATERIALS.json` |
| `cssparser`, `cssparser-color`, `cssparser-macros`, `dtoa-short` | Corresponding MPL-2.0 `LICENSE` files under `LICENSES/cargo/`; exact covered source is in the normalized source archive |
| Rust `libavif` and bundled C libavif | `LICENSES/cargo/libavif-0.14.0/LICENSE`; `LICENSES/cargo/libavif-sys-0.17.0+libavif.1.0.4/libavif/LICENSE` |
| bundled libaom | `LICENSES/cargo/libaom-sys-0.17.2+libaom.3.11.0/vendor/LICENSE`; `.../PATENTS` |
| AOM fastfeat | `.../vendor/third_party/fastfeat/LICENSE` |
| AOM vector | `.../vendor/third_party/vector/LICENSE` |
| AOM SVT-AV1 material | `.../vendor/third_party/SVT-AV1/LICENSE.md`; `.../PATENTS.md` |
| AOM x86inc material | `.../vendor/third_party/x86inc/LICENSE` |
| mimalloc | `LICENSES/cargo/libmimalloc-sys2-0.1.61/LICENSE.txt`; `.../c_src/mimalloc/LICENSE`; `.../c_src/mimalloc3/LICENSE` |
| Skia | `LICENSES/skia/skia/LICENSE` |
| Expat | `LICENSES/skia/expat/COPYING` |
| FreeType | `LICENSES/skia/freetype/LICENSE.TXT`; `LICENSES/skia/freetype/FTL.TXT` |
| HarfBuzz | `LICENSES/skia/harfbuzz/COPYING` |
| Highway | `LICENSES/skia/highway/LICENSE` |
| ICU | `LICENSES/skia/icu/LICENSE` |
| libjpeg-turbo and IJG material | `LICENSES/skia/libjpeg-turbo/LICENSE.md`; `LICENSES/skia/libjpeg-turbo/README.ijg` |
| JPEG XL | `LICENSES/skia/libjxl/LICENSE`; `LICENSES/skia/libjxl/PATENTS` |
| libpng | `LICENSES/skia/libpng/LICENSE` |
| libwebp | `LICENSES/skia/libwebp/COPYING`; `LICENSES/skia/libwebp/PATENTS` |
| Wuffs | `LICENSES/skia/wuffs/LICENSE` |
| zlib | `LICENSES/skia/zlib/LICENSE` |
| Brotli | `LICENSES/skia/brotli/LICENSE` |
| Rust 1.94.1 runtime/library material | `LICENSES/toolchains/rust-1.94.1/` |
| LLVM libc++ and libc++abi material | `LICENSES/toolchains/llvm-toolchain-19/` |
| GCC 4.8.5 CRT material | `LICENSES/toolchains/crosstool-sysroot/gcc/COPYING3`; `.../COPYING.RUNTIME` and the other captured GCC notice files |
| glibc 2.17 startup/nonshared material | `LICENSES/toolchains/crosstool-sysroot/glibc/COPYING.LIB`; `.../LICENSES` |

FreeType acknowledgment: portions of this software use the FreeType Project
(https://freetype.org). See the complete FreeType license and credit language
in `LICENSES/skia/freetype/FTL.TXT`.

The exact map selects GCC 4.8.5 `crtbeginS.o` and `crtendS.o`, whose source is
`libgcc/crtstuff.c`, and the captured GCC Runtime Library Exception 3.1 applies
to that material. It selects glibc 2.17 startup and nonshared objects whose eight
corresponding source files carry the file-specific linking permission recorded
in `SOURCE_MATERIALS.json`. These are engineering applicability findings for
the identified binary; the release owner still owns legal review.

`CONFIG_LIBYUV=1` and `CONFIG_WEBM_IO=1` occur in the libaom build
configuration, but the exact link contains no libyuv or libwebm implementation
object. Their files remain in the retained source/build inventory and do not
become incorporated-component claims here.

## Build-only material

GN, Ninja, depot_tools, CMake, Git, Python, Node.js, compiler executables,
binutils, crosstool-NG executables and recipes, Ubuntu GCC/glibc host packages,
and the builder OCI image are recorded build or qualification materials. They
are not files distributed by this native npm package. Their captured notices
remain in the projected license tree so the package evidence can be checked
against the retained source inventory without inventing a second evidence set.

## Scope and nonclaims

This projection establishes a deterministic engineering route from the exact
package files to the retained source/license evidence. It does not establish
legal clearance, deployment, runtime-image notice closure, or the overall
Life Links release qualification by itself. If the native addon identity,
source graph, toolchain, or final link changes, the applicability analysis and
this projection must be regenerated and requalified.
