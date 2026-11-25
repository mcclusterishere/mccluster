using System;
using System.Globalization;
using System.Drawing;
using System.Windows.Forms;

namespace McClusterDesktop
{
    // Opt-in toggle and contributed/earned unit display, following the
    // EquityNet / Equity Fighter StatusPanel Contribute section. Drop this
    // control into that section when the desktop tree is joined with the
    // contribution ledger. The panel never calls the Core.
    internal sealed class ContributePanel : UserControl
    {
        readonly string stateRoot;
        readonly CheckBox optInBox = new CheckBox();
        readonly Label balancesLabel = new Label();
        readonly Label ratioLabel = new Label();
        readonly Label consentLabel = new Label();

        public ContributePanel(string stateRoot)
        {
            this.stateRoot = stateRoot;
            AutoSize = true;
            optInBox.AutoSize = true;
            optInBox.Text = "Opt in: contribute idle compute from this computer";
            optInBox.CheckedChanged += delegate { if (!suppress) Toggle(); };
            ratioLabel.AutoSize = true;
            ratioLabel.MaximumSize = new Size(380, 0);
            ratioLabel.Text = ContributeLedger.RatioCaption;
            consentLabel.AutoSize = true;
            consentLabel.MaximumSize = new Size(380, 0);
            balancesLabel.AutoSize = true;
            balancesLabel.MaximumSize = new Size(380, 0);
            var layout = new FlowLayoutPanel { FlowDirection = FlowDirection.TopDown, AutoSize = true, WrapContents = false, Dock = DockStyle.Fill };
            layout.Controls.Add(new Label { AutoSize = true, Text = "Contribute (this device as a compute node)", Font = new Font(Font, FontStyle.Bold) });
            layout.Controls.Add(consentLabel);
            layout.Controls.Add(optInBox);
            layout.Controls.Add(ratioLabel);
            layout.Controls.Add(balancesLabel);
            Controls.Add(layout);
            Reload();
        }

        bool suppress;

        public void Reload()
        {
            suppress = true;
            try
            {
                var opt = ContributeLedger.ReadOptIn(stateRoot);
                optInBox.Checked = opt.OptedIn;
                balancesLabel.Text = ContributeLedger.FormatLine(ContributeLedger.ReadBalances(stateRoot));
            }
            finally { suppress = false; }
        }

        void Toggle()
        {
            ContributeLedger.SetOptIn(stateRoot, optInBox.Checked, DateTime.UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture));
            Reload();
        }
    }
}
