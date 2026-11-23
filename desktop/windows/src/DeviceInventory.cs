using System;
using System.Collections.Generic;
using System.Management;
using System.Runtime.InteropServices;
using Microsoft.Win32;

namespace McClusterDesktop
{
    // What this device is, in the vocabulary of core/src/compute/protocol.mjs
    // (validateInventory) and of the node agent's hardware_mode states
    // (docs/control-plane/DEVICE-NODES-AND-OWNER-GPU.md). Read-only probes.
    internal sealed class GpuInfo
    {
        public string Name;
        public string Vendor;
        public string Driver;
        public string PnpId;
        public long AdapterRamBytes;
        public bool Ignored;
    }

    internal sealed class DeviceInventory
    {
        public string Hostname;
        public string Platform = "win32";
        public string Arch;
        public int CpuCount;
        public string CpuName;
        public long MemoryBytes;
        public long MemoryFreeBytes;
        public long DiskFreeBytes;
        public string OsVersion;
        public List<GpuInfo> Gpus = new List<GpuInfo>();
        public string ProbeError;

        // Same four states as the node agent. "gpu-verified" needs engine evidence
        // (a model loaded with size_vram > 0), supplied by the caller from Ollama /api/ps.
        public string HardwareMode(bool gpuEvidence)
        {
            if (ProbeError != null) return "unknown";
            bool present = false;
            foreach (GpuInfo gpu in Gpus) if (!gpu.Ignored) present = true;
            if (!present) return "cpu-only";
            return gpuEvidence ? "gpu-verified" : "gpu-present-unverified";
        }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
        private class MEMORYSTATUSEX
        {
            public uint dwLength;
            public uint dwMemoryLoad;
            public ulong ullTotalPhys;
            public ulong ullAvailPhys;
            public ulong ullTotalPageFile;
            public ulong ullAvailPageFile;
            public ulong ullTotalVirtual;
            public ulong ullAvailVirtual;
            public ulong ullAvailExtendedVirtual;
            public MEMORYSTATUSEX() { dwLength = (uint)Marshal.SizeOf(typeof(MEMORYSTATUSEX)); }
        }

        [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool GlobalMemoryStatusEx([In, Out] MEMORYSTATUSEX lpBuffer);

        public static DeviceInventory Read()
        {
            var inv = new DeviceInventory();
            inv.Hostname = Environment.MachineName;
            inv.Arch = Environment.Is64BitOperatingSystem ? "x64" : "x86";
            inv.CpuCount = Environment.ProcessorCount;
            inv.OsVersion = Environment.OSVersion.VersionString;
            try
            {
                using (RegistryKey key = Registry.LocalMachine.OpenSubKey(@"HARDWARE\DESCRIPTION\System\CentralProcessor\0"))
                    if (key != null) inv.CpuName = Convert.ToString(key.GetValue("ProcessorNameString")).Trim();
            }
            catch (Exception) { }
            try
            {
                var status = new MEMORYSTATUSEX();
                if (GlobalMemoryStatusEx(status))
                {
                    inv.MemoryBytes = (long)status.ullTotalPhys;
                    inv.MemoryFreeBytes = (long)status.ullAvailPhys;
                }
            }
            catch (Exception) { }
            try
            {
                string root = System.IO.Path.GetPathRoot(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData));
                inv.DiskFreeBytes = new System.IO.DriveInfo(root).AvailableFreeSpace;
            }
            catch (Exception) { }
            try
            {
                using (var searcher = new ManagementObjectSearcher("SELECT Name, PNPDeviceID, DriverVersion, AdapterRAM FROM Win32_VideoController"))
                using (ManagementObjectCollection results = searcher.Get())
                    foreach (ManagementObject mo in results)
                    {
                        var gpu = new GpuInfo();
                        gpu.Name = Convert.ToString(mo["Name"]);
                        gpu.PnpId = Convert.ToString(mo["PNPDeviceID"]);
                        gpu.Driver = Convert.ToString(mo["DriverVersion"]);
                        object ram = mo["AdapterRAM"];
                        gpu.AdapterRamBytes = ram == null ? 0 : Convert.ToInt64(ram);
                        gpu.Vendor = VendorFromPnp(gpu.PnpId);
                        string name = (gpu.Name ?? "").ToLowerInvariant();
                        // Same exclusions as the node doctor: software and remote adapters are not GPUs.
                        gpu.Ignored = !(gpu.PnpId ?? "").StartsWith("PCI\\", StringComparison.OrdinalIgnoreCase)
                                      || name.Contains("basic display") || name.Contains("remote display") || name.Contains("virtual");
                        inv.Gpus.Add(gpu);
                    }
            }
            catch (Exception ex)
            {
                inv.ProbeError = ex.GetType().Name + ": " + ex.Message;
            }
            return inv;
        }

        private static string VendorFromPnp(string pnp)
        {
            string p = (pnp ?? "").ToUpperInvariant();
            if (p.Contains("VEN_1002")) return "amd";
            if (p.Contains("VEN_10DE")) return "nvidia";
            if (p.Contains("VEN_8086")) return "intel";
            return "unknown";
        }

        public Dictionary<string, object> ToProtocolInventory(bool gpuEvidence)
        {
            var gpus = new List<object>();
            foreach (GpuInfo gpu in Gpus)
            {
                if (gpu.Ignored) continue;
                var g = new Dictionary<string, object>();
                g["vendor"] = gpu.Vendor;
                g["model"] = gpu.Name;
                g["uuid"] = gpu.PnpId == null ? null : "pnp:" + gpu.PnpId;
                g["vram_bytes"] = gpu.AdapterRamBytes;
                g["driver"] = gpu.Driver;
                g["compute"] = gpu.Vendor == "nvidia" ? "cuda" : (gpu.Vendor == "amd" ? "vulkan" : null);
                gpus.Add(g);
            }
            var runtime = new Dictionary<string, object>();
            runtime["kernel"] = OsVersion;
            runtime["hardware_mode"] = HardwareMode(gpuEvidence);
            runtime["cpu"] = CpuName;
            runtime["client"] = "mccluster-desktop/" + typeof(DeviceInventory).Assembly.GetName().Version.ToString(3);
            if (ProbeError != null) runtime["probe_error"] = ProbeError;
            var result = new Dictionary<string, object>();
            result["hostname"] = Hostname;
            result["platform"] = Platform;
            result["arch"] = Arch;
            result["cpu_count"] = CpuCount;
            result["memory_bytes"] = MemoryBytes;
            result["memory_free_bytes"] = MemoryFreeBytes;
            result["disk_free_bytes"] = DiskFreeBytes;
            result["gpus"] = gpus;
            result["runtime"] = runtime;
            return result;
        }
    }
}
