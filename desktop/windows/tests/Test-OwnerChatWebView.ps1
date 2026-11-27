#Requires -Version 5.1
# Run the built transport inside a real WebView2 control with an isolated profile.
# Every page response is synthesized in process. No endpoint, account or worker is contacted.
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$AppDir)
$ErrorActionPreference = 'Stop'
if ([Threading.Thread]::CurrentThread.ApartmentState -ne 'STA') { throw 'Run this fixture with powershell.exe -STA.' }
$binDir = (Resolve-Path -LiteralPath $AppDir).Path
$env:PATH = $binDir + ';' + $env:PATH
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--proxy-server=http://127.0.0.1:1 --disable-background-networking --disable-sync --host-resolver-rules="MAP * ~NOTFOUND"'
Add-Type -AssemblyName System.Windows.Forms,System.Drawing
$core = Join-Path $binDir 'Microsoft.Web.WebView2.Core.dll'
$forms = Join-Path $binDir 'Microsoft.Web.WebView2.WinForms.dll'
[Reflection.Assembly]::LoadFrom($core) | Out-Null
[Reflection.Assembly]::LoadFrom($forms) | Out-Null
$bin = [Reflection.Assembly]::LoadFrom((Join-Path $binDir 'McCluster.exe'))

Add-Type -ReferencedAssemblies @($core,$forms,'System.dll','System.Drawing.dll','System.Windows.Forms.dll') -TypeDefinition @'
using System;
using System.IO;
using System.Text;
using Microsoft.Web.WebView2.Core;
public static class OwnerChatFixtureResources {
    public static void Attach(CoreWebView2 engine, string html) {
        engine.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All);
        engine.WebResourceRequested += delegate(object sender, CoreWebView2WebResourceRequestedEventArgs args) {
            var u = new Uri(args.Request.Uri);
            bool serve = args.Request.Method == "GET" && u.GetLeftPart(UriPartial.Path) == "https://mccluster.org/control.html" && u.Query == "";
            args.Response = engine.Environment.CreateWebResourceResponse(new MemoryStream(Encoding.UTF8.GetBytes(serve ? html : "")),
                serve ? 200 : 403, serve ? "OK" : "Blocked", "Content-Type: text/html; charset=utf-8\r\nCache-Control: no-store");
        };
    }
}
'@
$html = @'
<!doctype html><meta charset="utf-8"><title>Owner chat transport fixture</title><button id="fixtureSignIn">Synthetic sign-in</button>
<script>
const session='cc333333-3333-4333-8333-333333333333', node='node_'+'a'.repeat(40), task='aa111111-1111-4111-8111-111111111111';
const result=new Map(), runs=new Map(); let owner=false, substitute=false, submissions=0;
document.getElementById('fixtureSignIn').onclick=()=>{owner=true};
window.McClusterOwnerChatV1={
  begin(id,op,args){
    if(!owner) return {status:'error',code:'OWNER_REQUIRED'};
    if(op!=='discover' && args.session_id!==session) return {status:'error',code:'CHANGED'};
    let response;
    if(op==='discover') response={session_id:session,targets:[{target:'ovh',name:'Fixture CPU',node_id:node,implementation:'qwen3.8b.local',model:'qwen3:8b'}]};
    else if(op==='submit'){
      submissions++; runs.set(args.message_id,args);
      response={thread_id:args.thread_id,turn_id:args.message_id,status:'pending'};
    } else if(op==='get'){
      const saved=runs.get(args.turn_id); if(!saved) return {status:'error',code:'REJECTED'};
      response={thread_id:saved.thread_id,turn_id:saved.message_id,status:'done',target:saved.target,node_id:substitute?'node_'+'b'.repeat(40):saved.node_id,
        implementation:saved.implementation,model:'qwen3:8b',hardware_mode:'cpu-only',compute_task_id:task,node_name:'Fixture CPU',content:saved.content};
    } else return {status:'error',code:'REJECTED'};
    setTimeout(()=>result.set(id,response),40);
    return {status:'pending'};
  },
  take(id){ if(!owner)return {status:'error',code:'OWNER_REQUIRED'};if(!result.has(id))return {status:'pending'};
    const value=result.get(id);result.delete(id);return {status:'ok',result:value}; }
};
</script>
'@

function Wait-Task($task) {
    $timer = [Diagnostics.Stopwatch]::StartNew()
    while (-not $task.IsCompleted) {
        if ($timer.Elapsed.TotalSeconds -gt 55) { throw 'Owner-chat fixture timed out.' }
        [Windows.Forms.Application]::DoEvents()
        Start-Sleep -Milliseconds 15
    }
    if ($task.IsFaulted) { throw $task.Exception.GetBaseException() }
    if ($task.IsCanceled) { throw 'Owner-chat fixture was canceled.' }
    return ,$task.Result
}
function Expect-Refusal([scriptblock]$action, [string]$message) {
    try { & $action | Out-Null } catch { if ($_.Exception.GetBaseException().Message -like $message) { return }; throw }
    throw "Expected a refusal: $message"
}
$flags=[Reflection.BindingFlags]'Public,NonPublic,Instance'
function Read-Value($obj, [string]$field) { $obj.GetType().GetField($field,$flags).GetValue($obj) }
[Windows.Forms.Application]::EnableVisualStyles()
$form = New-Object Windows.Forms.Form
$view = New-Object Microsoft.Web.WebView2.WinForms.WebView2
$form.ShowInTaskbar = $false
$form.StartPosition = 'Manual'
$form.Location = New-Object Drawing.Point(-8000,-8000)
$view.Dock = 'Fill'
$form.Controls.Add($view)
$profile = Join-Path ([IO.Path]::GetTempPath()) ('equitynet-webview-fixture-'+[Guid]::NewGuid().ToString('N'))
try {
    $form.Show()
    $environment = Wait-Task ([Microsoft.Web.WebView2.Core.CoreWebView2Environment]::CreateAsync($null,$profile,$null))
    Wait-Task ($view.EnsureCoreWebView2Async($environment)) | Out-Null
    $engine = $view.CoreWebView2
    $engine.Settings.AreHostObjectsAllowed = $false
    $engine.Settings.IsWebMessageEnabled = $false
    [OwnerChatFixtureResources]::Attach($engine,$html)
    $uri = 'https://mccluster.org/control.html#home:ask'
    $engine.Navigate($uri)
    $wait = [Diagnostics.Stopwatch]::StartNew()
    while ($engine.DocumentTitle -ne 'Owner chat transport fixture') {
        if ($wait.Elapsed.TotalSeconds -gt 20) { throw 'Fixture first-party route did not load.' }
        [Windows.Forms.Application]::DoEvents()
        Start-Sleep -Milliseconds 25
    }
    $transport=[Activator]::CreateInstance($bin.GetType('McClusterDesktop.OwnerChatTransport',$true),$flags,$null,[object[]]@($view),$null)
    Expect-Refusal { Wait-Task ($transport.DiscoverAsync()) } '*Sign in as the house owner*'
    Wait-Task ($engine.ExecuteScriptAsync("document.getElementById('fixtureSignIn').click()")) | Out-Null
    $targets=Wait-Task ($transport.DiscoverAsync())
    if ($targets.Count -ne 1) { throw 'Expected one selected worker.' }
    $target=$targets[0]
    $thread=[Guid]::NewGuid().ToString(); $turn=[Guid]::NewGuid().ToString()
    $text='Test '' " ); window.fixtureInjected=true; // & ' + [char]0x03bb + [char]0x2028 + ' end'
    $accepted=Wait-Task ($transport.SubmitAsync($target,$thread,$turn,$text))
    if ((Read-Value $accepted 'Status') -ne 'pending' -or (Read-Value $accepted 'TurnId') -ne $turn) { throw 'Wrong durable admission.' }
    $answer=Wait-Task ($transport.GetAsync($target,$thread,$turn))
    if ((Read-Value $answer 'Content') -cne $text -or (Read-Value $answer 'NodeId') -ne (Read-Value $target 'NodeId') -or (Read-Value $answer 'HardwareMode') -ne 'cpu-only') { throw 'Wrong verified reply.' }
    $intact=Wait-Task ($engine.ExecuteScriptAsync("!window.fixtureInjected && submissions===1 && location.href==='https://mccluster.org/control.html#home:ask'"))
    if ($intact -ne 'true') { throw 'A prompt was interpreted as navigation or script.' }
    Wait-Task ($engine.ExecuteScriptAsync('substitute=true')) | Out-Null
    Expect-Refusal { Wait-Task ($transport.GetAsync($target,$thread,$turn)) } '*mismatched receipt*'
    Wait-Task ($engine.ExecuteScriptAsync('owner=false')) | Out-Null
    Expect-Refusal { Wait-Task ($transport.GetAsync($target,$thread,$turn)) } '*Sign in as the house owner*'
    Wait-Task ($engine.ExecuteScriptAsync('delete window.McClusterOwnerChatV1')) | Out-Null
    Expect-Refusal { Wait-Task ($transport.DiscoverAsync()) } '*does not yet support*'
    Wait-Task ($engine.ExecuteScriptAsync("history.replaceState(null,'','#home')")) | Out-Null
    Expect-Refusal { Wait-Task ($transport.DiscoverAsync()) } '*Open the owner workspace*'
    Write-Host 'PASS WebView2 synthetic owner flow: signed out, discover, submit once, exact receipt, mismatched lease, sign-out, unsupported page and navigation denial.'
} finally { $view.Dispose(); $form.Dispose() }
