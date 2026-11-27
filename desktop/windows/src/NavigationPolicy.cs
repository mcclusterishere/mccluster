using System;
using System.Collections.Generic;

namespace McClusterDesktop
{
    // Written in the C# 5 subset so the in-box .NET Framework compiler
    // (C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe) and the .NET SDK
    // build the same source. No expression-bodied members, no "?.", no "out var".
    internal static class NavigationPolicy
    {
        internal const string Home = "https://mccluster.org/";
        internal const string OwnerChat = "https://mccluster.org/control.html#home:ask";
        internal const string OwnerProjects = "https://mccluster.org/control.html#create:projects";

        private static readonly HashSet<string> FirstParty = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "mccluster.org",
            "matthew.mccluster.org",
            "humanuprise.com"
        };

        // Native panel actions select a page. All account and turn data stays
        // inside that page's first-party session.
        internal static bool IsPanelDestination(string url)
        {
            return url == Home || url == OwnerChat || url == OwnerProjects;
        }

        internal static Uri HttpsTarget(string text)
        {
            if (string.IsNullOrWhiteSpace(text) || text.Length > 8192 || text.IndexOf('\\') >= 0)
                return null;
            foreach (char c in text)
                if (char.IsControl(c)) return null;

            Uri target;
            if (!Uri.TryCreate(text, UriKind.Absolute, out target) ||
                !string.Equals(target.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase) ||
                !target.IsDefaultPort || !string.IsNullOrEmpty(target.UserInfo) ||
                target.HostNameType != UriHostNameType.Dns)
                return null;
            return target;
        }

        internal static bool IsFirstParty(Uri value)
        {
            return value != null && FirstParty.Contains(value.IdnHost);
        }

        internal static bool IsProviderLogin(Uri value)
        {
            if (value == null) return false;
            string host = value.IdnHost;
            return string.Equals(host, "accounts.google.com", StringComparison.OrdinalIgnoreCase) ||
                   string.Equals(host, "appleid.apple.com", StringComparison.OrdinalIgnoreCase) ||
                   string.Equals(host, "www.facebook.com", StringComparison.OrdinalIgnoreCase) ||
                   string.Equals(host, "twitter.com", StringComparison.OrdinalIgnoreCase) ||
                   string.Equals(host, "x.com", StringComparison.OrdinalIgnoreCase) ||
                   (string.Equals(host, "zmnhbrjyhxzhkxmhkexs.supabase.co", StringComparison.OrdinalIgnoreCase) &&
                    value.AbsolutePath.StartsWith("/auth/", StringComparison.OrdinalIgnoreCase));
        }

        internal static Uri BrowserPage(string current)
        {
            Uri value = HttpsTarget(current);
            if (!IsFirstParty(value)) return new Uri(Home);
            return new Uri(value.GetLeftPart(UriPartial.Path));
        }
    }
}
