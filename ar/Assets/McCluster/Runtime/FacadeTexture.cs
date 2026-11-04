using UnityEngine;

namespace McCluster.AR
{
    /// <summary>
    /// Paints the storefront body as plain rectangles: wall, fascia band in the business colour, shop window,
    /// a dark VHS-ad poster with tracking-error lines, and a door. No artwork, no logo, no mark: words on the
    /// facade are set as text by FacadeSkin, as the city manifest asks ("plain text signs carry the joke").
    /// Region fractions are shared with FacadeSkin so text lands on the right panels.
    /// </summary>
    public static class FacadeTexture
    {
        // Regions as fractions of the facade: x from the left edge, y from the bottom edge.
        public static readonly Rect Fascia = new Rect(0.00f, 0.78f, 1.00f, 0.22f);
        public static readonly Rect Window = new Rect(0.05f, 0.16f, 0.56f, 0.56f);
        public static readonly Rect Poster = new Rect(0.09f, 0.24f, 0.30f, 0.42f);
        public static readonly Rect WindowCard = new Rect(0.42f, 0.24f, 0.16f, 0.42f);
        public static readonly Rect Door = new Rect(0.68f, 0.04f, 0.22f, 0.68f);
        public static readonly Rect DoorGlass = new Rect(0.71f, 0.32f, 0.16f, 0.34f);
        public static readonly Rect KickPlate = new Rect(0.00f, 0.00f, 1.00f, 0.04f);

        static readonly Color32 Wall = new Color32(0x2b, 0x24, 0x20, 0xff);
        static readonly Color32 Trim = new Color32(0x14, 0x12, 0x10, 0xff);
        static readonly Color32 Glass = new Color32(0x61, 0x75, 0x7a, 0xff);
        static readonly Color32 DoorColor = new Color32(0x1a, 0x17, 0x15, 0xff);
        static readonly Color32 DoorGlassColor = new Color32(0x52, 0x66, 0x6b, 0xff);
        static readonly Color32 PosterColor = new Color32(0x10, 0x10, 0x10, 0xff);
        static readonly Color32 Tracking = new Color32(0x8a, 0x8a, 0x8a, 0xff);

        /// <summary>Texture at ~100 px per meter, capped at 1024 on the long side.</summary>
        public static Texture2D Paint(Vector2 facadeMeters, Color businessColor)
        {
            float scale = Mathf.Min(100f, 1024f / Mathf.Max(facadeMeters.x, facadeMeters.y));
            int w = Mathf.Max(64, Mathf.RoundToInt(facadeMeters.x * scale));
            int h = Mathf.Max(64, Mathf.RoundToInt(facadeMeters.y * scale));
            var px = new Color32[w * h];
            Fill(px, w, h, new Rect(0, 0, 1, 1), Wall);
            Fill(px, w, h, KickPlate, Trim);
            Fill(px, w, h, Fascia, businessColor);
            Fill(px, w, h, new Rect(Fascia.x, Fascia.y, Fascia.width, 0.015f), Trim);
            Fill(px, w, h, Inflate(Window, 0.012f), Trim);
            Fill(px, w, h, Window, Glass);
            Fill(px, w, h, Inflate(Poster, 0.008f), Trim);
            Fill(px, w, h, Poster, PosterColor);
            Fill(px, w, h, WindowCard, businessColor);
            Fill(px, w, h, Door, DoorColor);
            Fill(px, w, h, DoorGlass, DoorGlassColor);

            // VHS tracking error: a few broken horizontal lines across the lower poster.
            var rng = new System.Random(1990);
            for (int i = 0; i < 6; i++)
            {
                float y = Poster.y + Poster.height * (0.08f + 0.05f * i + (float)rng.NextDouble() * 0.02f);
                float x = Poster.x + Poster.width * (float)rng.NextDouble() * 0.3f;
                float len = Poster.width * (0.4f + (float)rng.NextDouble() * 0.6f);
                Fill(px, w, h, new Rect(x, y, Mathf.Min(len, Poster.xMax - x), 0.004f), Tracking);
            }

            var tex = new Texture2D(w, h, TextureFormat.RGBA32, false) { name = "FacadeBody", wrapMode = TextureWrapMode.Clamp, filterMode = FilterMode.Bilinear };
            tex.SetPixels32(px);
            tex.Apply(false, true);
            return tex;
        }

        static Rect Inflate(Rect r, float by) => new Rect(r.x - by, r.y - by, r.width + 2 * by, r.height + 2 * by);

        static void Fill(Color32[] px, int w, int h, Rect r, Color32 c)
        {
            int x0 = Mathf.Clamp(Mathf.FloorToInt(r.xMin * w), 0, w), x1 = Mathf.Clamp(Mathf.CeilToInt(r.xMax * w), 0, w);
            int y0 = Mathf.Clamp(Mathf.FloorToInt(r.yMin * h), 0, h), y1 = Mathf.Clamp(Mathf.CeilToInt(r.yMax * h), 0, h);
            for (int y = y0; y < y1; y++)
                for (int x = x0; x < x1; x++)
                    px[y * w + x] = c;
        }
    }
}
