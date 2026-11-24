# Checks the exact archive embedded in the signed setup. Only recognized, flat payload
# names are ever extracted, into a private throwaway directory on the signing host.
function Get-ReleasePayloadFacts {
  param([IO.Stream]$Embedded, [string]$Dist, [string]$AppDir)
  Add-Type -AssemblyName System.IO.Compression
  $expected = @('McCluster.exe','Microsoft.Web.WebView2.Core.dll','Microsoft.Web.WebView2.WinForms.dll','WebView2Loader.dll','README.txt','MICROSOFT-WEBVIEW2-LICENSE.txt')
  $embeddedHash = (Get-FileHash -InputStream $Embedded -Algorithm SHA256).Hash
  if ($embeddedHash -ne (Get-FileHash -LiteralPath (Join-Path $Dist 'payload.zip')).Hash) {
    throw 'The setup embeds a different payload.zip from the distributed one.'
  }
  $Embedded.Position = 0
  $archive = [IO.Compression.ZipArchive]::new($Embedded, [IO.Compression.ZipArchiveMode]::Read, $true)
  $scratch = Join-Path ([IO.Path]::GetTempPath()) ('mccluster-release-' + [Guid]::NewGuid().ToString('N'))
  try {
    [void][IO.Directory]::CreateDirectory($scratch)
    $allowed = $expected + 'manifest.json'
    if ($archive.Entries.Count -ne $allowed.Count -or @($archive.Entries | Where-Object { $allowed -cnotcontains $_.FullName }).Count) {
      throw 'The setup payload file list differs from the release file list.'
    }
    $manifestEntry = $archive.GetEntry('manifest.json')
    if ($null -eq $manifestEntry) { throw 'The setup payload lacks its manifest.' }
    $reader = [IO.StreamReader]::new($manifestEntry.Open())
    try { $manifest = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
    if ($manifest.schema -ne 'mccluster-install-manifest/1' -or @($manifest.files).Count -ne $expected.Count) { throw 'Invalid setup payload manifest.' }
    foreach ($name in $expected) {
      $entry = $archive.GetEntry($name)
      $record = @($manifest.files | Where-Object { $_.name -ceq $name })
      if ($null -eq $entry -or $record.Count -ne 1 -or $record[0].size -ne $entry.Length) { throw "Invalid payload entry or manifest record for $name." }
      $dest = Join-Path $scratch $name
      $inputFile = $entry.Open()
      try {
        $outputFile = [IO.File]::Open($dest, [IO.FileMode]::CreateNew)
        try { $inputFile.CopyTo($outputFile) } finally { $outputFile.Dispose() }
      } finally { $inputFile.Dispose() }
      $actual = (Get-FileHash -LiteralPath $dest).Hash
      if ($actual -ne $record[0].sha256 -or $actual -ne (Get-FileHash -LiteralPath (Join-Path $AppDir $name)).Hash) { throw "Embedded bytes differ from the manifest or staged file for $name." }
      if ($name -match '\.(exe|dll)$') {
        $facts = Get-SignatureFacts $dest
        $facts.file = "setup/payload.zip/$name"
        $facts.role = if ($name -eq 'McCluster.exe') { 'first-party' } else { 'third-party' }
        $facts
      }
    }
  } finally {
    $archive.Dispose()
    if ([IO.Directory]::Exists($scratch)) { [IO.Directory]::Delete($scratch, $true) }
  }
}
