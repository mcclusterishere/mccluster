using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Text;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

// Loaded alongside the built application. The authenticated API and model in this
// test are synthetic; the control, restricted page transport and parser are real.
internal static class OwnerChatWebViewProof
{
    private const string Room = "https://mccluster.org/control.html#home:ask";
    private static readonly BindingFlags Fields = BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic;

    [STAThread]
    private static int Main(string[] args)
    {
        int code = 1;
        Application.EnableVisualStyles();
        using (var form = new Form { ShowInTaskbar = false, StartPosition = FormStartPosition.Manual, Location = new Point(-8000, -8000) })
        using (var view = new WebView2 { Dock = DockStyle.Fill })
        {
            form.Controls.Add(view);
            form.Shown += async delegate
            {
                try { await Run(view, args[0], args[1], args[2] == "stack"); code = 0; }
                catch (Exception error) { Console.Error.WriteLine(error.GetBaseException().Message); }
                finally { form.Close(); }
            };
            Application.Run(form);
        }
        return code;
    }

    private static string Field(object item, string name)
    {
        return (string)item.GetType().GetField(name, Fields).GetValue(item);
    }

    private static async Task<object> Invoke(object instance, string method, params object[] args)
    {
        var call = (Task)instance.GetType().GetMethod(method).Invoke(instance, args);
        if (await Task.WhenAny(call, Task.Delay(50000)) != call) throw new Exception("Timeout in " + method);
        await call;
        var property = call.GetType().GetProperty("Result");
        return property == null ? null : property.GetValue(call, null);
    }

    private static async Task Refused(Func<Task<object>> call, string reason)
    {
        try { await call(); }
        catch (InvalidOperationException ex) { if (ex.Message.Contains(reason)) return; throw; }
        throw new Exception("Expected refusal: " + reason);
    }

    private static async Task Run(WebView2 view, string appPath, string fixturePath, bool useWebFacade)
    {
        var profile = Path.Combine(Path.GetTempPath(), "equitynet-webview-fixture-" + Guid.NewGuid().ToString("N"));
        var environment = await CoreWebView2Environment.CreateAsync(null, profile, null);
        await view.EnsureCoreWebView2Async(environment);
        var engine = view.CoreWebView2;
        engine.Settings.AreHostObjectsAllowed = false;
        engine.Settings.IsWebMessageEnabled = false;
        engine.Settings.AreDevToolsEnabled = false;
        byte[] html = File.ReadAllBytes(fixturePath);
        engine.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All);
        engine.WebResourceRequested += delegate(object sender, CoreWebView2WebResourceRequestedEventArgs args)
        {
            var u = new Uri(args.Request.Uri);
            bool serve = args.Request.Method == "GET" && u.GetLeftPart(UriPartial.Path) == "https://mccluster.org/control.html" && u.Query.Length == 0;
            args.Response = environment.CreateWebResourceResponse(new MemoryStream(serve ? html : new byte[0]), serve ? 200 : 403,
                serve ? "OK" : "Blocked", "Content-Type: text/html; charset=utf-8\r\nCache-Control: no-store");
        };
        var loaded = new TaskCompletionSource<bool>();
        engine.NavigationCompleted += delegate(object sender, CoreWebView2NavigationCompletedEventArgs args) { loaded.TrySetResult(args.IsSuccess); };
        engine.Navigate(Room);
        if (await Task.WhenAny(loaded.Task, Task.Delay(20000)) != loaded.Task || !await loaded.Task) throw new Exception("Fixture page did not load.");
        var bin = Assembly.LoadFrom(appPath);
        var transport = Activator.CreateInstance(bin.GetType("McClusterDesktop.OwnerChatTransport", true), Fields, null, new object[] { view }, null);
        await Refused(() => Invoke(transport, "DiscoverAsync"), "Sign in as the house owner");
        await engine.ExecuteScriptAsync("document.getElementById('fixtureSignIn').click()");
        var targets = (System.Collections.IList)await Invoke(transport, "DiscoverAsync");
        if (targets.Count != 1) throw new Exception("Expected one eligible worker.");
        object node = targets[0];
        string session = Field(node, "SessionId"), thread = Guid.NewGuid().ToString(), turn = Guid.NewGuid().ToString();
        string input = "Test '\" ); window.fixtureInjected=true; // " + (char)0x03bb + (char)0x2028 + " end";
        object saved = await Invoke(transport, "SubmitAsync", node, thread, turn, input);
        if (Field(saved, "Status") != "pending" || Field(saved, "TurnId") != turn) throw new Exception("Wrong durable admission.");
        object answer = await Invoke(transport, "GetAsync", node, thread, turn);
        if (Field(answer, "Content") != input || Field(answer, "NodeId") != Field(node, "NodeId") || Field(answer, "HardwareMode") != "cpu-only")
            throw new Exception("The pinned reply did not match its receipt.");
        var threads = (System.Collections.IList)await Invoke(transport, "ListThreadsAsync", session);
        var turns = (System.Collections.IList)await Invoke(transport, "ListTurnsAsync", session, Field(threads[0], "ThreadId"));
        if (Field(turns[0], "TurnId") != turn || Field(turns[0], "Prompt") != input) throw new Exception("Saved turn history differs.");
        if (await engine.ExecuteScriptAsync("!window.fixtureInjected && submissions===1 && location.href==='https://mccluster.org/control.html#home:ask'") != "true") throw new Exception("The input was interpreted as navigation or script.");
        await engine.ExecuteScriptAsync("substitute=true");
        await Refused(() => Invoke(transport, "GetAsync", node, thread, turn), useWebFacade ? "refused this request" : "mismatched receipt");
        string pending = Guid.NewGuid().ToString();
        await Invoke(transport, "SubmitAsync", node, thread, pending, "Stop this synthetic turn.");
        await Invoke(transport, "StopAsync", node, thread, pending);
        if (await engine.ExecuteScriptAsync("Array.from(runs.values()).filter(r=>r.stopped).length===1") != "true") throw new Exception("The pending turn did not stop.");
        await engine.ExecuteScriptAsync("owner=false");
        await Refused(() => Invoke(transport, "GetAsync", node, thread, turn), "Sign in as the house owner");
        await engine.ExecuteScriptAsync("delete window.McClusterOwnerChatV1");
        await Refused(() => Invoke(transport, "DiscoverAsync"), "does not yet support");
        await engine.ExecuteScriptAsync("history.replaceState(null,'','#home')");
        await Refused(() => Invoke(transport, "DiscoverAsync"), "Open the owner workspace");
        Console.WriteLine("PASS WebView2 synthetic owner flow: signed out, discover, submit, exact receipt, history, confirmed stop, mismatched worker, sign-out and navigation denial.");
    }
}
