# HERE 3D Asset Lab

The Asset Lab turns a reference image into a provider-generated PBR 3D model and gives HERE a browser-based rotating GLB preview. The first provider adapter is Tripo; the browser never receives the Tripo API key.

## What is implemented

- Private browser UI at `/asset-lab.html`.
- Reference upload for PNG, JPEG, and WebP up to 20 MB.
- `POST /api/v1/3d/generate` to create an image-to-3D task.
- `GET /api/v1/3d/tasks/:taskId` to poll normalized task state.
- Tripo v2 OpenAPI adapter with PBR/texturing enabled.
- A rotating `<model-viewer>` GLB object bay with orbit controls and a model download/open action.
- Browser CORS restricted to `ALLOWED_ORIGINS`.
- A separate private `ASSET_LAB_TOKEN` so provider credentials stay server-side.

## One-time activation

1. Create a Tripo API/developer account and create an API key.
2. Add the following server environment variables to the HERE API deployment:

   ```text
   TRIPO_API_KEY=<provider key>
   ASSET_LAB_TOKEN=<private random string of at least 16 characters; 32+ bytes recommended>
   ALLOWED_ORIGINS=https://matthew.mccluster.org
   ```

3. Redeploy the HERE API.
4. Open `https://matthew.mccluster.org/asset-lab.html` after this branch is deployed to the site.
5. Enter the deployed HERE API origin and your private Asset Lab token. The token is kept in page memory only and is not written to localStorage/sessionStorage/cookies.
6. Upload a clean reference and choose texture quality, then create the GLB.

## Security boundary

`TRIPO_API_KEY` belongs only in the API service environment. Do not place it in `asset-lab.html`, GitHub Actions variables that are exposed to the browser, or any client-side bundle. The page sends only the private Asset Lab token to the HERE API as `x-asset-lab-token`.

The current v1 admin token is deliberately simple so the tool can be activated quickly. A later version should replace it with authenticated HERE admin sessions/RBAC. If this page becomes discoverable publicly, retain `noindex` and keep the API authorization requirement in place.

## Output persistence

Provider result URLs should be treated as temporary. V1 lets the operator open/download the GLB immediately. The next backend phase should copy completed GLBs, poster renders, and source references into HERE-controlled object storage (Supabase Storage is already represented in the API configuration) and persist asset metadata in the HERE database.

## Recommended reconstruction input

Hard-surface emblems perform best when the source image is isolated, front-facing, high-resolution, evenly lit, and has an unambiguous silhouette. For exact logos such as the HM/bullet/halo emblem, a future multi-view mode should submit front, three-quarter, side, and back references when the provider supports that workflow.

## Provider abstraction roadmap

Tripo is Provider #1, not a permanent lock-in. Keep the UI contract normalized around task id, status, progress, model URL, preview URL, credits consumed, and error. Additional provider adapters can implement that same contract without rewriting the Asset Lab UI.
