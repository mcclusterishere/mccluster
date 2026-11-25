# McCluster for Windows preview 0.1.0

> Historical record. The app is now named EquityNet (see README.md, "Name and compatibility"); this file describes the 0.1.0 preview as it shipped.

Native Windows shell (WinForms/.NET Framework 4.8 + Microsoft WebView2 Evergreen), connected to the canonical live web app. The shell is not a PWA, alternate backend, embedded web copy, or compute-worker installer. It has no remote native-call surface, login bridge, updater, startup action, or admin requirement. The application is x64; NSIS uses its standard x86 setup stub to install that x64 package. The application permits top-level HTTPS navigation only on the canonical company, creator, and legacy World site hosts. DNS validation and exact host matching reject lookalikes, alternative ports, IP literals, URLs with credentials, backslashes, and unsafe schemes. Third-party sites open in the regular browser only after confirmation. Social sign-in falls back to the regular browser without copying tokens; the browser session does not sign into the Windows app. Canonical site routes and API fetches remain web-controlled. A signed release and device smoke test are pending.

## Build locally

- Application: .NET 8 SDK 8.0.428 (Roslyn 4.11.0), .NET Framework x64 target; .NET Framework 4.8 reference assemblies 1.0.3; Microsoft.Web.WebView2 NuGet 1.0.4022.49; runtime is the separately serviced Microsoft Evergreen installation. Download reference assemblies and WebView2 only from nuget.org.
- Installer: NSIS 3.11, no installer plugins beyond NSIS defaults.
- The recorded build used the direct Roslyn invocation in build-linux.sh to avoid this Linux container's restrictions on the .NET SDK's first-run NuGet mutex. The SDK tarball was SHA-512 verified against Microsoft's official release index. The equivalent SDK project file is included for ordinary Windows development.
- For the direct build script, extract tools so the locations in build-linux.sh exist. The project package restore is otherwise the normal NuGet route.
- From Windows with the prerequisites, dotnet build src/McClusterDesktop.csproj -c Release -o package/app builds the app; copy the resulting x64 WebView2Loader.dll from package/app/runtimes/win-x64/native to package/app alongside both managed WebView2 DLLs. Include upstream LICENSE.txt as package/MICROSOFT-WEBVIEW2-LICENSE.txt. Run makensis /WX package/mccluster.nsi.
- To verify the setup in this bundle: Get-FileHash .\McCluster-Windows-x64-Setup-0.1.0.exe -Algorithm SHA256 and compare with SHA256SUMS.txt. A hash does not establish a trusted publisher.

## Acceptance still needed

Use a clean permitted native Windows test system and normal platform protections. Verify user-only install, app launch and rendering, navigation and relaunch, existing same-site email/password session, intended owner path, cross-host handoff, safe external browser behavior, and uninstall. Test social sign-in in the normal browser separately. Do not proceed through Windows warnings or present this as a signed production release.
