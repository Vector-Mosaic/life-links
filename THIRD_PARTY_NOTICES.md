# Third-Party Notices

## Current source-candidate notice boundary

The retained JavaScript inventory and Outlook additions below keep their exact
recorded scope. The admitted Google addition pins `google-auth-library@10.9.1`.
The [Google dependency appendix](#google-authentication-dependency-additions)
reconciles all 15 added package versions and their installed upstream notices
with the production inventory from cloud run `33626746438`, source
`61a5a5e1da132a4dc90fdfd7fe9bad7c08a6c2fc`. That checkpoint's frozen standalone
lock SHA-256 is
`fdbff87fffbdf277502d689ac0c9cf0ebebe2438dfb03dba6adb565eef723cc2`;
the retained `pnpm licenses list --prod --json` output SHA-256 is
`69697aef6c2d4ace9666ba4060132b58ad941c0c23baa1a21513966aa707b29c`.
All 15 exact versions and declared licenses match. This closes the Google-added
dependency-notice delta, not a fresh audit of the complete historical closure.

The Calendar connection-dialog test addition admits `jsdom@26.1.0` only in the
web app's development dependencies. Its standalone lock SHA-256 is
`24a3ef81522f1a8170af4a47856a71fd1e6fc84b1c99592c1fd01fe3766fc925`.
Compared with the preceding `fdbff87f...` lock identified above, every production
and optional importer and all 336 reachable production snapshot/package-resolution
records are unchanged. The 31 added package records belong only to the development
closure; no shipped dependency or package notice is added by this change.
The frozen-install production inventory from cloud run `33654405621`, source
`10ee0393c7afc7839a76ed2786392057bb6a8ed4`, is byte-identical to the retained
inventories from runs `33626746438` and `33641813804`: 120,872 bytes, with the
`69697aef...` SHA-256 identified above. All 303 exact package-version/license
entries match, and `jsdom` is absent from that production inventory. This proves
the unchanged installed production-notice delta, not whole-release test success,
deployment qualification, or a new native-build audit.

Previously admitted native evidence is retained: applicable canvas/Rust/Skia
source and notices, image-bound Debian corresponding sources, and the packaged
FFmpeg/whisper.cpp license/source material. The former duplicate native rebuild
is not a release prerequisite. This Google inventory task neither reruns nor
supersedes that evidence, and the historical inventory below does not by itself
establish new-candidate notice completeness or legal clearance.

## Previously audited JavaScript closure

This file records the production third-party dependency closure for the
standalone Life Links release. It was derived from the release-candidate
`pnpm-lock.yaml` with pnpm 10.14.0 by running
`pnpm licenses list --prod --json` against an offline, frozen-lockfile
installation.

Audited lockfile SHA-256:
`6b549600ab4f6bd18b481cca2bbe486d3cc3062e2057415f48ff07da2169035e`.
Later standalone lockfile changes require reconciliation of the affected
production inventory and notices before publication. A verified development-only
change does not invalidate retained production notices; changed shipped packages,
versions, or license terms require the corresponding inventory/notice update.

The result contains 190 third-party package names and 199 exact locked
package-version entries. Development-only dependencies are excluded. Packages
that appear in the production closure solely to satisfy a production peer or
optional dependency remain included.

This notice applies only to the third-party components listed below. Life Links
itself is licensed separately under the root [MIT License](LICENSE); that
project license does not replace or narrow any third-party term or attribution
recorded here.

Package license files and source headers remain the authority for each
component's copyright notices. This aggregate preserves the complete locked
inventory, the common MIT and ISC terms, and the exact additional terms and
attributions for every non-MIT/ISC case found in the production closure.

## License disposition

- `jszip@3.10.1` - MIT option selected. Upstream offers
  `MIT OR GPL-3.0-or-later`; this release elects MIT.
- `pako@1.0.11` - MIT and Zlib. Both upstream notices are reproduced.
- `html5-qrcode@2.3.8` - Apache-2.0. The package's Apache license and the
  bundled ZXing attribution are reproduced.
- `qs@6.15.3` - BSD-3-Clause. The upstream notice is reproduced.
- All remaining production dependencies are in the complete MIT and ISC
  inventories below.

## MIT inventory

172 package names; 181 locked package-version entries:

- @floating-ui/core@1.8.0
- @floating-ui/dom@1.8.0
- @floating-ui/utils@0.2.12
- @tiptap/core@3.30.3
- @tiptap/extension-blockquote@3.30.3
- @tiptap/extension-bold@3.30.3
- @tiptap/extension-bubble-menu@3.30.3
- @tiptap/extension-bullet-list@3.30.3
- @tiptap/extension-code@3.30.3
- @tiptap/extension-code-block@3.30.3
- @tiptap/extension-document@3.30.3
- @tiptap/extension-dropcursor@3.30.3
- @tiptap/extension-floating-menu@3.30.3
- @tiptap/extension-gapcursor@3.30.3
- @tiptap/extension-hard-break@3.30.3
- @tiptap/extension-heading@3.30.3
- @tiptap/extension-horizontal-rule@3.30.3
- @tiptap/extension-italic@3.30.3
- @tiptap/extension-link@3.30.3
- @tiptap/extension-list@3.30.3
- @tiptap/extension-list-item@3.30.3
- @tiptap/extension-list-keymap@3.30.3
- @tiptap/extension-ordered-list@3.30.3
- @tiptap/extension-paragraph@3.30.3
- @tiptap/extension-placeholder@3.30.3
- @tiptap/extension-strike@3.30.3
- @tiptap/extension-task-item@3.30.3
- @tiptap/extension-task-list@3.30.3
- @tiptap/extension-text@3.30.3
- @tiptap/extension-underline@3.30.3
- @tiptap/extensions@3.30.3
- @tiptap/pm@3.30.3
- @tiptap/react@3.30.3
- @tiptap/starter-kit@3.30.3
- @tiptap/suggestion@3.30.3
- @types/react@19.2.18
- @types/react-dom@19.2.5
- @types/use-sync-external-store@0.0.6
- accepts@2.0.0
- ansi-regex@5.0.1
- ansi-styles@4.3.0
- append-field@1.0.0
- body-parser@2.3.0
- buffer-from@1.1.2
- busboy@1.6.0
- bytes@3.1.2
- call-bind-apply-helpers@1.0.2
- call-bound@1.0.4
- camelcase@5.3.1
- color-convert@2.0.1
- color-name@1.1.4
- concat-stream@2.0.0
- content-disposition@1.1.0
- content-type@1.0.5
- content-type@2.1.0
- cookie@0.7.2
- cookie@1.1.1
- cookie-signature@1.2.2
- core-util-is@1.0.3
- csstype@3.2.3
- debug@4.4.3
- decamelize@1.2.0
- depd@2.0.0
- dijkstrajs@1.0.3
- dunder-proto@1.0.1
- ee-first@1.1.1
- emoji-regex@8.0.0
- encodeurl@2.0.0
- es-define-property@1.0.1
- es-errors@1.3.0
- es-object-atoms@1.1.2
- escape-html@1.0.3
- etag@1.8.1
- express@5.2.1
- fast-equals@5.4.1
- finalhandler@2.1.1
- find-up@4.1.0
- forwarded@0.2.0
- fresh@2.0.0
- function-bind@1.1.2
- get-intrinsic@1.3.0
- get-proto@1.0.1
- gopd@1.2.0
- has-symbols@1.1.0
- hasown@2.0.4
- http-errors@2.0.1
- iconv-lite@0.7.3
- immediate@3.0.6
- ipaddr.js@1.9.1
- is-fullwidth-code-point@3.0.0
- is-promise@4.0.0
- isarray@1.0.0
- lie@3.3.0
- linkifyjs@4.3.3
- locate-path@5.0.0
- math-intrinsics@1.1.0
- media-typer@0.3.0
- media-typer@1.1.1
- merge-descriptors@2.0.0
- mime-db@1.52.0
- mime-db@1.54.0
- mime-types@2.1.35
- mime-types@3.0.2
- ms@2.1.3
- multer@2.2.0
- negotiator@1.1.0
- object-inspect@1.13.4
- on-finished@2.4.1
- orderedmap@2.1.1
- p-limit@2.3.0
- p-locate@4.1.0
- p-try@2.2.0
- parseurl@1.3.3
- path-exists@4.0.0
- path-to-regexp@8.4.2
- pg@8.23.0
- pg-cloudflare@1.4.0
- pg-connection-string@2.14.0
- pg-pool@3.14.0
- pg-protocol@1.16.0
- pg-types@2.2.0
- pgpass@1.0.5
- pngjs@5.0.0
- postgres-array@2.0.0
- postgres-bytea@1.0.1
- postgres-date@1.0.7
- postgres-interval@1.2.0
- process-nextick-args@2.0.1
- prosemirror-changeset@2.4.2
- prosemirror-commands@1.7.2
- prosemirror-dropcursor@1.8.3
- prosemirror-gapcursor@1.4.1
- prosemirror-history@1.5.0
- prosemirror-inputrules@1.5.1
- prosemirror-keymap@1.2.3
- prosemirror-model@1.25.11
- prosemirror-schema-list@1.5.1
- prosemirror-state@1.4.4
- prosemirror-tables@1.8.5
- prosemirror-transform@1.12.0
- prosemirror-view@1.42.3
- proxy-addr@2.0.7
- qrcode@1.5.4
- range-parser@1.3.0
- raw-body@3.0.2
- react@19.2.8
- react-dom@19.2.8
- readable-stream@2.3.8
- readable-stream@3.6.2
- require-directory@2.1.1
- rope-sequence@1.3.4
- router@2.2.0
- safe-buffer@5.1.2
- safe-buffer@5.2.1
- safer-buffer@2.1.2
- scheduler@0.27.0
- send@1.2.1
- serve-static@2.2.1
- setimmediate@1.0.5
- side-channel@1.1.1
- side-channel-list@1.0.1
- side-channel-map@1.0.1
- side-channel-weakmap@1.0.2
- statuses@2.0.2
- streamsearch@1.1.0
- string_decoder@1.1.1
- string_decoder@1.3.0
- string-width@4.2.3
- strip-ansi@6.0.1
- toidentifier@1.0.1
- type-is@1.6.18
- type-is@2.1.0
- typedarray@0.0.6
- unpipe@1.0.0
- use-sync-external-store@1.6.0
- util-deprecate@1.0.2
- vary@1.1.2
- w3c-keyname@2.2.8
- wrap-ansi@6.2.0
- xtend@4.0.2
- yargs@15.4.1

### Common MIT terms

The package-specific copyright notices are retained in the corresponding
upstream package distributions. The common MIT terms are:

    Permission is hereby granted, free of charge, to any person obtaining a copy
    of this software and associated documentation files (the "Software"), to deal
    in the Software without restriction, including without limitation the rights
    to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
    copies of the Software, and to permit persons to whom the Software is
    furnished to do so, subject to the following conditions:

    The above copyright notice and this permission notice shall be included in
    all copies or substantial portions of the Software.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
    IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
    FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
    AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
    LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
    OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
    THE SOFTWARE.

## ISC inventory

14 package names; 14 locked package-version entries:

- cliui@6.0.0
- get-caller-file@2.0.5
- inherits@2.0.4
- lucide-react@0.468.0
- once@1.4.0
- pg-int8@1.0.1
- require-main-filename@2.0.0
- set-blocking@2.0.0
- setprototypeof@1.2.0
- split2@4.2.0
- which-module@2.0.1
- wrappy@1.0.2
- y18n@4.0.3
- yargs-parser@18.1.3

### Common ISC terms

The package-specific copyright notices are retained in the corresponding
upstream package distributions. The common ISC terms are:

    Permission to use, copy, modify, and/or distribute this software for any
    purpose with or without fee is hereby granted, provided that the above
    copyright notice and this permission notice appear in all copies.

    THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
    WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
    MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY
    SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
    WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION
    OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN
    CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

## JSZip 3.10.1 - MIT option

JSZip is dual licensed. At your choice you may use it under the MIT license or
the GPLv3 license. This release elects the MIT option.

    The MIT License

    Copyright (c) 2009-2016 Stuart Knightley, David Duponchel, Franz Buchinger,
    António Afonso

    Permission is hereby granted, free of charge, to any person obtaining a copy
    of this software and associated documentation files (the "Software"), to deal
    in the Software without restriction, including without limitation the rights
    to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
    copies of the Software, and to permit persons to whom the Software is
    furnished to do so, subject to the following conditions:

    The above copyright notice and this permission notice shall be included in
    all copies or substantial portions of the Software.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
    IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
    FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
    AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
    LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
    OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
    THE SOFTWARE.

## pako 1.0.11 - MIT and Zlib

### pako MIT notice

    (The MIT License)

    Copyright (C) 2014-2017 by Vitaly Puzrin and Andrei Tuputcyn

    Permission is hereby granted, free of charge, to any person obtaining a copy
    of this software and associated documentation files (the "Software"), to deal
    in the Software without restriction, including without limitation the rights
    to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
    copies of the Software, and to permit persons to whom the Software is
    furnished to do so, subject to the following conditions:

    The above copyright notice and this permission notice shall be included in
    all copies or substantial portions of the Software.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
    IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
    FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
    AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
    LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
    OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
    THE SOFTWARE.

### pako zlib-port notice

    Content of this folder follows zlib C sources as close as possible.
    That's intended to simplify maintainability and guarantee equal API
    and result.

    Key differences:

    - Everything is in JavaScript.
    - No platform-dependent blocks.
    - Some things like crc32 rewritten to keep size small and make JIT
      work better.
    - Some code is different due missed features in JS (macros, pointers,
      structures, header files)
    - Specific API methods are not implemented (see notes in root readme)

    This port is based on zlib 1.2.8.

    This port is under zlib license (see below) with contribution and addition of javascript
    port under expat license (see LICENSE at root of project)

    Copyright:
    (C) 1995-2013 Jean-loup Gailly and Mark Adler
    (C) 2014-2017 Vitaly Puzrin and Andrey Tupitsin

    From zlib's README
    =============================================================================

    Acknowledgments:

      The deflate format used by zlib was defined by Phil Katz.  The deflate and
      zlib specifications were written by L.  Peter Deutsch.  Thanks to all the
      people who reported problems and suggested various improvements in zlib; they
      are too numerous to cite here.

    Copyright notice:

     (C) 1995-2013 Jean-loup Gailly and Mark Adler

    Copyright (c) <''year''> <''copyright holders''>

    This software is provided 'as-is', without any express or implied
    warranty. In no event will the authors be held liable for any damages
    arising from the use of this software.

    Permission is granted to anyone to use this software for any purpose,
    including commercial applications, and to alter it and redistribute it
    freely, subject to the following restrictions:

    1. The origin of this software must not be misrepresented; you must not
       claim that you wrote the original software. If you use this software
       in a product, an acknowledgment in the product documentation would be
       appreciated but is not required.
    2. Altered source versions must be plainly marked as such, and must not be
       misrepresented as being the original software.
    3. This notice may not be removed or altered from any source distribution.

      Jean-loup Gailly        Mark Adler
      jloup@gzip.org          madler@alumni.caltech.edu

## html5-qrcode 2.3.8 - Apache-2.0

The distributed package contains bundled ZXing code carrying this attribution:

    Copyright 2008 ZXing authors

The package's upstream Apache License 2.0 text follows verbatim.

                                     Apache License
                               Version 2.0, January 2004
                            http://www.apache.org/licenses/

       TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

       1. Definitions.

          "License" shall mean the terms and conditions for use, reproduction,
          and distribution as defined by Sections 1 through 9 of this document.

          "Licensor" shall mean the copyright owner or entity authorized by
          the copyright owner that is granting the License.

          "Legal Entity" shall mean the union of the acting entity and all
          other entities that control, are controlled by, or are under common
          control with that entity. For the purposes of this definition,
          "control" means (i) the power, direct or indirect, to cause the
          direction or management of such entity, whether by contract or
          otherwise, or (ii) ownership of fifty percent (50%) or more of the
          outstanding shares, or (iii) beneficial ownership of such entity.

          "You" (or "Your") shall mean an individual or Legal Entity
          exercising permissions granted by this License.

          "Source" form shall mean the preferred form for making modifications,
          including but not limited to software source code, documentation
          source, and configuration files.

          "Object" form shall mean any form resulting from mechanical
          transformation or translation of a Source form, including but
          not limited to compiled object code, generated documentation,
          and conversions to other media types.

          "Work" shall mean the work of authorship, whether in Source or
          Object form, made available under the License, as indicated by a
          copyright notice that is included in or attached to the work
          (an example is provided in the Appendix below).

          "Derivative Works" shall mean any work, whether in Source or Object
          form, that is based on (or derived from) the Work and for which the
          editorial revisions, annotations, elaborations, or other modifications
          represent, as a whole, an original work of authorship. For the purposes
          of this License, Derivative Works shall not include works that remain
          separable from, or merely link (or bind by name) to the interfaces of,
          the Work and Derivative Works thereof.

          "Contribution" shall mean any work of authorship, including
          the original version of the Work and any modifications or additions
          to that Work or Derivative Works thereof, that is intentionally
          submitted to Licensor for inclusion in the Work by the copyright owner
          or by an individual or Legal Entity authorized to submit on behalf of
          the copyright owner. For the purposes of this definition, "submitted"
          means any form of electronic, verbal, or written communication sent
          to the Licensor or its representatives, including but not limited to
          communication on electronic mailing lists, source code control systems,
          and issue tracking systems that are managed by, or on behalf of, the
          Licensor for the purpose of discussing and improving the Work, but
          excluding communication that is conspicuously marked or otherwise
          designated in writing by the copyright owner as "Not a Contribution."

          "Contributor" shall mean Licensor and any individual or Legal Entity
          on behalf of whom a Contribution has been received by Licensor and
          subsequently incorporated within the Work.

       2. Grant of Copyright License. Subject to the terms and conditions of
          this License, each Contributor hereby grants to You a perpetual,
          worldwide, non-exclusive, no-charge, royalty-free, irrevocable
          copyright license to reproduce, prepare Derivative Works of,
          publicly display, publicly perform, sublicense, and distribute the
          Work and such Derivative Works in Source or Object form.

       3. Grant of Patent License. Subject to the terms and conditions of
          this License, each Contributor hereby grants to You a perpetual,
          worldwide, non-exclusive, no-charge, royalty-free, irrevocable
          (except as stated in this section) patent license to make, have made,
          use, offer to sell, sell, import, and otherwise transfer the Work,
          where such license applies only to those patent claims licensable
          by such Contributor that are necessarily infringed by their
          Contribution(s) alone or by combination of their Contribution(s)
          with the Work to which such Contribution(s) was submitted. If You
          institute patent litigation against any entity (including a
          cross-claim or counterclaim in a lawsuit) alleging that the Work
          or a Contribution incorporated within the Work constitutes direct
          or contributory patent infringement, then any patent licenses
          granted to You under this License for that Work shall terminate
          as of the date such litigation is filed.

       4. Redistribution. You may reproduce and distribute copies of the
          Work or Derivative Works thereof in any medium, with or without
          modifications, and in Source or Object form, provided that You
          meet the following conditions:

          (a) You must give any other recipients of the Work or
              Derivative Works a copy of this License; and

          (b) You must cause any modified files to carry prominent notices
              stating that You changed the files; and

          (c) You must retain, in the Source form of any Derivative Works
              that You distribute, all copyright, patent, trademark, and
              attribution notices from the Source form of the Work,
              excluding those notices that do not pertain to any part of
              the Derivative Works; and

          (d) If the Work includes a "NOTICE" text file as part of its
              distribution, then any Derivative Works that You distribute must
              include a readable copy of the attribution notices contained
              within such NOTICE file, excluding those notices that do not
              pertain to any part of the Derivative Works, in at least one
              of the following places: within a NOTICE text file distributed
              as part of the Derivative Works; within the Source form or
              documentation, if provided along with the Derivative Works; or,
              within a display generated by the Derivative Works, if and
              wherever such third-party notices normally appear. The contents
              of the NOTICE file are for informational purposes only and
              do not modify the License. You may add Your own attribution
              notices within Derivative Works that You distribute, alongside
              or as an addendum to the NOTICE text from the Work, provided
              that such additional attribution notices cannot be construed
              as modifying the License.

          You may add Your own copyright statement to Your modifications and
          may provide additional or different license terms and conditions
          for use, reproduction, or distribution of Your modifications, or
          for any such Derivative Works as a whole, provided Your use,
          reproduction, and distribution of the Work otherwise complies with
          the conditions stated in this License.

       5. Submission of Contributions. Unless You explicitly state otherwise,
          any Contribution intentionally submitted for inclusion in the Work
          by You to the Licensor shall be under the terms and conditions of
          this License, without any additional terms or conditions.
          Notwithstanding the above, nothing herein shall supersede or modify
          the terms of any separate license agreement you may have executed
          with Licensor regarding such Contributions.

       6. Trademarks. This License does not grant permission to use the trade
          names, trademarks, service marks, or product names of the Licensor,
          except as required for reasonable and customary use in describing the
          origin of the Work and reproducing the content of the NOTICE file.

       7. Disclaimer of Warranty. Unless required by applicable law or
          agreed to in writing, Licensor provides the Work (and each
          Contributor provides its Contributions) on an "AS IS" BASIS,
          WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
          implied, including, without limitation, any warranties or conditions
          of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
          PARTICULAR PURPOSE. You are solely responsible for determining the
          appropriateness of using or redistributing the Work and assume any
          risks associated with Your exercise of permissions under this License.

       8. Limitation of Liability. In no event and under no legal theory,
          whether in tort (including negligence), contract, or otherwise,
          unless required by applicable law (such as deliberate and grossly
          negligent acts) or agreed to in writing, shall any Contributor be
          liable to You for damages, including any direct, indirect, special,
          incidental, or consequential damages of any character arising as a
          result of this License or out of the use or inability to use the
          Work (including but not limited to damages for loss of goodwill,
          work stoppage, computer failure or malfunction, or any and all
          other commercial damages or losses), even if such Contributor
          has been advised of the possibility of such damages.

       9. Accepting Warranty or Additional Liability. While redistributing
          the Work or Derivative Works thereof, You may choose to offer,
          and charge a fee for, acceptance of support, warranty, indemnity,
          or other liability obligations and/or rights consistent with this
          License. However, in accepting such obligations, You may act only
          on Your own behalf and on Your sole responsibility, not on behalf
          of any other Contributor, and only if You agree to indemnify,
          defend, and hold each Contributor harmless for any liability
          incurred by, or claims asserted against, such Contributor by reason
          of your accepting any such warranty or additional liability.

       END OF TERMS AND CONDITIONS

       APPENDIX: How to apply the Apache License to your work.

          To apply the Apache License to your work, attach the following
          boilerplate notice, with the fields enclosed by brackets "[]"
          replaced with your own identifying information. (Don't include
          the brackets!)  The text should be enclosed in the appropriate
          comment syntax for the file format. We also recommend that a
          file or class name and description of purpose be included on the
          same "printed page" as the copyright notice for easier
          identification within third-party archives.

       Copyright [2020] [MINHAZ <minhazav@gmail.com>]

       Licensed under the Apache License, Version 2.0 (the "License");
       you may not use this file except in compliance with the License.
       You may obtain a copy of the License at

           http://www.apache.org/licenses/LICENSE-2.0

       Unless required by applicable law or agreed to in writing, software
       distributed under the License is distributed on an "AS IS" BASIS,
       WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
       See the License for the specific language governing permissions and
       limitations under the License.

## qs 6.15.3 - BSD-3-Clause

    BSD 3-Clause License

    Copyright (c) 2014, Nathan LaFreniere and other [contributors](https://github.com/ljharb/qs/graphs/contributors)
    All rights reserved.

    Redistribution and use in source and binary forms, with or without
    modification, are permitted provided that the following conditions are met:

    1. Redistributions of source code must retain the above copyright notice,
       this list of conditions and the following disclaimer.

    2. Redistributions in binary form must reproduce the above copyright
       notice, this list of conditions and the following disclaimer in the
       documentation and/or other materials provided with the distribution.

    3. Neither the name of the copyright holder nor the names of its
       contributors may be used to endorse or promote products derived from
       this software without specific prior written permission.

    THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
    AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
    IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
    ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
    LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
    CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
    SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
    INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
    CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
    ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
    POSSIBILITY OF SUCH DAMAGE.

## Outlook authentication dependency additions

The Outlook source addition pins MSAL Node 6.0.0. These are the newly added
package versions in its locked dependency closure; the unchanged transitive
dependencies retain their existing notices. The following upstream license
texts are retained with line endings and trailing whitespace normalized. This addition does not
replace the earlier release inventory or claim new native-build qualification.

### @azure/msal-node@6.0.0 (MIT)

MIT License

Copyright (c) 2020 Microsoft

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

### @azure/msal-common@16.14.0 (MIT)

MIT License

Copyright (c) Microsoft Corporation. All rights reserved.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE

### jsonwebtoken@9.0.3 (MIT)

The MIT License (MIT)

Copyright (c) 2015 Auth0, Inc. <support@auth0.com> (http://auth0.com)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

### jws@4.0.1 (MIT), jwa@2.0.1 (MIT)

Copyright (c) 2013 Brian J. Brennan

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to use,
copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the
Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR
PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE
FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

### buffer-equal-constant-time@1.0.1 (BSD-3-Clause)

Copyright (c) 2013, GoInstant Inc., a salesforce.com company
All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

* Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.

* Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.

* Neither the name of salesforce.com, nor GoInstant, nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

<a id="apache-license-2-0-terms"></a>

### ecdsa-sig-formatter@1.0.11 (Apache-2.0)

Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

   END OF TERMS AND CONDITIONS

   APPENDIX: How to apply the Apache License to your work.

      To apply the Apache License to your work, attach the following
      boilerplate notice, with the fields enclosed by brackets "{}"
      replaced with your own identifying information. (Don't include
      the brackets!)  The text should be enclosed in the appropriate
      comment syntax for the file format. We also recommend that a
      file or class name and description of purpose be included on the
      same "printed page" as the copyright notice for easier
      identification within third-party archives.

   Copyright 2015 D2L Corporation

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.

### lodash.includes@4.3.0 (MIT), lodash.isinteger@4.0.4 (MIT), lodash.once@4.1.1 (MIT)

Copyright jQuery Foundation and other contributors <https://jquery.org/>

Based on Underscore.js, copyright Jeremy Ashkenas,
DocumentCloud and Investigative Reporters & Editors <http://underscorejs.org/>

This software consists of voluntary contributions made by many
individuals. For exact contribution history, see the revision history
available at https://github.com/lodash/lodash

The following license applies to all parts of this software except as
documented below:

====

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

====

Copyright and related rights for sample code are waived via CC0. Sample
code is defined as all source code displayed within the prose of the
documentation.

CC0: http://creativecommons.org/publicdomain/zero/1.0/

====

Files located in the node_modules and vendor directories are externally
maintained libraries used by this software which have their own
licenses; we recommend you read them, as their terms may differ from the
terms above.

### lodash.isnumber@3.0.3 (MIT), lodash.isstring@4.0.1 (MIT)

Copyright 2012-2016 The Dojo Foundation <http://dojofoundation.org/>
Based on Underscore.js, copyright 2009-2016 Jeremy Ashkenas,
DocumentCloud and Investigative Reporters & Editors <http://underscorejs.org/>

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## Google authentication dependency additions

This is the bounded Google source-candidate delta: 15 added package versions,
11 declaring MIT and four declaring Apache-2.0. Each version and license was
checked against its installed `package.json` and bundled license text. The
local installation is flat, with `node-fetch@3.3.2` and
`data-uri-to-buffer@4.0.1` nested under `gaxios`; different top-level versions
were not substituted. No existing package version, inventory, or native notice
is superseded by this appendix. Each of these 15 package versions also appears
exactly once with the same license in the cloud frozen production inventory
identified above. This exact-delta check does not re-audit the unrelated
historical inventory.

### MIT package notices

The complete [common MIT terms](#common-mit-terms) above apply to all 11
packages below together with their following package-specific copyright
notices. Source filenames are relative to each exact package distribution.
The `data-uri-to-buffer` distribution has no separate LICENSE file; its
`README.md` includes the complete MIT license and copyright notice instead.

| Exact package version | Upstream notice source | Copyright notice |
| --- | --- | --- |
| `agent-base@7.1.4` | `LICENSE` | Copyright (c) 2013 Nathan Rajlich &lt;nathan@tootallnate.net&gt; |
| `bignumber.js@9.3.1` | `LICENCE.md` | Copyright © `<2025>` `Michael Mclaughlin` |
| `data-uri-to-buffer@4.0.1` | `README.md`, License section | Copyright (c) 2014 Nathan Rajlich &lt;nathan@tootallnate.net&gt; |
| `extend@3.0.2` | `LICENSE` | Copyright (c) 2014 Stefan Thomas |
| `fetch-blob@3.2.0` | `LICENSE` | Copyright (c) 2019 David Frank |
| `formdata-polyfill@4.0.10` | `LICENSE` | Copyright (c) 2016 Jimmy Karl Roland Wärting |
| `https-proxy-agent@7.0.6` | `LICENSE` | Copyright (c) 2013 Nathan Rajlich &lt;nathan@tootallnate.net&gt; |
| `json-bigint@1.0.0` | `LICENSE` | Copyright (c) 2013 Andrey Sidorov |
| `node-domexception@1.0.0` | `LICENSE` | Copyright (c) 2021 Jimmy Wärting |
| `node-fetch@3.3.2` | `LICENSE.md` | Copyright (c) 2016 - 2020 Node Fetch Team |
| `web-streams-polyfill@3.3.3` | `LICENSE` | Copyright (c) 2024 Mattias Buelens; Copyright (c) 2016 Diwank Singh Tomer |

### Apache-2.0 package notices

| Exact package version | Upstream license source |
| --- | --- |
| `gaxios@7.3.1` | `LICENSE` |
| `gcp-metadata@8.1.2` | `LICENSE` |
| `google-auth-library@10.9.1` | `LICENSE` |
| `google-logging-utils@1.1.3` | `LICENSE` |

These four upstream LICENSE files are byte-identical, each with SHA-256
`cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30`.
Their complete Apache License 2.0 terms, sections 1–9, match the terms already
reproduced under [ecdsa-sig-formatter](#apache-license-2-0-terms)
after whitespace normalization. Those terms are reused here, not the separate
D2L attribution in that package's application example. No separate NOTICE
file was found in these four installed package distributions.

The following copyright notices occur in their distributed JavaScript source
headers and are retained here with each package's identity:

`gaxios@7.3.1`:

```text
Copyright 2018 Google LLC
Copyright 2019 Google LLC
Copyright 2019 Google, LLC
Copyright 2024 Google LLC
```

`gcp-metadata@8.1.2`:

```text
Copyright 2018 Google LLC
Copyright 2022 Google LLC
```

`google-auth-library@10.9.1`:

```text
Copyright 2012 Google LLC
Copyright 2013 Google LLC
Copyright 2014 Google LLC
Copyright 2015 Google LLC
Copyright 2017 Google LLC
Copyright 2018 Google LLC
Copyright 2019 Google LLC
Copyright 2020 Google LLC
Copyright 2021 Google LLC
Copyright 2022 Google LLC
Copyright 2023 Google LLC
Copyright 2024 Google LLC
Copyright 2025 Google LLC
Copyright 2026 Google LLC
```

`google-logging-utils@1.1.3`:

```text
Copyright 2021-2024 Google LLC
Copyright 2022-2024 Google LLC
Copyright 2024 Google LLC
```

```text
Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```
