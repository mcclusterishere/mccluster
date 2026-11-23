using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.Globalization;
using System.IO;
using System.Text;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace McClusterDesktop
{
    // Route-by-route parity audit: the shell's WebView2 renders each first-party route at a
    // fixed viewport and records what the site actually did inside the shell (final URL, HTTP
    // status, title, overflow, console errors, blocked navigations) plus a screenshot. A
    // reference capture of the same route at the same revision from a plain browser is diffed
    // against it (ImageDiff). The audit never signs in and never submits anything.
    internal sealed class ParityResult
    {
        public string Route;
        public string FinalUrl;
        public int HttpStatus;
        public bool NavigationOk;
        public string WebErrorStatus;
        public string Title;
        public int ScrollWidth;
        public int ClientWidth;
        public int DocumentHeight;
        public int BlockedNavigations;
        public List<string> ConsoleErrors = new List<string>();
        public string Screenshot;
        public long ElapsedMs;
        public string Error;
    }

    internal sealed class ParityAuditForm : Form
    {
        private readonly WebView2 view = new WebView2();
        private readonly List<string> routes;
        private readonly string outDir;
        private readonly int width;
        private readonly int height;
        private readonly List<ParityResult> results = new List<ParityResult>();
        private readonly TaskCompletionSource<List<ParityResult>> done = new TaskCompletionSource<List<ParityResult>>();
        private int blocked;

        internal ParityAuditForm(List<string> routes, string outDir, int width, int height)
        {
            this.routes = routes;
            this.outDir = outDir;
            this.width = width;
            this.height = height;
            Text = "McCluster parity audit";
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            StartPosition = FormStartPosition.Manual;
            Location = new Point(-32000, -32000); // off screen; WebView2 still renders
            ClientSize = new Size(width, height);
            view.Dock = DockStyle.Fill;
            Controls.Add(view);
            Shown += async delegate { await RunAll(); };
        }

        internal Task<List<ParityResult>> Completion { get { return done.Task; } }

        private async Task RunAll()
        {
            try
            {
                string userData = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "McClusterDesktop", "ParityProfile");
                Directory.CreateDirectory(userData);
                CoreWebView2Environment env = await CoreWebView2Environment.CreateAsync(null, userData, null);
                await view.EnsureCoreWebView2Async(env);
                CoreWebView2 engine = view.CoreWebView2;
                engine.Settings.AreHostObjectsAllowed = false;
                engine.Settings.IsWebMessageEnabled = false;
                engine.Settings.AreDevToolsEnabled = false;
                engine.NavigationStarting += delegate(object s, CoreWebView2NavigationStartingEventArgs evt)
                {
                    Uri dest = NavigationPolicy.HttpsTarget(evt.Uri);
                    if (NavigationPolicy.IsFirstParty(dest)) return;
                    evt.Cancel = true;
                    blocked++;
                };
                engine.NewWindowRequested += delegate(object s, CoreWebView2NewWindowRequestedEventArgs evt) { evt.Handled = true; blocked++; };
                // Same hook on every document: collect console errors and unhandled errors for the record.
                await engine.AddScriptToExecuteOnDocumentCreatedAsync(
                    "window.__mcParityErrors=[];window.addEventListener('error',function(e){window.__mcParityErrors.push(String(e.message||e))});" +
                    "var __ce=console.error;console.error=function(){try{window.__mcParityErrors.push(Array.prototype.map.call(arguments,String).join(' '))}catch(_){}return __ce.apply(console,arguments)};");
                foreach (string route in routes)
                {
                    var r = new ParityResult();
                    r.Route = route;
                    var sw = System.Diagnostics.Stopwatch.StartNew();
                    try
                    {
                        blocked = 0;
                        var tcs = new TaskCompletionSource<CoreWebView2NavigationCompletedEventArgs>();
                        EventHandler<CoreWebView2NavigationCompletedEventArgs> handler = null;
                        handler = delegate(object s, CoreWebView2NavigationCompletedEventArgs evt) { engine.NavigationCompleted -= handler; tcs.TrySetResult(evt); };
                        engine.NavigationCompleted += handler;
                        engine.Navigate(route);
                        Task timeout = Task.Delay(45000);
                        Task finished = await Task.WhenAny(tcs.Task, timeout);
                        if (finished == timeout) { engine.NavigationCompleted -= handler; r.Error = "navigation timeout"; }
                        else
                        {
                            CoreWebView2NavigationCompletedEventArgs evt = tcs.Task.Result;
                            r.NavigationOk = evt.IsSuccess;
                            r.WebErrorStatus = evt.WebErrorStatus.ToString();
                            r.HttpStatus = evt.HttpStatusCode;
                        }
                        await Task.Delay(2500); // let the shell boot scripts settle
                        r.FinalUrl = engine.Source;
                        r.Title = Unquote(await engine.ExecuteScriptAsync("document.title"));
                        r.ScrollWidth = ParseInt(await engine.ExecuteScriptAsync("document.documentElement.scrollWidth"));
                        r.ClientWidth = ParseInt(await engine.ExecuteScriptAsync("document.documentElement.clientWidth"));
                        r.DocumentHeight = ParseInt(await engine.ExecuteScriptAsync("document.documentElement.scrollHeight"));
                        string errors = await engine.ExecuteScriptAsync("JSON.stringify(window.__mcParityErrors||[])");
                        object parsed = Json.Parse(Unquote(errors));
                        var list = parsed as System.Collections.IList;
                        if (list != null) foreach (object e in list) r.ConsoleErrors.Add(Convert.ToString(e));
                        r.BlockedNavigations = blocked;
                        string file = Path.Combine(outDir, SafeName(route) + ".webview2.png");
                        using (FileStream fs = File.Create(file)) await engine.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, fs);
                        r.Screenshot = file;
                    }
                    catch (Exception ex) { r.Error = ex.GetType().Name + ": " + ex.Message; }
                    r.ElapsedMs = sw.ElapsedMilliseconds;
                    results.Add(r);
                }
                done.TrySetResult(results);
            }
            catch (Exception ex)
            {
                done.TrySetException(ex);
            }
            Close();
        }

        internal static string SafeName(string route)
        {
            Uri u;
            string s = Uri.TryCreate(route, UriKind.Absolute, out u) ? (u.Host + u.AbsolutePath + u.Query) : route;
            var sb = new StringBuilder();
            foreach (char c in s) sb.Append(char.IsLetterOrDigit(c) ? c : '_');
            string name = sb.ToString().Trim('_');
            return name.Length == 0 ? "root" : (name.Length > 80 ? name.Substring(0, 80) : name);
        }

        private static string Unquote(string json)
        {
            object v = Json.Parse(json);
            return v == null ? "" : Convert.ToString(v, CultureInfo.InvariantCulture);
        }

        private static int ParseInt(string json)
        {
            double d;
            return double.TryParse((json ?? "0").Trim('"'), NumberStyles.Any, CultureInfo.InvariantCulture, out d) ? (int)d : 0;
        }
    }

    // Pixel comparison of two same-size PNGs: per-channel tolerance, percentage of differing
    // pixels, and a diff image with differences in red.
    internal static class ImageDiff
    {
        public static Dictionary<string, object> Compare(string aPath, string bPath, string diffPath, int tolerance)
        {
            var result = new Dictionary<string, object>();
            using (var a = new Bitmap(aPath)) using (var b = new Bitmap(bPath))
            {
                int w = Math.Min(a.Width, b.Width), h = Math.Min(a.Height, b.Height);
                result["a_size"] = a.Width + "x" + a.Height;
                result["b_size"] = b.Width + "x" + b.Height;
                result["same_size"] = a.Width == b.Width && a.Height == b.Height;
                long differing = 0;
                using (var diff = new Bitmap(w, h, PixelFormat.Format24bppRgb))
                {
                    for (int y = 0; y < h; y++)
                        for (int x = 0; x < w; x++)
                        {
                            Color pa = a.GetPixel(x, y), pb = b.GetPixel(x, y);
                            bool differs = Math.Abs(pa.R - pb.R) > tolerance || Math.Abs(pa.G - pb.G) > tolerance || Math.Abs(pa.B - pb.B) > tolerance;
                            if (differs) differing++;
                            diff.SetPixel(x, y, differs ? Color.Red : Color.FromArgb(pa.R / 3 + 170, pa.G / 3 + 170, pa.B / 3 + 170));
                        }
                    if (diffPath != null) diff.Save(diffPath, ImageFormat.Png);
                }
                long total = (long)w * h;
                result["compared_pixels"] = total;
                result["differing_pixels"] = differing;
                result["differing_percent"] = total == 0 ? 0 : Math.Round(differing * 100.0 / total, 3);
                result["tolerance"] = tolerance;
                result["diff_image"] = diffPath;
            }
            return result;
        }
    }
}
