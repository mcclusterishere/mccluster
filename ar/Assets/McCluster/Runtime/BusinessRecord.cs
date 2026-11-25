using System;
using System.Collections.Generic;
using UnityEngine;

namespace McCluster.AR
{
    /// <summary>
    /// Mirror of mccluster.ar-business/v1, the snapshot tools/ar/export-business.mjs writes into
    /// StreamingAssets/fictional-city/businesses/&lt;id&gt;.json from core/data/fictional-city/district.v1.json.
    /// Field names match the JSON exactly (JsonUtility is name-based). Nothing here is authored in C#.
    /// </summary>
    [Serializable]
    public sealed class BusinessSnapshot
    {
        public string schema;
        public SnapshotSource source;
        public BusinessFields business;
        public BrandFields brand;
        public List<StaffFields> staff = new List<StaffFields>();
        public List<ItemFields> items = new List<ItemFields>();

        /// <summary>The manifest colour (#rrggbb), or a neutral if it is missing or malformed.</summary>
        public Color BusinessColor
        {
            get
            {
                if (business != null && ColorUtility.TryParseHtmlString(business.color, out var c)) return c;
                return new Color(0.85f, 0.85f, 0.85f);
            }
        }
    }

    [Serializable]
    public sealed class SnapshotSource
    {
        public string path;
        public string publishedUrl;
        public string manifestSchema;
        public string revision;
        public string sha256;
    }

    [Serializable]
    public sealed class BusinessFields
    {
        public string id;
        public string brandId;
        public string name;
        public string category;
        public string tagline;
        public string description;
        public string color;
        public List<string> ads = new List<string>();
        public InteriorFields interior;
        public List<string> staffIds = new List<string>();
        public List<string> itemIds = new List<string>();
    }

    [Serializable]
    public sealed class InteriorFields
    {
        public string style;
        public string description;
    }

    [Serializable]
    public sealed class BrandFields
    {
        public string id;
        public string name;
        public string tagline;
        public string summary;
    }

    [Serializable]
    public sealed class StaffFields
    {
        public string id;
        public string name;
        public string role;
        public string placement;
        public string greeting;
        public string farewell;
    }

    [Serializable]
    public sealed class ItemFields
    {
        public string id;
        public string name;
        public string description;
        public string kind;
        public int price;
    }
}
