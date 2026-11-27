#Requires -Version 5.1
# Test the built transport in a fresh WebView2 profile. All responses are in-process fixtures.
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$AppDir, [string]$OwnerDesktopSource)
$ErrorActionPreference = 'Stop'
$binDir = (Resolve-Path -LiteralPath $AppDir).Path
$fixture = Join-Path $PSScriptRoot 'webview'
$checkDir = Join-Path ([IO.Path]::GetTempPath()) ('equitynet-chat-proof-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $checkDir | Out-Null
foreach ($file in @('McCluster.exe','Microsoft.Web.WebView2.Core.dll','Microsoft.Web.WebView2.WinForms.dll','WebView2Loader.dll')) {
    Copy-Item -LiteralPath (Join-Path $binDir $file) -Destination $checkDir
}
$framework = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319'
$executable = Join-Path $checkDir 'OwnerChatWebViewProof.exe'
$references = @('mscorlib.dll','System.dll','System.Core.dll','System.Drawing.dll','System.Windows.Forms.dll') | ForEach-Object { "/r:" + (Join-Path $framework $_) }
$references += @('Microsoft.Web.WebView2.Core.dll','Microsoft.Web.WebView2.WinForms.dll') | ForEach-Object { "/r:" + (Join-Path $checkDir $_) }
& (Join-Path $framework 'csc.exe') /nologo /noconfig /nostdlib+ /warnaserror+ /target:exe /platform:x64 /langversion:5 "/out:$executable" @references (Join-Path $fixture 'OwnerChatWebViewProof.cs')
if ($LASTEXITCODE) { throw 'Could not compile the owner chat fixture.' }
$before = $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
try {
    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--proxy-server=http://127.0.0.1:1 --disable-background-networking --disable-sync --host-resolver-rules="MAP * ~NOTFOUND"'
    $page = Join-Path $fixture 'owner-chat.html'
    $mode = 'native'
    if ($OwnerDesktopSource) {
        $mode = 'stack'
        $source = (Resolve-Path -LiteralPath $OwnerDesktopSource).Path
        $page = Join-Path $checkDir 'owner-chat-stack.html'
        $html = [IO.File]::ReadAllText((Join-Path $fixture 'owner-chat-stack.html')).Replace('/* OWNER_DESKTOP_SOURCE */', [IO.File]::ReadAllText($source))
        [IO.File]::WriteAllText($page, $html)
        Write-Output ("Testing web owner facade " + (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash)
    }
    & $executable (Join-Path $checkDir 'McCluster.exe') $page $mode
    if ($LASTEXITCODE) { throw 'The real WebView2 transport fixture failed.' }
} finally { $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = $before }
