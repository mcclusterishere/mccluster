using System;
using System.IO;
using McClusterDesktop;

internal static class ContributeLedgerTests
{
    static int failures;

    static void Expect(bool condition, string name)
    {
        if (condition) Console.WriteLine(name + ": PASS");
        else { failures++; Console.WriteLine(name + ": FAIL"); }
    }

    static string TempRoot()
    {
        string root = Path.Combine(Path.GetTempPath(), "contribute-panel-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        return root;
    }

    public static int Main()
    {
        string root = TempRoot();
        var missing = ContributeLedger.ReadOptIn(root);
        Expect(missing.OptedIn == false && missing.Present == false, "new state root is opted out");
        Expect(ContributeLedger.ReadBalances(root) == null, "new state root has no balances");

        ContributeLedger.SetOptIn(root, true, "2026-11-25T17:00:00.000Z");
        var on = ContributeLedger.ReadOptIn(root);
        Expect(on.OptedIn && on.Present, "opt-in toggle persists");

        File.WriteAllText(ContributeLedger.BalancesPath(root),
            "{\n  \"schema\": \"mccluster.contribution-balances/v1\",\n  \"account_id\": \"worker-ratio\",\n  \"contributed_micro\": \"9\",\n  \"earned_micro\": \"3\",\n  \"carry_micro\": \"0\",\n  \"available_micro\": \"3\",\n  \"pending_micro\": \"0\"\n}\n");
        var balances = ContributeLedger.ReadBalances(root);
        Expect(balances != null && balances.ContributedMicro == "9" && balances.EarnedMicro == "3", "panel shows contributed and earned units");
        string line = ContributeLedger.FormatLine(balances);
        Expect(line.Contains("Contributed: 9") && line.Contains("Earned: 3"), "format line names both totals");

        ContributeLedger.SetOptIn(root, false, "2026-11-25T17:01:00.000Z");
        Expect(ContributeLedger.ReadOptIn(root).OptedIn == false, "opt-out persists");
        Expect(ContributeLedger.ReadBalances(root).EarnedMicro == "3", "toggling opt-in does not clear balances");

        Console.WriteLine(failures == 0 ? "ContributeLedgerTests: all PASS" : "ContributeLedgerTests: " + failures + " failed");
        return failures == 0 ? 0 : 1;
    }
}
