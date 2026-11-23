using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using System.Web.Script.Serialization;

namespace McClusterDesktop
{
    // Minimal JSON helpers over the in-box JavaScriptSerializer (System.Web.Extensions),
    // so the desktop client needs no NuGet package beyond WebView2. Objects are
    // Dictionary<string, object>, arrays are ArrayList/object[], numbers are int/long/decimal/double.
    internal static class Json
    {
        private static JavaScriptSerializer Serializer()
        {
            var s = new JavaScriptSerializer();
            s.MaxJsonLength = 64 * 1024 * 1024;
            s.RecursionLimit = 64;
            return s;
        }

        internal static object Parse(string text)
        {
            if (string.IsNullOrWhiteSpace(text)) return null;
            return Serializer().DeserializeObject(text);
        }

        internal static string Compact(object value)
        {
            return Serializer().Serialize(value);
        }

        internal static string Pretty(object value)
        {
            var sb = new StringBuilder();
            WritePretty(sb, value, 0);
            sb.Append('\n');
            return sb.ToString();
        }

        private static void Indent(StringBuilder sb, int depth)
        {
            for (int i = 0; i < depth; i++) sb.Append("  ");
        }

        private static void WritePretty(StringBuilder sb, object value, int depth)
        {
            if (value == null) { sb.Append("null"); return; }
            var dict = value as IDictionary;
            if (dict != null)
            {
                if (dict.Count == 0) { sb.Append("{}"); return; }
                sb.Append("{\n");
                int n = 0;
                foreach (DictionaryEntry entry in dict)
                {
                    Indent(sb, depth + 1);
                    sb.Append(Quote(Convert.ToString(entry.Key, CultureInfo.InvariantCulture))).Append(": ");
                    WritePretty(sb, entry.Value, depth + 1);
                    if (++n < dict.Count) sb.Append(',');
                    sb.Append('\n');
                }
                Indent(sb, depth);
                sb.Append('}');
                return;
            }
            var str = value as string;
            if (str != null) { sb.Append(Quote(str)); return; }
            if (value is bool) { sb.Append((bool)value ? "true" : "false"); return; }
            var list = value as IEnumerable;
            if (list != null)
            {
                var items = new List<object>();
                foreach (object item in list) items.Add(item);
                if (items.Count == 0) { sb.Append("[]"); return; }
                sb.Append("[\n");
                for (int i = 0; i < items.Count; i++)
                {
                    Indent(sb, depth + 1);
                    WritePretty(sb, items[i], depth + 1);
                    if (i + 1 < items.Count) sb.Append(',');
                    sb.Append('\n');
                }
                Indent(sb, depth);
                sb.Append(']');
                return;
            }
            if (value is DateTime) { sb.Append(Quote(((DateTime)value).ToUniversalTime().ToString("o"))); return; }
            IFormattable formattable = value as IFormattable;
            sb.Append(formattable != null ? formattable.ToString(null, CultureInfo.InvariantCulture) : Quote(value.ToString()));
        }

        internal static string Quote(string text)
        {
            var sb = new StringBuilder("\"");
            foreach (char c in text ?? "")
            {
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        if (c < 0x20) sb.Append("\\u").Append(((int)c).ToString("x4"));
                        else sb.Append(c);
                        break;
                }
            }
            return sb.Append('"').ToString();
        }

        internal static Dictionary<string, object> Obj(object value)
        {
            return value as Dictionary<string, object>;
        }

        internal static object Get(object container, string key)
        {
            var dict = container as IDictionary<string, object>;
            object result;
            if (dict != null && dict.TryGetValue(key, out result)) return result;
            return null;
        }

        internal static string Str(object container, string key)
        {
            object value = Get(container, key);
            return value == null ? null : Convert.ToString(value, CultureInfo.InvariantCulture);
        }

        internal static double Num(object container, string key)
        {
            object value = Get(container, key);
            if (value == null) return 0;
            try { return Convert.ToDouble(value, CultureInfo.InvariantCulture); }
            catch (Exception) { return 0; }
        }

        internal static IList List(object container, string key)
        {
            return Get(container, key) as IList;
        }
    }
}
