/* One account joins the network profile and the music shelf. Only the
   immutable account ID, or a catalogue-owned explicit handle, is a join key. */
(function (w) {
  "use strict";
  const d = w.document;
  const ID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
  const HANDLE = /^[a-z0-9][a-z0-9._-]{2,63}$/;
  const SB = "https://zmnhbrjyhxzhkxmhkexs.supabase.co/rest/v1/";
  const KEY = "sb_publishable_kr5NujBZ1n518IUMDoa2dQ_tqQAJef4";
  const renderEpoch = new WeakMap();
  let albums;
  const catalog = () => albums || (albums = fetch("data/albums.json").then(r => {
    if (!r.ok) throw Error("Catalogue unavailable");
    return r.json();
  }).catch(() => { albums = null; return null; }));
  const slug = v => String(v || "").toLowerCase();
  function element(tag, value) {
    const node = d.createElement(tag);
    if (value) node.textContent = value;
    return node;
  }
  function link(href, label) {
    const a = element("a", label);
    a.href = href;
    return a;
  }
  function begin(host) {
    const token = {};
    renderEpoch.set(host, token);
    host.hidden = true;
    host.replaceChildren();
    return () => host.isConnected && renderEpoch.get(host) === token;
  }
  function heading(text) { return element("h2", text); }
  function exactCatalogue(doc, handle) {
    if (!HANDLE.test(handle)) return null;
    const hits = (doc?.artists || []).filter(a => a.kind === "person" && slug(a.handle) === handle);
    return hits.length === 1 ? hits[0] : null;
  }
  async function publicMusic(path) {
    const r = await fetch(SB + path, { headers: { apikey: KEY, authorization: "Bearer " + KEY }, credentials:"omit" });
    if (!r.ok) return [];
    const value = await r.json();
    return Array.isArray(value) ? value : [];
  }
  async function showMusic(host, person) {
    if (!host) return false;
    const live = begin(host);
    const uid = String(person?.profile?.m_uid || "");
    const handle = slug(person?.identity?.mccluster_id);
    if (!ID.test(uid) || !HANDLE.test(handle)) return false;
    const [data, creators] = await Promise.all([
      catalog(),
      publicMusic("music_creator_profiles?m_uid=eq." + uid + "&status=eq.active&select=m_uid,handle,artist_name&limit=2").catch(() => [])
    ]);
    const c = creators.length === 1 && creators[0].m_uid === uid && HANDLE.test(slug(creators[0].handle)) ? creators[0] : null;
    const trackList = c ? await publicMusic("creator_tracks?m_uid=eq." + uid +
      "&status=eq.published&select=id,m_uid,title,status&order=published_at.desc&limit=8").catch(() => []) : [];
    if (!live()) return false;
    const a = exactCatalogue(data, c ? slug(c.handle) : handle);
    const credits = a && w.MCC_CREDITS ? w.MCC_CREDITS.appearances(data, a.slug) : {};
    const creditRows = new Map();
    [["own","Artist"],["featured","Featured"],["produced","Producer"],["other","Credited"]].forEach(([key,role]) => {
      (credits[key] || []).forEach(({album,track}) => {
        const dest = "album.html?album=" + encodeURIComponent(album.slug) + "&t=" + encodeURIComponent(track.title);
        const row = creditRows.get(dest) || {title:track.title, roles:[], album:album.name};
        row.roles.push(role); creditRows.set(dest,row);
      });
    });
    const list = element("ul");
    const artistHref = c ? "music-creator.html?handle=" + encodeURIComponent(c.handle) : "";
    trackList.filter(t => t.m_uid === uid && t.status === "published" && ID.test(String(t.id || "")) && typeof t.title === "string").forEach(t => {
      const li = element("li");
      li.append(link(artistHref + "#release-" + encodeURIComponent(t.id),t.title),element("small","Release"));
      list.append(li);
    });
    Array.from(creditRows).slice(0,8).forEach(([dest,row]) => {
      const li = element("li");
      li.append(link(dest,row.title),element("small",row.album + " · " + row.roles.join(" / ")));
      list.append(li);
    });
    if (!list.childElementCount) return false;
    host.append(heading("Music"),list);
    if (artistHref) host.append(link(artistHref,"View all releases"));
    if (creditRows.size) host.append(link("artist.html?artist=" + encodeURIComponent(a.slug),"All catalogue credits"));
    host.hidden = false;
    return true;
  }
  async function showProfile(host, uid, explicitHandle) {
    if (!host) return;
    const live = begin(host);
    const id = String(uid || ""), h = slug(explicitHandle);
    const auth = w.MCC?.session?.()?.access_token;
    let record = null;
    if (auth && w.MCC?.api && (ID.test(id) || HANDLE.test(h))) {
      try {
        const r = await w.MCC.api("/v1/mnet/people/" + encodeURIComponent(ID.test(id) ? id : h));
        const b = r.ok ? await r.json() : null;
        if (b?.profile && (ID.test(id) ? b.profile?.m_uid === id : slug(b.identity?.mccluster_id) === h)) record = b;
      } catch {}
    }
    if (!live()) return;
    const handle = slug(record?.identity?.mccluster_id);
    if (!record || !HANDLE.test(handle)) {
      // A curated handle can name an already-published front; never probe a
      // creator's display name or user-editable alias as an account handle.
      if (auth || !HANDLE.test(h)) return;
      try {
        const r = await fetch("https://api.mccluster.org/v1/fronts/" + encodeURIComponent(h), {credentials:"omit"});
        const p = r.ok ? await r.json() : null;
        if (!live() || !p?.ok || p.handle !== h || !p.config) return;
        host.append(heading("Profile"),element("strong",p.name || "@" + h));
        if (p.headline) host.append(element("p",p.headline));
        host.append(link("front.html?u=" + encodeURIComponent(h),"Open public front page"));
        host.hidden = false;
      } catch {}
      return;
    }
    const p = record.profile;
    host.append(heading("Profile"),element("strong",p.display_name || record.identity.display_name || "@" + handle));
    if (p.headline) host.append(element("p",p.headline));
    if (p.bio) host.append(element("p",p.bio));
    host.append(link("member-front.html?handle=" + encodeURIComponent(handle) + "&card=1","@" + handle + " · Full profile"));
    const social = link("mnet.html?profile=" + encodeURIComponent(handle),"Open on Equity Uprise");
    social.className = "creator-action-network";
    host.append(social);
    host.hidden = false;
  }
  function clear(host) { if (host) begin(host); }
  w.MCC_PROFILE_MUSIC = { showMusic, showProfile, clear, exactCatalogue };
})(window);
