/* Multiple pages per existing M Account. No client-controlled owner, media grant or registry binding. */
import {handleProjectTiles} from './project-tiles.js';
import {siteModuleProjection} from './customer-site-modules.js';
import { reply } from './lib/http.js';
import { validateFront, mediaPrefix, FRONT_MAX_BYTES } from '../../../packages/front-config/index.mjs';
const SLUG = /^[a-z0-9][a-z0-9-]{2,39}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const projectMedia = (env, uid, slug) => mediaPrefix(env.SUPABASE_URL, uid) + 'projects/' + slug + '/';
const RESERVED = new Set(['vaunt','me','new','admin','api','edit']);
export const PROJECTS_PREFIX = '/v1/projects';
export async function handleManagedProjects(request, env, deps = {}) {
  const {fetchImpl = fetch,expectedAuthUserId,expectedProjectId}=deps;
  const tiles=await handleProjectTiles(request,env,deps);if(tiles)return tiles;
  const path = new URL(request.url).pathname.replace(/\/+$/, '');
  if (path !== PROJECTS_PREFIX && !path.startsWith(PROJECTS_PREFIX + '/')) return null;
  function send(body, status = 200) {
    const r = reply(request, env, body, status); r.headers.set('cache-control','private, no-store'); r.headers.set('vary','origin, authorization'); return r;
  }
  function error(message, status, code) { return send({ok:false,error:message,code},status); }
  if (!env?.SUPABASE_URL || !env?.SUPABASE_SERVICE_ROLE_KEY) return error('Project publishing is not configured',503,'unconfigured');
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  async function db(path, init = {}) {
    const r = await fetchImpl(`${env.SUPABASE_URL}/rest/v1/${path}`,{...init,headers:{apikey:key,authorization:`Bearer ${key}`,'content-type':'application/json',prefer:'return=representation',...init.headers}});
    const data = await r.json().catch(()=>null);
    if (!r.ok) throw Object.assign(new Error('Project storage unavailable'),{status:data?.code === '23505' ? 409 : 503});
    return data;
  }
  try {
    const parts = path.slice(PROJECTS_PREFIX.length).split('/').filter(Boolean);
    if (parts.length > 2 || (parts[0] && !SLUG.test(parts[0])) || (parts[1] && !['edit','published'].includes(parts[1]))) return error('Not found',404,'not_found');
    const slug = parts[0];
    const publicRead = slug && !parts[1] && ['GET','HEAD'].includes(request.method);
    if (publicRead) {
      const rows = await db(`managed_projects?slug=eq.${slug}${expectedAuthUserId ? "&owner_user_id=eq."+encodeURIComponent(expectedAuthUserId) : ""}${expectedProjectId ? "&id=eq."+encodeURIComponent(expectedProjectId) : ""}&select=*&limit=1`);
      const row = rows?.[0];
      if (!row) return error('Project not found',404,expectedAuthUserId||expectedProjectId?'project_unavailable':'project_not_found');
      if(row.presentation==='tiles'){
        const target=new URL(request.url);target.pathname+='/tiles/public';
        const response=await handleProjectTiles(new Request(target,{method:'GET',headers:request.headers}),env,{...deps,expectedAuthUserId:row.owner_user_id,expectedProjectId:row.id});
        if(!response.ok)return response;
        return send({ok:true,presentation:'tiles',slug:row.slug,handle:row.slug,name:row.name,published_at:row.studio_published_at,url:'website-studio-view.html?project='+encodeURIComponent(row.slug)});
      }
      if (row.removed_at || !row.published) return error('Project is not public',404,'project_unavailable');
      const profiles = await db(`network_profiles?m_uid=eq.${row.m_uid}&select=visibility&limit=1`);
      if (profiles?.[0]?.visibility !== 'public') return error('Project is not public',404,'project_unavailable');
      const checked = validateFront(row.published,{mediaPrefix:projectMedia(env,row.owner_user_id,row.slug)});
      if (!checked.ok) return error('Project is not public',404,'project_unavailable');
      return send({ok:true,slug:row.slug,handle:row.slug,name:row.name,config:checked.config,published_at:row.published_at,registry_key:row.registry_key || null,site_modules:await siteModuleProjection(env,row.owner_user_id,'project',slug,fetchImpl)});
    }
    const auth = request.headers.get('authorization') || '';
    if (!/^Bearer \S+$/i.test(auth)) return error('Sign in to manage projects',401,'signin');
    const session = await fetchImpl(`${env.SUPABASE_URL}/auth/v1/user`,{headers:{apikey:key,authorization:auth}});
    const user = session.ok ? await session.json() : null;
    if (!UUID.test(user?.id || '')) return error('Sign in to manage projects',401,'signin');
    const links = await db(`m_auth_user_links?auth_user_id=eq.${user.id}&is_primary=eq.true&select=m_uid&limit=1`);
    const mUid = links?.[0]?.m_uid;
    if (!UUID.test(mUid || '')) return error('Complete your M Account first',409,'profile_required');
    const ownerFilter = `owner_user_id=eq.${user.id}&m_uid=eq.${mUid}`;
    const profiles = await db(`network_profiles?m_uid=eq.${mUid}&select=visibility&limit=1`);
    const visibility = profiles?.[0]?.visibility || null;
    const blocker = row => row.removed_at ? 'removed' : !visibility ? 'profile_required' : visibility !== 'public' ? 'private_profile' : null;
    const media = projectMedia(env,user.id,slug);
    const present = row => ({ok:true,id:row.id,slug:row.slug,handle:row.slug,name:row.name,draft:row.draft,published:row.presentation==='tiles'?null:row.published,published_at:row.presentation==='tiles'?null:row.published_at,presentation:row.presentation||'front',updated_at:row.updated_at,removed:!!row.removed_at,media_prefix:projectMedia(env,user.id,row.slug),max_bytes:FRONT_MAX_BYTES,registry_key:row.registry_key || null,profile_visibility:visibility,publicly_available:row.presentation!=='tiles' && !!row.published && !blocker(row),publish_blocker:blocker(row),url:`front.html?project=${row.slug}`});
    if (!slug && request.method === 'GET') {
      const rows = await db(`managed_projects?${ownerFilter}&select=*&order=updated_at.desc`);
      return send({ok:true,projects:(rows || []).map(r=>({id:r.id,slug:r.slug,name:r.name,published_at:r.presentation==='tiles'?r.studio_published_at:r.published_at,updated_at:r.updated_at,removed_at:r.removed_at,presentation:r.presentation||'front'}))});
    }
    async function body() { try { const b = await request.json(); return b && typeof b === 'object' && !Array.isArray(b) ? b : null; } catch { return null; } }
    if (!slug && request.method === 'POST') {
      const b = await body();
      if (!b || !SLUG.test(b.slug || '') || RESERVED.has(b.slug)) return error('Choose an available lowercase project address (3–40 letters, digits or hyphens)',400,'invalid_slug');
      if (typeof b.name !== 'string' || !b.name.trim() || b.name.trim().length > 100) return error('Enter a project name up to 100 characters',400,'invalid_name');
      if (['owner_user_id','m_uid','registry_key','published','removed_at','id','presentation','studio_revision_id','studio_draft_id','studio_org_id'].some(k=>k in b)) return error('Ownership and publication cannot be assigned here',400,'protected_fields');
      const rows = await db('managed_projects',{method:'POST',body:JSON.stringify({slug:b.slug,name:b.name.trim(),owner_user_id:user.id,m_uid:mUid,draft:{schema:'mccluster-front/v1'}})});
      return send(present(rows[0]),201);
    }
    if (!slug) return error('Method not allowed',405,'method');
    const filter = `slug=eq.${slug}&${ownerFilter}`;
    const rows = await db(`managed_projects?${filter}&select=*&limit=1`);
    const row = rows?.[0];
    if (!row) return error('Project not found in your account',404,'not_found');
    if (parts[1] === 'edit' && request.method === 'GET') return send(present(row));
    if (parts[1] === 'edit' && request.method === 'POST') {
      if (row.removed_at) return error('This project is removed',403,'removed');
      const b = await body();
      if (!b || !b.config || typeof b.config !== 'object' || Array.isArray(b.config)) return error('A page configuration is required',400,'invalid_config');
      if (['owner_user_id','m_uid','slug','registry_key','removed_at','published','id','presentation','studio_revision_id','studio_draft_id','studio_org_id'].some(k=>k in b)) return error('Protected project fields cannot be changed',400,'protected_fields');
      if (b.publish === true && blocker(row)) return error('Review your profile visibility before publishing',409,blocker(row));
      const checked = validateFront(b.config,{mediaPrefix:media});
      if (!checked.ok) return error('Page configuration is too large',413,'too_large');
      // Reject stripped media/settings rather than silently publishing incomplete content.
      if (checked.dropped.length) return send({ok:false,error:'Some page settings are invalid or use media you do not own',code:'invalid_settings',dropped:checked.dropped},400);
      const update = {draft:checked.config,updated_at:new Date().toISOString()};
      if (b.publish === true) { if(Object.prototype.hasOwnProperty.call(row,'presentation'))update.presentation='front';update.published=checked.config; update.published_at=update.updated_at; }
      const updated = await db(`managed_projects?${filter}&removed_at=is.null`,{method:'PATCH',body:JSON.stringify(update)});
      if (!updated?.length) return error('Project is no longer editable',409,'changed');
      return send(present(updated[0]));
    }
    if (request.method === 'DELETE' && (!parts[1] || parts[1] === 'published')) {
      const update = {published:null,published_at:null,updated_at:new Date().toISOString()};
      if(row.presentation==='tiles'){update.studio_revision_id=null;update.studio_published_at=null;if(parts[1]){delete update.published;delete update.published_at;}}
      if (!parts[1]) update.removed_at=update.updated_at;
      await db(`managed_projects?${filter}`,{method:'PATCH',body:JSON.stringify(update)});
      return send({ok:true,published:null,removed:!parts[1] || !!row.removed_at});
    }
    return error('Method not allowed',405,'method');
  } catch (e) { return error(e.status === 409 ? 'That project address is already reserved' : 'Project storage is not available. Try again later.',e.status === 409 ? 409 : 503,e.status === 409 ? 'slug_taken' : 'storage_unavailable'); }
}
