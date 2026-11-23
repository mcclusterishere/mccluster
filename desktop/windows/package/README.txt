McCluster for Windows 0.1.0 (private x64 preview)

What it is
  A standalone Windows desktop window for https://mccluster.org/.
  It loads the live service, not an offline copy. It does not enroll
  this computer as an inference worker or add background services.

What it needs
  Windows 10/11 x64, .NET Framework 4.8, the Microsoft Edge WebView2
  Evergreen runtime, and an internet connection. Microsoft runtime info:
  https://learn.microsoft.com/microsoft-edge/webview2/concepts/distribution

Install and open
  On a permitted Windows test machine, run the setup, then open McCluster
  from Start. The setup installs for this user only and asks for no admin
  privileges. This preview is not publisher-signed; do not override any
  warning or organization policy. A signed build is needed for normal
  distribution and for any machine that blocks unsigned software.

Sign-in
  The window opens the live site and does not add a separate account.
  Site-based email/password sign-in is intended but not yet Windows-tested.
  Social sign-in opens the website in your normal browser instead. That
  browser session does not unlock the desktop window. The same applies
  when an outside hosted checkout or similar provider must use a browser.

Remove
  Close the app, then remove McCluster from Windows Installed apps.
  Uninstall preserves the WebView2 profile in
  %LOCALAPPDATA%\McClusterDesktop\Profile. Sign out in the app first
  if you intend to leave its local profile behind on a shared machine.

Verification
  Build, payload/installer structure and navigation rules tested
  off-device. Native Windows installation, launch, sign-in, cross-host
  handoff, and uninstall still need to be tested before a release.
