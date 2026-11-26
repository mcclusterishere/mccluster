EquityNet __VERSION__ (private x64 build), by McCluster Corp

What it is
  EquityNet is the McCluster compute network client (formerly "McCluster
  for Windows"): a standalone Windows desktop window for
  https://mccluster.org/ with a native Compute panel (Proof Mode). It loads the live service, not an
  offline copy. It does not enroll this computer as an inference worker
  and adds no background services.

What it needs
  Windows 10/11 x64, .NET Framework 4.8, the Microsoft Edge WebView2
  Evergreen runtime, and an internet connection for the site. Local jobs
  in the Compute panel work without the internet. Microsoft runtime info:
  https://learn.microsoft.com/microsoft-edge/webview2/concepts/distribution

Install and open
  Run the setup; it installs for this user only under
  %LOCALAPPDATA%\McClusterDesktop\App, adds a Start Menu shortcut and an
  entry in Installed apps, and asks for no admin privileges. This build is
  not publisher-signed; do not override any warning or organization policy
  (Smart App Control may block an unsigned setup). A signed build is needed
  for normal distribution.

Sign-in
  The window opens the live site and does not add a separate account.
  Social sign-in opens the website in your normal browser instead. That
  browser session does not unlock the desktop window.

Proof Mode
  Local jobs run on this computer only (a node adapter or Ollama on
  loopback). Each job writes a receipt under %LOCALAPPDATA%\McClusterDesktop
  signed by this device's own key; see PROOF-MODE.md in the source.

Remove
  Close the app, then remove EquityNet from Windows Installed apps, or run
  Uninstall.exe in the install folder. Uninstall keeps the WebView2
  profile, jobs, receipts and keys under %LOCALAPPDATA%\McClusterDesktop.
