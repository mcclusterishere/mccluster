# Licences of the Prime compute build at pinned revisions

Produced 2026-11-23 by a parallel inventory (one agent per dependency, one independent verifier each) from primary sources; verifier disagreement and unverified items are listed at the end. Full per-item evidence (URLs, notes) stays in the owner's evidence packet, not in this public repository. Not legal advice.

# Third-party licence inventory — McCluster Desktop (Windows)

Draft for `desktop/windows/LICENSES.md` and `THIRD-PARTY-NOTICES`. Inventory date: 2026-11-22. Every entry below was read from the primary licence source at the pinned revision by the inventory pass and independently re-checked by a verifier; the "Verifier agreed" column records that result. Not legal advice.

Verdict key: **ok-with-notice** = permitted, a notice must ship with the component; **ok-as-used** = permitted for the current (non-redistributing) use, obligations attach only if the component is later bundled.

## 1. Dependencies

### 1.1 Microsoft.Web.WebView2 NuGet SDK (shipped)

| Name | Pinned revision | Licence | Redistribution terms | Verdict | Confidence | Verifier agreed |
|---|---|---|---|---|---|---|
| Microsoft.Web.WebView2 NuGet SDK (`Microsoft.Web.WebView2.Core.dll`, `Microsoft.Web.WebView2.WinForms.dll`, `WebView2Loader.dll`) | 1.0.4022.49 (nuget.org page confirms the version exists) | BSD-3-Clause (Microsoft-worded three-clause BSD; no SPDX tag from the publisher, identification rests on the licence text) | Binary redistribution permitted with or without modification provided the copyright notice, three conditions and disclaimer are reproduced in the documentation/materials shipped with the distribution; Microsoft's name may not be used to endorse or promote the product. No source offer, no copyleft, no patent clause. | ok-with-notice | verified | Yes |

### 1.2 Microsoft Edge WebView2 Evergreen Runtime (not redistributed)

| Name | Pinned revision | Licence | Redistribution terms | Verdict | Confidence | Verifier agreed |
|---|---|---|---|---|---|---|
| Microsoft Edge WebView2 Evergreen Runtime | 157.0.4341.60 observed on the device (registry `EdgeUpdate\Clients\{F3017226-...}` pv and `msedgewebview2.exe` FileVersion); EULA is undated and not version-specific | `LicenseRef-scancode-ms-edge-webview2` — "Microsoft Software License Terms – Microsoft Edge WebView2 Runtime", proprietary freeware EULA, no SPDX-listed id | As used (installed and serviced by Microsoft Edge Update, OS component on Windows 11, nothing redistributed): nothing required. If the Evergreen Bootstrapper/Standalone Installer or Fixed Version binaries are ever bundled, EULA §2 "Distributable Code" attaches (significant primary functionality, protective flow-down terms, obtain code from Microsoft, indemnify Microsoft, no copyleft licensing of the code, no handing out Microsoft download links) and the §9 SmartScreen / automatic-update notices become mandatory. §4 forbids reverse engineering, removing Microsoft notices, and offering the runtime standalone or as a hosted service. | ok-as-used | verified | Yes (nuance only: ScanCode titles it "Microsoft Edge WebView2 Runtime License"; identifier, category and terms identical) |

### 1.3 Microsoft.NETFramework.ReferenceAssemblies (build-time only)

| Name | Pinned revision | Licence | Redistribution terms | Verdict | Confidence | Verifier agreed |
|---|---|---|---|---|---|---|
| Microsoft.NETFramework.ReferenceAssemblies (meta-package pulling `.net48` 1.0.3) | 1.0.3 (`McClusterDesktop.csproj` line 28, `PrivateAssets="All"`, TargetFramework net48) | MIT (nuspec declares the deprecated `licenseUrl` pointing to microsoft/dotnet LICENSE, "Copyright (c) 2019 Microsoft"; no SPDX `<license>` element) | MIT: if any package content is redistributed, include the copyright and permission notice with all copies. As used (compile-time targeting pack, nothing copied to build output) no obligation is triggered. | ok-as-used | verified | Yes |

### 1.4 NSIS (installer build tool; compiled stub is shipped)

| Name | Pinned revision | Licence | Redistribution terms | Verdict | Confidence | Verifier agreed |
|---|---|---|---|---|---|---|
| NSIS (Nullsoft Scriptable Install System), MUI2 and x64.nsh headers, LZMA compression module | 3.11 (kichik/nsis tag `v311`; `Docs/src/history.but`: "3.11 — Released on March 8th, 2025") | `Zlib AND CPL-1.0 WITH LZMA-exception` — Zlib for NSIS core, headers, plug-ins, docs, graphics; CPL-1.0 with the "SPECIAL EXCEPTION FOR LZMA COMPRESSION MODULE" for the LZMA decoder compiled into the stub because `mccluster.nsi` line 9 uses `SetCompressor /SOLID lzma`; bzip2 module not used | Shipping a compiled installer .exe requires nothing mandatory under zlib/libpng (acknowledgment "appreciated but is not required"; do not claim authorship or misrepresent origin). The CPL-1.0 LZMA module's linking exception permits static/dynamic linking without the linked code becoming subject to CPL-1.0; CPL obligations attach only if the LZMA module files themselves are modified, which they are not. No copyleft reaches the installed payload. | ok-as-used | verified | Yes |

### 1.5 Ollama (owner-installed runtime, called over loopback)

| Name | Pinned revision | Licence | Redistribution terms | Verdict | Confidence | Verifier agreed |
|---|---|---|---|---|---|---|
| Ollama | 0.40.16 (Windows); tag `v0.40.16` = commit `d63b702609c4300a2ca07be2bdb0adb9834725e5` | MIT ("Copyright (c) Ollama") | MIT: include the copyright and permission notice with any redistributed copy. As used (owner-installed, called from `core/src/compute/ollama-adapter.mjs` at `http://127.0.0.1:11434`, nothing shipped) no obligation is triggered. The Windows installer bundles vendor components (CUDA/ROCm libraries) and pulled models carry their own licences; neither is covered by Ollama's MIT. | ok-as-used | verified | Yes |

### 1.6 qwen3-vl:4b (Ollama library tag; pulled on-device)

| Name | Pinned revision | Licence | Redistribution terms | Verdict | Confidence | Verifier agreed |
|---|---|---|---|---|---|---|
| Qwen3-VL 4B (`qwen3-vl:4b`, Q4_K_M, built from the Qwen3-VL-4B-Thinking variant) | manifest digest `sha256:a1b29c246319cdcb1f3842f36d29f198f737c0cf516ba1bcba34b1b974e87980`; licence layer `sha256:7339fa418c9a…` (11355 bytes), local manifest matches the registry byte-for-byte | Apache-2.0 (licence layer is the unmodified Apache-2.0 template with unfilled appendix; upstream HF cards `license: apache-2.0`; no NOTICE file) | Apache-2.0 §4 if weights are redistributed: ship the licence text, mark modified files, retain notices; §6 no Qwen/Alibaba trademark use beyond describing origin. As used (pulled on-device by the end user, not redistributed) nothing is triggered. | ok-as-used | verified | Yes |

### 1.7 qwen3:8b and qwen3-vl:8b (Ollama library tags; node-manifest defaults)

| Name | Pinned revision | Licence | Redistribution terms | Verdict | Confidence | Verifier agreed |
|---|---|---|---|---|---|---|
| Qwen3 8B (`qwen3:8b`, OVH Core default) and Qwen3-VL 8B (`qwen3-vl:8b`, Windows node doctor resident model; the tag is the 8b-thinking build) | Floating Ollama library tags; as of 2026-11-22 `qwen3:8b` → manifest `500a1f067a9f`, `qwen3-vl:8b` → manifest `9cf69da2b16d`. Referenced from `core/node-manifests/ovh-primary.json` and `owner-windows-gpu.json` | Apache-2.0 (Ollama licence blobs and upstream HF `Qwen/Qwen3-8B` LICENSE, appendix "Copyright 2024 Alibaba Cloud"; Qwen3-VL-8B cards `license: apache-2.0`; no NOTICE file) | Apache-2.0 §4 if weights are shipped: licence copy, mark modifications, retain notices, reproduce NOTICE (none exists); §6 trademark limits. Calling a locally installed Ollama model over HTTP (current manifests, executor `http://127.0.0.1:4790`) triggers nothing. Verdict is ok-with-notice because the product may also ship the model. | ok-with-notice | verified | Yes (two citation nits, outcome unchanged: the `qwen3-vl:8b` page now lists licence blob `7339fa418c9a` rather than `832dd9e00a68`, both Apache-2.0; the upstream card is Qwen3-VL-8B-Thinking, not -Instruct) |

### 1.8 @electric-sql/pglite (test-only staging database)

| Name | Pinned revision | Licence | Redistribution terms | Verdict | Confidence | Verifier agreed |
|---|---|---|---|---|---|---|
| @electric-sql/pglite (named by PR #821 `docs/control-plane/OWNER-AI-WORKSPACE.md`; not present in this checkout) | 0.5.17 (GitHub tag `@electric-sql/pglite@0.5.17`; npm 0.5.17) | `Apache-2.0 OR PostgreSQL` (package.json/npm declare Apache-2.0; repo README, LICENSE and POSTGRES-LICENSE state dual licensing at licensee's choice) | Test-only, not shipped: nothing required. If the package or its `dist/` WASM bundle is ever shipped: under Apache-2.0 include the licence (the shipped `/LICENSE` suffices), retain notices, mark modifications (no NOTICE file at this tag); also carry the PostgreSQL License notice for the embedded PostgreSQL (the npm tarball does not ship `POSTGRES-LICENSE`, copy it from the repo tag). Alternatively elect the PostgreSQL License for the whole package. No source offer, no copyleft. | ok-as-used | verified | Yes |

### 1.9 Node.js (device-local runtime)

| Name | Pinned revision | Licence | Redistribution terms | Verdict | Confidence | Verifier agreed |
|---|---|---|---|---|---|---|
| Node.js (runs `core/src/compute/*.mjs`) | v24.22.1 ("2026-10-21, Version 24.22.1 'Krypton' (LTS)") | MIT for Node.js's own code ("Copyright Node.js contributors"); the distribution LICENSE is an aggregate of permissive bundled-component notices (V8 BSD-3, OpenSSL Apache-2.0, ICU Unicode-3.0, libuv MIT, zlib, c-ares MIT, undici MIT, llhttp MIT, nghttp2 MIT, simdjson Apache-2.0, brotli MIT, zstd BSD-3, minimatch BlueOak-1.0.0, npm Artistic-2.0, etc.) | As used (device-local runtime, not redistributed by the desktop client): nothing required. If the node binary is ever bundled (server image, SEA/pkg executable), ship the complete ~158 KB LICENSE file unmodified and treat npm (Artistic-2.0) as a separately licensed bundled tool or strip it. No LGPL/AGPL; the only GPL text covers ICU autoconf build helpers (`aclocal.m4`/`pkg.m4`, `config.guess`, with Autoconf exceptions) that are not part of the runtime binary. | ok-as-used | verified | Yes (caveat: a strict SPDX expression for the binary distribution is MIT AND the bundled permissive licences; top-level MIT is correct) |

### 1.10 Playwright and the Chromium build it installs (owner-only install)

| Name | Pinned revision | Licence | Redistribution terms | Verdict | Confidence | Verifier agreed |
|---|---|---|---|---|---|---|
| Playwright npm package (+ `playwright-core`) and Chromium "Chrome for Testing" | playwright 1.63.0 (`core/windows/mccluster-node.ps1` line 89 `$script:McPlaywrightVersion`; tag `v1.63.0` = commit `1b025d7e…`); Chromium revision 1243 = 153.0.8010.12 per `browsers.json` at the tag | Apache-2.0 (playwright; appendix "Portions Copyright (c) Microsoft Corporation. Portions Copyright 2017 Google Inc."); BSD-3-Clause (Chromium, "Copyright 2015 The Chromium Authors", with Chromium's own third-party notices) | As used (installed only by the owner with `-Browser`, nothing shipped): nothing required. If playwright is ever redistributed: ship the Apache-2.0 text, retain notices including `ThirdPartyNotices.txt` and the `lib/**/*.js.LICENSE` sidecars, mark modifications. If the Chromium binary is ever redistributed: reproduce the Chromium BSD-3 notice plus the build's bundled third-party credits; no endorsement using Google's name. Playwright's separately downloaded ffmpeg helper is LGPL/GPL-licensed and Chromium's internal ffmpeg is LGPL: not shipped here, but redistributing them would carry copyleft obligations. | ok-as-used | verified | Yes |

### 1.11 EXO distributed inference runtime (candidate, not shipped)

| Name | Pinned revision | Licence | Redistribution terms | Verdict | Confidence | Verifier agreed |
|---|---|---|---|---|---|---|
| EXO (exo-explore/exo), candidate for two-Mac model splitting | v1.0.71 = commit `fd707de30b42db4211d15da96b9052e1dc280ed1`, Python package 0.3.70 (PR #821 `MACOS-NODE.md` line 238, `OWNER-AI-DEPLOYMENT-AUDIT-2026-11-22.md` line 126) | Apache-2.0 (root LICENSE at the pinned commit, 11,351 bytes; the only licence/notice file in all 1058 paths; README badge and GitHub `spdx_id` agree; appendix "Copyright 2025 Exo Technologies Ltd") | Apache-2.0 §4 if EXO source or binaries are shipped: include the licence text, retain copyright/attribution notices, mark modified files prominently; §6 no use of the EXO name/marks beyond describing origin. No NOTICE file, so no NOTICE duty. No source offer, no copyleft. Calling a separately installed EXO over its local HTTP API with nothing from the repo shipped triggers no obligation. | ok-with-notice | verified | Yes |

### 1.12 mlx-community/Qwen3.5-27B-4bit and Apple MLX (candidate, not downloaded)

| Name | Pinned revision | Licence | Redistribution terms | Verdict | Confidence | Verifier agreed |
|---|---|---|---|---|---|---|
| mlx-community/Qwen3.5-27B-4bit (pair candidate model, `core/src/compute/pairs.mjs` line 6 `PAIR_MODEL`) and Apple MLX (ml-explore/mlx) | **Not pinned.** Model named by repo id only; `MACOS-NODE.md` line 285 leaves `model_revision` as a placeholder and line 251 says no revision has been verified. HF head at inventory time: `45797d2985a12c55e6473686e9ea91b95e959553`. No MLX version/tag pinned anywhere in PR #821. Licence texts read at `main`, not at a tag. | Apache-2.0 (model weights, inherited via `license_link` from Qwen/Qwen3.5-27B LICENSE, "Copyright 2026 Alibaba Cloud", no custom use restrictions); MIT (MLX, "Copyright © 2023 Apple Inc.", with PocketFFT BSD-style and metal-cpp Apache-2.0 acknowledgments) | Model: if weights are redistributed, include the Apache-2.0 text, retain the Alibaba Cloud copyright and any NOTICE, state modifications; the mlx-community repo ships no LICENSE/NOTICE of its own, so copy from upstream. MLX: if MLX binaries/source are shipped, include the MIT text with the Apple line plus the ACKNOWLEDGMENTS.md third-party notices. Calling an owner-installed runtime requires nothing. Nothing is required for the current state (not downloaded, pair adapter diagnostics-only). | ok-with-notice | **likely** (not verified) | Yes (verifier confirmed licences from live HF/GitHub metadata; notes the MLX check was against `main`, not a pinned tag) |

## 2. Notices to ship

### 2.1 Required now (components actually in the shipped Windows artefacts)

**Microsoft.Web.WebView2 NuGet SDK 1.0.4022.49 (BSD-3-Clause) — required.**
Ship the full licence text verbatim (27 lines, beginning `Copyright (C) Microsoft Corporation. All rights reserved.` and ending with the AS-IS disclaimer). Source: `C:/Users/Mattm/AppData/Local/McClusterDesktop/App/MICROSOFT-WEBVIEW2-LICENSE.txt` (verified identical to https://www.nuget.org/packages/Microsoft.Web.WebView2/1.0.4022.49/License). Status: already satisfied — `desktop/windows/package/mccluster.nsi` line 53 packages `MICROSOFT-WEBVIEW2-LICENSE.txt` alongside `Microsoft.Web.WebView2.Core.dll`, `Microsoft.Web.WebView2.WinForms.dll` and `WebView2Loader.dll`. Keep that line; also reproduce the same text in THIRD-PARTY-NOTICES. Do not use the Microsoft name to promote the product.

**NSIS 3.11 installer stub (Zlib AND CPL-1.0 WITH LZMA-exception) — not legally required; courtesy notice recommended.**
Add to the shipped `README.txt` or THIRD-PARTY-NOTICES:

> This installer was built with NSIS (Nullsoft Scriptable Install System) 3.11, Copyright (C) 1999-2025 Contributors, licensed under the zlib/libpng license; the LZMA compression module is licensed under the Common Public License 1.0 with a linking exception. See https://nsis.sourceforge.io/License

If full text is wanted, copy verbatim from the `COPYING` file at tag `v311` (https://raw.githubusercontent.com/kichik/nsis/v311/COPYING; local copy at `C:\Users\Mattm\AppData\Local\Temp\claude\b98b2d63b572f6e8\03975257-795f-4229-9afc-cb1701dca2c5\scratchpad\nsis-v311\COPYING`): the ZLIB/LIBPNG LICENSE block (lines 19-30) and, because LZMA compression is used, the COMMON PUBLIC LICENSE VERSION 1.0 block plus the SPECIAL EXCEPTION FOR LZMA COMPRESSION MODULE (lines 53-144).

### 2.2 Conditional — nothing to ship today; text to use if the component is ever bundled

**Microsoft Edge WebView2 Runtime** — no notice for the current use. Only if the runtime installer or Fixed Version binaries are ever bundled AND SmartScreen is left enabled, show end users this EULA §9(a) notice verbatim:

> If you do not disable SmartScreen as described in Section 3(b) above, you must provide notice to all users that your software includes Microsoft Defender SmartScreen and collects and sends the end user's information to Microsoft as disclosed in Microsoft's Privacy Statement at https://aka.ms/privacy and the Microsoft Edge Privacy Whitepaper at https://learn.microsoft.com/en-us/microsoft-edge/privacy-whitepaper#smartscreen.

Full EULA for flow-down terms: https://developer.microsoft.com/microsoft-edge/api/eula/webview2. Privacy documentation should mention SmartScreen regardless, if it is not disabled via WebView2 settings.

**Microsoft.NETFramework.ReferenceAssemblies 1.0.3 (MIT)** — only if package contents are shipped (they are not; `PrivateAssets=All`). Text to include verbatim (from https://github.com/microsoft/dotnet/blob/main/LICENSE):

> The MIT License (MIT)
>
> Copyright (c) 2019 Microsoft
>
> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

Optional good practice: list it as a build-time dependency in THIRD-PARTY-NOTICES even though nothing is redistributed.

**Ollama 0.40.16 (MIT)** — only if `ollama.exe` or other Ollama binaries are ever bundled: ship the full LICENSE file verbatim from https://raw.githubusercontent.com/ollama/ollama/v0.40.16/LICENSE (standard MIT, "Copyright (c) Ollama"). Bundling the Windows installer would also pull in the CUDA/ROCm vendor licences, which would need their own entries.

**qwen3-vl:4b (Apache-2.0)** — only if weights are redistributed: include the full Apache License 2.0 text exactly as stored in the model's licence layer (`ollama show qwen3-vl:4b --license`, or https://ollama.com/library/qwen3-vl:4b/blobs/7339fa418c9a, or https://www.apache.org/licenses/LICENSE-2.0.txt). No licensor copyright line or NOTICE ships with the tag; suggested entry:

> Qwen3-VL-4B (Qwen team, Alibaba Cloud) — Licensed under the Apache License, Version 2.0; http://www.apache.org/licenses/LICENSE-2.0

**qwen3:8b and qwen3-vl:8b (Apache-2.0)** — only if weights are shipped inside the product. Include in THIRD-PARTY-NOTICES:

> Qwen3-8B and Qwen3-VL-8B. Copyright 2024 Alibaba Cloud. Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0. Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.

plus a full copy of the Apache-2.0 text from https://huggingface.co/Qwen/Qwen3-8B/raw/main/LICENSE (or the Ollama licence blob `d18a5cc71b84`; both identical Apache-2.0 with the Alibaba Cloud appendix line). (The input's suggested wording says "Qwen3-VL-8B-Instruct"; the verifier found the Ollama tag is the Thinking build, so name the variant actually shipped.)

**@electric-sql/pglite 0.5.17 (Apache-2.0 OR PostgreSQL)** — test-only, not shipped: none. If ever shipped: (1) the Apache License 2.0 text from the package's own `/LICENSE` (identical to the repo root LICENSE at tag `@electric-sql/pglite@0.5.17`), headed e.g. `@electric-sql/pglite - Copyright ElectricSQL contributors - Licensed under the Apache License, Version 2.0`; and (2) the PostgreSQL License notice for the embedded PostgreSQL copied verbatim from https://raw.githubusercontent.com/electric-sql/pglite/@electric-sql/pglite@0.5.17/POSTGRES-LICENSE, which begins `PostgreSQL Database Management System (formerly known as Postgres, then as Postgres95)` / `Portions Copyright (c) 1996-2021, PostgreSQL Global Development Group` / `Portions Copyright (c) 1994, The Regents of the University of California`, followed by its permission and disclaimer paragraphs.

**Node.js v24.22.1 (MIT + aggregate)** — only if a build artefact bundles the node binary: copy the complete LICENSE file verbatim from https://raw.githubusercontent.com/nodejs/node/v24.22.1/LICENSE (about 158 KB; begins `Node.js is licensed for use as follows:` / `Copyright Node.js contributors. All rights reserved.`) into THIRD-PARTY-NOTICES unmodified.

**Playwright 1.63.0 / Chromium 153.0.8010.12** — only if ever shipped: (1) the Apache License 2.0 text from https://raw.githubusercontent.com/microsoft/playwright/v1.63.0/LICENSE together with `ThirdPartyNotices.txt` and every `lib/**/*.js.LICENSE` sidecar from the installed `playwright` and `playwright-core` packages under `<StateRoot>\browser\node_modules`; (2) for Chromium, the BSD-3-Clause notice beginning `Copyright 2015 The Chromium Authors` from https://chromium.googlesource.com/chromium/src/+/refs/tags/153.0.8010.12/LICENSE plus the build's bundled third-party credits. Verify the downloaded archive's own LICENSE/credits files at that time.

**EXO v1.0.71 (Apache-2.0)** — only when EXO files are shipped: copy the full Apache-2.0 text from https://raw.githubusercontent.com/exo-explore/exo/fd707de30b42db4211d15da96b9052e1dc280ed1/LICENSE, headed with the appendix copyright line `Copyright 2025 Exo Technologies Ltd` and the standard boilerplate (`Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0 ...`). Suggested entry:

> exo (https://github.com/exo-explore/exo), v1.0.71, Copyright 2025 Exo Technologies Ltd, licensed under Apache-2.0.

**mlx-community/Qwen3.5-27B-4bit and Apple MLX** — nothing for the current state. If weights are ever shipped: the full Apache License 2.0 text from https://huggingface.co/Qwen/Qwen3.5-27B/raw/main/LICENSE (carries `Copyright 2026 Alibaba Cloud`) plus a line such as:

> Qwen3.5-27B, Copyright 2026 Alibaba Cloud, licensed under the Apache License, Version 2.0; MLX 4-bit conversion by mlx-community (https://huggingface.co/mlx-community/Qwen3.5-27B-4bit)

If MLX is shipped: the MIT text verbatim from https://raw.githubusercontent.com/ml-explore/mlx/main/LICENSE (begins `MIT License / Copyright © 2023 Apple Inc. / Permission is hereby granted, free of charge...`) together with the PocketFFT and metal-cpp notices from https://raw.githubusercontent.com/ml-explore/mlx/main/ACKNOWLEDGMENTS.md. Pin a revision first (see §4).

## 3. Reuse constraints

Nothing in this inventory is forbidden for a proprietary Windows desktop product, and no copyleft reaches the application payload (`McCluster.exe`, the WebView2 DLLs) in the current architecture. The items that are not plain-permissive, or that would become so if the architecture changes, are:

- **Microsoft Edge WebView2 Runtime — proprietary freeware EULA (not open source, no SPDX id).** Fine to call via the SDK on a Microsoft-installed, Microsoft-serviced Evergreen Runtime; nothing is owed. Do NOT bundle the Evergreen Bootstrapper, Standalone Installer or Fixed Version binaries without taking on EULA §2 (significant primary functionality, protective flow-down terms, indemnifying Microsoft, no copyleft licensing of the distributable code, no handing out Microsoft download links) and §9 (SmartScreen and auto-update end-user notices). Do not reverse engineer it, strip Microsoft notices, or expose it as a bare "browser-as-a-service" / standalone hosted offering (§4). The EULA includes US binding arbitration, an "as is" disclaimer and a US$5 damages cap. Windows-only: the macOS build must use another web view.
- **NSIS LZMA module — CPL-1.0 (weak copyleft) WITH the LZMA linking exception.** Because `mccluster.nsi` selects `/SOLID lzma`, the shipped stub contains the CPL-1.0 LZMA decoder. The COPYING exception expressly lets the installer link it without the rest becoming CPL-1.0. Constraint: never modify the LZMA module files themselves; doing so would attach CPL-1.0 source-availability and notice obligations for the module. To remove CPL entirely, switch to `SetCompressor /SOLID zlib` (larger installer). Everything else in NSIS is Zlib.
- **Node.js bundle — npm is Artistic-2.0; ICU tree carries GPL autoconf build scripts.** Irrelevant while Node.js is a device-local runtime. If the node binary is ever bundled, ship the aggregate LICENSE unmodified and treat npm as a separately licensed tool (or strip it); the GPL files are build-time helpers not present in the runtime binary.
- **Playwright/Chromium — LGPL/GPL ffmpeg.** Playwright's separately downloaded ffmpeg helper is LGPL/GPL and Chromium's internal ffmpeg is LGPL. Not shipped here (owner-only `-Browser` install). Redistributing either binary would carry copyleft obligations; keep them out of any shipped artefact.
- **Apache-2.0 items (WebView2 excluded; Qwen models, pglite, EXO, playwright, MLX's metal-cpp) — permissive, but with §4 notice duties on redistribution and §6 trademark limits.** Do not use the Qwen/Alibaba, EXO or Playwright names or marks beyond describing origin. Apache-2.0 §3 grants a patent licence that terminates if you sue over the Work.
- **Model weights are licensed separately from the runtimes.** Ollama's MIT and EXO's Apache-2.0 do not cover the models they load; each model needs its own entry (qwen3:14b in `owner-windows-gpu.json` is not yet inventoried). Model output rights and any Alibaba usage/export policies are outside the licence texts and were not assessed.

### EXO specifically

EXO (exo-explore/exo v1.0.71, commit `fd707de3…`) is Apache-2.0 only: no copyleft, no network-use clause, no source offer, no NOTICE file.

- **Calling it as a separate process** (the current diagnostic pair-adapter pattern: `GET /node_id`, `/state` over EXO's local HTTP API, with EXO installed by the owner and nothing from the repo shipped): permitted with no obligation. The product is not a Derivative Work and no notice is required, though a courtesy entry in THIRD-PARTY-NOTICES is good practice.
- **Linking against or vendoring its code** (bundling EXO source, Python package, Rust/Swift components, dashboard, or binaries in any shipped artefact): permitted under Apache-2.0 §4 provided you (a) ship a copy of the Apache-2.0 licence, (b) retain all copyright, patent, trademark and attribution notices from EXO's source, (c) mark every modified file with a prominent change notice, and (d) do not use the EXO name or marks to imply endorsement (§6). You may license your own additions under any terms, including proprietary; you may not sublicense EXO itself under terms that remove these conditions. Vendoring also drags in EXO's own dependency tree (MLX, mlx-lm and the Python/Rust/Swift packages in `uv.lock`, `Cargo.lock`, `package-lock.json`), none of which has been inventoried; each would need its own entry before shipping.

## 4. Unverified

Every verifier agreed with every claim. One item does not reach "verified" confidence:

- **mlx-community/Qwen3.5-27B-4bit and Apple MLX — confidence "likely"; `pinned_revision_confirmed: false`.** The licence identification (Apache-2.0 for the weights, MIT for MLX) is not in doubt, but it was read at `main` of each source rather than at a pinned revision, and PR #821 pins neither the model commit (`MACOS-NODE.md` line 285 placeholder `<complete 40–64 character model commit>`; line 251 says no revision verified) nor an MLX version. What would verify it: (1) record a 40-character model commit in `MACOS-NODE.md` / the pair config (the HF head at inventory time was `45797d2985a12c55e6473686e9ea91b95e959553`) and re-read the README front matter and the upstream `Qwen/Qwen3.5-27B` LICENSE at that commit; (2) pin an MLX release tag and re-read `LICENSE` and `ACKNOWLEDGMENTS.md` at that tag; (3) when the weights are actually downloaded, confirm the repo still ships no LICENSE/NOTICE of its own so the upstream notice remains the one to copy.

Verified items with pinning caveats that do not change the licence result but should be tightened before the inventory is treated as reproducible:

- **qwen3:8b / qwen3-vl:8b** — "Ollama library tags" are floating; record the manifest digests (`500a1f067a9f`, `9cf69da2b16d`) in the node manifests or a lockfile. `qwen3:14b` (also in `owner-windows-gpu.json`) has no entry and needs one.
- **Microsoft Edge WebView2 Evergreen Runtime** — 157.0.4341.60 is one Stable major behind and will self-update; the EULA is undated and applies regardless, so no re-check is needed on update.
- **Microsoft.NETFramework.ReferenceAssemblies** — identification rests on the nuspec's declared `licenseUrl`; the `.nupkg` was not opened to check for an embedded LICENSE file. Opening it would close that gap.
- **Ollama 0.40.16** — the Windows `OllamaSetup.exe` asset was not individually confirmed on the release page (asset list did not render); the licence is per-repo so the result is unaffected.