# McCluster Control as an installed browser app

This change offers a separate `McCluster Control` web-app identity launched at `control.html`. It reuses supplied icons, the existing service worker and authenticated Control surface. The album's existing HERE app/manifest is unchanged. No program is installed by this PR.

After deployment, on a Windows PC with current Edge or Chrome:
1. Open the actual Control URL at https://matthew.mccluster.org/control.html.
2. Use the browser's install-app action, if offered, to add McCluster Control. On Edge this may be under Apps; browser wording varies.
3. Sign in normally. Pin the installed window to the taskbar if desired.
4. Close and reopen it; verify the installed app launches Control, then check authentication and saved data.

This is a browser-backed window, not an executable native editor or local AI engine. Sign-in, canonical saved data, Core jobs and hosted providers need an internet connection. A cached shell is not an accepted job, and this change adds no offline private-data cache or background computation. It does not make Atlas model weights downloadable or CUDA usable on an integrated AMD GPU.

Release acceptance: exact deployed manifest and icon response types/dimensions; desktop installation and relaunch; authenticated owner gate; expired session/revocation; online saves and reload; disconnected-state messaging. Physical Windows installation is not verified by source tests. Existing cross-origin owner-session issues remain independently tracked, not solved by installation.
