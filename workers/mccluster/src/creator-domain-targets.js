// Domain bindings never grant publication access. Revalidate identity here and
// delegate public visibility/media checks to the canonical publication handler.
const uuid = v => /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v || '');
const fail = () => Object.assign(new Error('This site target is unavailable. Save your own site and retry.'), {status:409});
export async function resolveDomainTarget(owner, input, db) {
  if (!uuid(owner)) throw fail();
  const type = input?.type || 'member_front';
  // Studio is a presentation on managed_projects, not a new identity. We Trust
  // has no activated canonical authorization adapter; neither can be asserted
  // into existence by a browser-supplied type or URL.
  if (type === 'member_front') {
    if (input?.id && input.id !== owner) throw fail();
    const rows = await db(`member_fronts?auth_user_id=eq.${owner}&removed_at=is.null&select=auth_user_id,handle&limit=1`);
    const row = rows?.[0];
    if (!row || row.auth_user_id !== owner || !/^[a-z0-9][a-z0-9._-]{2,39}$/.test(row.handle || '') || (input?.slug && input.slug !== row.handle)) throw fail();
    return {type, id:owner, slug:row.handle};
  }
  if (type === 'managed_project' && uuid(input?.id)) {
    const rows = await db(`managed_projects?id=eq.${input.id}&owner_user_id=eq.${owner}&removed_at=is.null&select=id,owner_user_id,slug&limit=1`);
    const row = rows?.[0];
    if (!row || row.id !== input.id || row.owner_user_id !== owner || !/^[a-z0-9][a-z0-9-]{2,39}$/.test(row.slug || '') || (input.slug && input.slug !== row.slug)) throw fail();
    return {type, id:row.id, slug:row.slug};
  }
  throw fail();
}

export function storedDomainTarget(row) {
  return {type:row.target_type || 'member_front',id:row.target_id || row.auth_user_id,slug:row.handle};
}
