using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Text;
using System.Threading.Tasks;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace McClusterDesktop
{
    internal sealed partial class OwnerChatTransport
    {
        internal OwnerChatTransport(WebView2 view) : this(new OwnerChatWebView(view)) { }
    }

    // The site owns the authenticated API call. Native can invoke bounded
    // chat operations only, on the top-level owner page, through its versioned facade.
    internal sealed class OwnerChatWebView : IOwnerChatPage
    {
        private readonly WebView2 view;
        internal OwnerChatWebView(WebView2 view) { this.view = view; }

        private static InvalidOperationException Unavailable()
        {
            return new OwnerChatAuthorityException("Open the owner workspace in EquityNet, sign in there, then refresh the chat targets.");
        }

        private static string ErrorText(string code)
        {
            if (code == "OWNER_REQUIRED") return "Sign in as the house owner in EquityNet to use this route.";
            if (code == "CHANGED") return "The signed-in workspace changed. Refresh the chat targets.";
            if (code == "UNSUPPORTED") return "This owner workspace does not yet support native pinned chat.";
            if (code == "REJECTED") return "The owner workspace refused this request. Check the selected worker and model.";
            return "The owner chat operation is unavailable. Reconnect to check the saved turn.";
        }

        private static string FixedCall(string requestId, string operation, string payload, bool begin)
        {
            // Only a fresh GUID, a fixed operation name, and base64-encoded UTF-8
            // JSON enter the source. No conversation text is parsed as JavaScript.
            string call = begin
                ? "api.begin('" + requestId + "','" + operation + "',JSON.parse(new TextDecoder().decode(Uint8Array.from(atob('" + payload + "'),function(c){return c.charCodeAt(0)}))))"
                : "api.take('" + requestId + "')";
            return "(function(){try{if(window!==window.top||location.href!=='https://mccluster.org/control.html#home:ask')return {status:'error',code:'CHANGED'};" +
                "var api=window.McClusterOwnerChatV1;if(!api||typeof api.begin!=='function'||typeof api.take!=='function')return {status:'error',code:'UNSUPPORTED'};" +
                "return " + call + ";}catch(e){return {status:'error',code:'UNAVAILABLE'};}})()";
        }

        public async Task<Dictionary<string, object>> RequestAsync(OwnerChatOperation operation, Dictionary<string, object> arguments)
        {
            CoreWebView2 engine = view.IsDisposed ? null : view.CoreWebView2;
            if (engine == null || engine.Source != NavigationPolicy.OwnerChat || engine.Settings.AreHostObjectsAllowed || engine.Settings.IsWebMessageEnabled) throw Unavailable();
            string name;
            switch (operation)
            {
                case OwnerChatOperation.Discover: name = "discover"; break;
                case OwnerChatOperation.Submit: name = "submit"; break;
                case OwnerChatOperation.Get: name = "get"; break;
                case OwnerChatOperation.History: name = "history"; break;
                case OwnerChatOperation.Stop: name = "stop"; break;
                default: throw Unavailable();
            }
            string payload = Convert.ToBase64String(Encoding.UTF8.GetBytes(Json.Compact(arguments)));
            string id = Guid.NewGuid().ToString("D");
            bool changed = false, begin = true;
            EventHandler<CoreWebView2NavigationStartingEventArgs> nav = delegate { changed = true; };
            EventHandler<CoreWebView2SourceChangedEventArgs> source = delegate { changed = true; };
            engine.NavigationStarting += nav;
            engine.SourceChanged += source;
            try
            {
                var timer = Stopwatch.StartNew();
                while (timer.ElapsedMilliseconds < 35000)
                {
                    if (changed || view.IsDisposed || engine != view.CoreWebView2 || engine.Source != NavigationPolicy.OwnerChat) throw Unavailable();
                    string text;
                    try
                    {
                        Task<string> read = engine.ExecuteScriptAsync(FixedCall(id, name, payload, begin));
                        if (await Task.WhenAny(read, Task.Delay(5000)) != read) throw new TimeoutException();
                        text = await read;
                    }
                    catch (TimeoutException) { throw new InvalidOperationException("The owner workspace has not confirmed the operation. Reconnect to check the same turn."); }
                    catch (Exception) { throw Unavailable(); }
                    if (changed || view.IsDisposed || engine.Source != NavigationPolicy.OwnerChat || text == null || text.Length > 1000000) throw Unavailable();
                    Dictionary<string, object> envelope;
                    try { envelope = Json.Obj(Json.Parse(text)); } catch (Exception) { throw Unavailable(); }
                    string status = Json.Get(envelope, "status") as string;
                    if (status == "error")
                    {
                        string code = Json.Get(envelope, "code") as string;
                        if (code == "OWNER_REQUIRED" || code == "CHANGED" || code == "UNSUPPORTED") throw new OwnerChatAuthorityException(ErrorText(code));
                        throw new InvalidOperationException(ErrorText(code));
                    }
                    if (status == "ok")
                    {
                        var result = Json.Obj(Json.Get(envelope, "result"));
                        if (result == null) throw Unavailable();
                        return result;
                    }
                    if (status != "pending") throw Unavailable();
                    begin = false;
                    await Task.Delay(120);
                }
                throw new InvalidOperationException("Core has not confirmed this request yet. Reconnect to check the same turn.");
            }
            finally
            {
                if (!view.IsDisposed) { engine.NavigationStarting -= nav; engine.SourceChanged -= source; }
            }
        }
    }
}
