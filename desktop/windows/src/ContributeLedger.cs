using System;
using System.Globalization;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;

namespace McClusterDesktop
{
    // Ledger display for the Contribute panel. Same files as
    // desktop/contribute-panel/index.mjs. The desktop never calls the Core;
    // it only reads the state root. A trusted writer (the node doctor, or a
    // local test) records contribution-balances.json from compute_ledger_balances.
    internal static class ContributeLedger
    {
        internal const string ContributeSchema = "mccluster.contribute-panel/v1";
        internal const string BalancesSchema = "mccluster.contribution-balances/v1";
        internal const string ContributeFile = "contribute.json";
        internal const string BalancesFile = "contribution-balances.json";
        internal const int RedemptionRatio = 3;
        internal const string RatioCaption = "3 contributed work units earn 1 spendable unit. Leftover units stay as carry until the next accepted job completes the ratio.";

        internal sealed class OptInState
        {
            public bool OptedIn;
            public string UpdatedAt;
            public bool Present;
        }

        internal sealed class Balances
        {
            public string AccountId;
            public string ContributedMicro;
            public string EarnedMicro;
            public string CarryMicro;
            public string AvailableMicro;
            public string PendingMicro;
            public string UpdatedAt;
            public string Source;
        }

        internal static string ContributePath(string stateRoot)
        {
            if (string.IsNullOrWhiteSpace(stateRoot)) throw new ArgumentException("state root is required");
            return Path.Combine(stateRoot, ContributeFile);
        }

        internal static string BalancesPath(string stateRoot)
        {
            if (string.IsNullOrWhiteSpace(stateRoot)) throw new ArgumentException("state root is required");
            return Path.Combine(stateRoot, BalancesFile);
        }

        internal static OptInState ReadOptIn(string stateRoot)
        {
            string path = ContributePath(stateRoot);
            if (!File.Exists(path)) return new OptInState { OptedIn = false, Present = false };
            var obj = MiniJson.ParseObject(File.ReadAllText(path, Encoding.UTF8));
            string schema = MiniJson.GetString(obj, "schema");
            if (schema != ContributeSchema) throw new InvalidDataException("unknown contribute schema: " + schema);
            return new OptInState
            {
                OptedIn = MiniJson.GetBool(obj, "opted_in"),
                UpdatedAt = MiniJson.GetString(obj, "updated_at"),
                Present = true
            };
        }

        internal static OptInState SetOptIn(string stateRoot, bool optedIn, string now)
        {
            Directory.CreateDirectory(stateRoot);
            string json = "{\n  \"schema\": \"" + ContributeSchema + "\",\n  \"opted_in\": " + (optedIn ? "true" : "false") + ",\n  \"updated_at\": " + MiniJson.Quote(now) + "\n}\n";
            AtomicWrite(ContributePath(stateRoot), json);
            return ReadOptIn(stateRoot);
        }

        internal static Balances ReadBalances(string stateRoot)
        {
            string path = BalancesPath(stateRoot);
            if (!File.Exists(path)) return null;
            var obj = MiniJson.ParseObject(File.ReadAllText(path, Encoding.UTF8));
            string schema = MiniJson.GetString(obj, "schema");
            if (schema != BalancesSchema) throw new InvalidDataException("unknown balances schema: " + schema);
            return new Balances
            {
                AccountId = MiniJson.GetString(obj, "account_id"),
                ContributedMicro = RequireMicro(MiniJson.GetString(obj, "contributed_micro"), "contributed_micro"),
                EarnedMicro = RequireMicro(MiniJson.GetString(obj, "earned_micro"), "earned_micro"),
                CarryMicro = RequireMicro(MiniJson.GetString(obj, "carry_micro") ?? "0", "carry_micro"),
                AvailableMicro = RequireMicro(MiniJson.GetString(obj, "available_micro") ?? "0", "available_micro"),
                PendingMicro = RequireMicro(MiniJson.GetString(obj, "pending_micro") ?? "0", "pending_micro"),
                UpdatedAt = MiniJson.GetString(obj, "updated_at"),
                Source = MiniJson.GetString(obj, "source") ?? "ledger"
            };
        }

        internal static string FormatLine(Balances balances)
        {
            if (balances == null) return "Contributed: (no ledger receipt on this device yet)\r\nEarned: (no ledger receipt on this device yet)";
            return "Account: " + balances.AccountId + "\r\n" +
                   "Contributed: " + balances.ContributedMicro + " micro-units\r\n" +
                   "Earned: " + balances.EarnedMicro + " micro-units\r\n" +
                   "Carry: " + balances.CarryMicro + " micro-units\r\n" +
                   "Available: " + balances.AvailableMicro + " micro-units";
        }

        static string RequireMicro(string value, string name)
        {
            if (value == null || !Regex.IsMatch(value, "^(0|[1-9][0-9]*)$")) throw new InvalidDataException(name + " must be a non-negative integer");
            return value;
        }

        static void AtomicWrite(string path, string contents)
        {
            string tmp = path + ".tmp";
            File.WriteAllText(tmp, contents, new UTF8Encoding(false));
            if (File.Exists(path)) File.Delete(path);
            File.Move(tmp, path);
        }
    }

    internal static class MiniJson
    {
        internal static object ParseObject(string text)
        {
            text = text.Trim();
            if (text.Length == 0 || text[0] != '{') throw new InvalidDataException("not a JSON object");
            var map = new System.Collections.Generic.Dictionary<string, string>(StringComparer.Ordinal);
            foreach (Match m in Regex.Matches(text, "\"([^\"]+)\"\\s*:\\s*(true|false|null|\"((?:\\\\.|[^\"\\\\])*)\"|-?\\d+)"))
            {
                string key = m.Groups[1].Value;
                if (m.Groups[3].Success) map[key] = Unescape(m.Groups[3].Value);
                else if (m.Groups[2].Value == "null") map[key] = null;
                else map[key] = m.Groups[2].Value;
            }
            return map;
        }

        internal static string GetString(object obj, string key)
        {
            var map = (System.Collections.Generic.Dictionary<string, string>)obj;
            string value;
            return map.TryGetValue(key, out value) ? value : null;
        }

        internal static bool GetBool(object obj, string key)
        {
            string value = GetString(obj, key);
            return value == "true";
        }

        internal static string Quote(string value)
        {
            if (value == null) return "null";
            return "\"" + value.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"";
        }

        static string Unescape(string value) { return value.Replace("\\\"", "\"").Replace("\\\\", "\\"); }
    }
}
