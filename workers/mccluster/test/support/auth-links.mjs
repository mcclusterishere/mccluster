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
