using System.Reflection;
// Product version source of truth for EquityNet. AssemblyVersion and AssemblyFileVersion
// are 0.4.0.0; the three-part form 0.4.0 must match the csproj <Version> and
// package/mccluster.nsi PRODUCT_VERSION. check-version.ps1 and release-gate.ps1 enforce this.
[assembly: AssemblyTitle("EquityNet")]
[assembly: AssemblyDescription("EquityNet: the McCluster compute network client for Windows (devices as workers, local Ollama runs, signed receipts, Proof Mode)")]
[assembly: AssemblyVersion("0.4.0.0")]
[assembly: AssemblyFileVersion("0.4.0.0")]
[assembly: AssemblyProduct("EquityNet")]
[assembly: AssemblyCompany("McCluster Corp")]
