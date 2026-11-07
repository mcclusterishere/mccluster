using UnityEngine;

namespace McCluster.AR
{
    /// <summary>
    /// The on-screen controls, drawn with IMGUI so they need no UI prefab, no EventSystem and no input-module
    /// setup to work on a first device build. Phone first: everything sits inside Screen.safeArea, touch
    /// targets are at least ~9 mm (Apple's 44 pt) on every screen density.
    ///
    ///  - Reality view: ALWAYS visible, in every mode, one tap. Hides every virtual element.
    ///  - Clean capture: off by default; the first tap explains what is saved and asks again.
    ///  - A one-line status: mode and the reason for it, so a fallback never looks like a bug.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class ArHud : MonoBehaviour
    {
        [SerializeField] FacadeSkin facade;
        [SerializeField] CaptureSession capture;
        [SerializeField] McClusterApi api;

        bool m_ConfirmCapture;
        GUIStyle m_Button, m_Label, m_Box;
        float m_Unit;

        void EnsureStyles()
        {
            float dpi = Screen.dpi > 0 ? Screen.dpi : 160f;
            m_Unit = Mathf.Max(48f, dpi * 0.36f); // ~9 mm
            if (m_Button != null) return;
            m_Button = new GUIStyle(GUI.skin.button) { fontSize = Mathf.RoundToInt(m_Unit * 0.32f), wordWrap = true };
            m_Label = new GUIStyle(GUI.skin.label) { fontSize = Mathf.RoundToInt(m_Unit * 0.28f), wordWrap = true };
            m_Label.normal.textColor = Color.white;
            m_Box = new GUIStyle(GUI.skin.box) { fontSize = Mathf.RoundToInt(m_Unit * 0.30f), wordWrap = true, alignment = TextAnchor.UpperLeft };
            m_Box.normal.textColor = Color.white;
        }

        void OnGUI()
        {
            EnsureStyles();
            Rect safe = Screen.safeArea;
            // IMGUI's origin is top-left; safeArea's is bottom-left.
            safe.y = Screen.height - safe.yMax;
            float pad = m_Unit * 0.25f;

            // Status line, top.
            string status = facade != null ? facade.Mode + " - " + facade.Reason : "Loading";
            if (api != null && !string.IsNullOrEmpty(api.Error)) status = api.Error;
            if (!TmpReady()) status = "Text resources missing: Window > TextMeshPro > Import TMP Essential Resources, then rebuild.";
            if (capture != null && capture.IsCapturing) status += "\nCapturing: " + capture.SelectedCount + " frames saved";
            else if (capture != null && !string.IsNullOrEmpty(capture.LastMessage)) status += "\n" + capture.LastMessage;
            GUI.Label(new Rect(safe.x + pad, safe.y + pad, safe.width - 2 * pad, m_Unit * 1.6f), status, m_Label);

            float bw = Mathf.Min(safe.width * 0.45f, m_Unit * 4.2f), bh = m_Unit * 1.2f;
            float by = safe.yMax - bh - pad;

            // Reality view: bottom-right, always drawn.
            if (facade != null)
            {
                string label = facade.RealityViewRequested ? "Show storefront" : "Reality view";
                if (GUI.Button(new Rect(safe.xMax - bw - pad, by, bw, bh), label, m_Button))
                    facade.RealityViewRequested = !facade.RealityViewRequested;
            }

            // Clean capture: bottom-left, explicit opt-in.
            if (capture != null)
            {
                var r = new Rect(safe.x + pad, by, bw, bh);
                if (capture.IsCapturing)
                {
                    if (GUI.Button(r, "Stop capture", m_Button)) capture.StopCapture();
                }
                else if (!m_ConfirmCapture)
                {
                    if (GUI.Button(r, "Clean capture", m_Button)) m_ConfirmCapture = true;
                }
                else
                {
                    float boxH = m_Unit * 3.2f;
                    GUI.Box(new Rect(safe.x + pad, by - boxH - pad, safe.width - 2 * pad, boxH),
                        "Saves camera frames (without the storefront), camera position and your phone's location to THIS PHONE ONLY, for the alignment test. Nothing is uploaded. Delete the captures folder after the pilot.",
                        m_Box);
                    if (GUI.Button(new Rect(safe.x + pad, by, bw * 0.48f, bh), "Start", m_Button)) { capture.StartCapture(true); m_ConfirmCapture = false; }
                    if (GUI.Button(new Rect(safe.x + pad + bw * 0.52f, by, bw * 0.48f, bh), "Cancel", m_Button)) m_ConfirmCapture = false;
                }
            }
        }

        int m_TmpState; // 0 unknown, 1 present, 2 missing
        bool TmpReady()
        {
            if (m_TmpState == 0) m_TmpState = Resources.Load<TMPro.TMP_Settings>("TMP Settings") != null ? 1 : 2;
            return m_TmpState == 1;
        }
    }
}
