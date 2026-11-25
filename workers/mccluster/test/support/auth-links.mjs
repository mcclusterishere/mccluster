/* public.m_auth_user_links as PostgREST answers a filtered read: only the rows
   the in.(…) / eq. filters on auth_user_id and m_uid name. Tests use it so a
   lookup that asks for the wrong pair gets nothing back, as it would live. */
export function linkRows(url, links) {
  const q = new URL(String(url)).searchParams;
  const wanted = (name) => {
    const v = q.get(name) || '';
    const many = /^in\.\((.*)\)$/.exec(v), one = /^eq\.(.*)$/.exec(v);
    return many ? many[1].split(',').map((x) => x.toLowerCase()) : one ? [one[1].toLowerCase()] : null;
  };
  const a = wanted('auth_user_id'), b = wanted('m_uid');
  return links.filter((l) => (!a || a.includes(String(l.auth_user_id).toLowerCase())) && (!b || b.includes(String(l.m_uid).toLowerCase())));
}

/* Rows as PostgREST answers a read with `select=a,b,c`: only the named columns.
   A fake that returns its whole fixture row would hide a query that stopped
   selecting a column the Worker's check needs (owner_m_uid, bucket_id, object_path). */
export function selectedColumns(url, rows) {
  const select = new URL(String(url)).searchParams.get('select');
  if (!select || select === '*') return rows;
  const columns = select.split(',').map((c) => c.trim()).filter(Boolean);
  return rows.map((row) => Object.fromEntries(columns.filter((c) => Object.hasOwn(row, c)).map((c) => [c, row[c]])));
}
