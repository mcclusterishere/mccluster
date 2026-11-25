// Reviewed public metadata -> the existing #762 compiler. No news ingestion or model calls.
import { compileRecipe } from '../../../../js/prim3-tactics/levels/recipe.mjs';
import { isoFromGdelt } from '../intel/news-country-codes.js';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const bad=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
export const releaseEnabled=env=>env.PRIM3_RELEASES_ENABLED==='true';
const canonical=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
export async function recipeDigest(recipe){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(recipe))))].map(x=>x.toString(16).padStart(2,'0')).join('');}
export async function readReviewedRelease(db,env,user,id,{available=false}={}){
 if(!releaseEnabled(env))bad('Reviewed releases are not configured',503);
 if(!uuid.test(id||''))bad('Release UUID required');
 const rows=await db(env,`prim3_reviewed_releases?id=eq.${id}&owner_id=eq.${user.id}&select=*&limit=1`),r=rows?.[0];
 if(!r)bad('Release not found',404);
 const recipe=compileRecipe(r.recipe_input,Date.now(),{allowExpired:true});
 if(recipe.id!==r.recipe_id||await recipeDigest(recipe)!==r.recipe_hash)bad('Release compiler revision mismatch',409);
 if(available&&(r.revoked_at||Date.now()>=Date.parse(r.expires_at)))bad('Release unavailable or expired',409);
 return {...r,recipe,available:!r.revoked_at&&Date.now()<Date.parse(r.expires_at)};
}
export function releaseBinding(r){return {id:r.id,recipe_id:r.recipe_id,recipe_hash:r.recipe_hash,expires_at:r.expires_at,checkpoint_ids:r.checkpoint_ids};}
export async function routeReviewedReleases(request,env,user,parts,db,readBody){
 if(!releaseEnabled(env))bad('Reviewed releases are not configured',503);
 if(parts.length===1&&request.method==='GET')return {ok:true,releases:await db(env,`prim3_reviewed_releases?owner_id=eq.${user.id}&select=id,recipe_id,reviewed_at,expires_at,revoked_at,source_snapshot&order=reviewed_at.desc,id.desc&limit=50`)};
 if(parts.length===2&&parts[1]==='sources'&&request.method==='GET')return {ok:true,review_required:true,sources:await db(env,`media_news_articles?published_at=gte.${encodeURIComponent(new Date(Date.now()-86400000).toISOString())}&published_at=lte.${encodeURIComponent(new Date().toISOString())}&select=id,title,canonical_url,published_at,location_country_fips&order=published_at.desc,id.desc&limit=30`)};
 if(parts.length===2&&request.method==='GET')return {ok:true,release:await readReviewedRelease(db,env,user,parts[1])};
 if(parts.length===3&&parts[2]==='revoke'&&request.method==='POST'){
  const r=await readReviewedRelease(db,env,user,parts[1]);
  if(!r.revoked_at)await db(env,`prim3_reviewed_releases?id=eq.${r.id}&owner_id=eq.${user.id}&revoked_at=is.null`,{method:'PATCH',body:{revoked_at:new Date().toISOString()}});
  return {ok:true,release:await readReviewedRelease(db,env,user,r.id)};
 }
 if(parts.length!==1||request.method!=='POST')bad('Release route not found',404);
 const b=await readBody(request);if(!uuid.test(b.id||'')||!b.input||b.review?.fiction!==true||b.review?.geography!==true)bad('Release ID and explicit review required');
 const input=structuredClone(b.input);input.review={fiction:true,geography:true};input.source=null;
 let article=null;
 if(b.article_id!=null){
  if(!uuid.test(b.article_id)||b.review?.source!==true)bad('Existing article and explicit source review required');
  const rows=await db(env,`media_news_articles?id=eq.${b.article_id}&select=id,canonical_url,published_at,location_country_fips&limit=1`);article=rows?.[0];
  if(!article||!article.published_at||isoFromGdelt(article.location_country_fips)!==input.geography?.country)bad('Reviewed event country or source unavailable',409);
  input.review.source=true;
  input.source={kind:'reviewed-public-news',eventId:article.id,url:article.canonical_url,publisher:new URL(article.canonical_url).hostname,publishedAt:article.published_at,country:input.geography.country,theme:b.theme,reviewId:b.id};
 }
 // Normalize review references to this immutable revision, never arbitrary client IDs.
 if(input.geography)input.geography.reviewId=b.id;
 let recipe;try{recipe=compileRecipe(input,Date.now(),{allowExpired:true});}catch(e){bad(e.message);}
 const hash=await recipeDigest(recipe),checkpoints=recipe.objectives.flatMap(o=>o.steps.map((_,i)=>`${o.id}:STEP_${i+1}`));
 const r=await db(env,'rpc/prim3_release_publish',{method:'POST',body:{p_owner:user.id,p_id:b.id,p_article:article?.id??null,p_country:article?.location_country_fips??null,p_input:recipe.input,p_recipe_id:recipe.id,p_hash:hash,p_checkpoints:checkpoints,p_dedupe:article?`news:${article.id}:${recipe.input.objective}`:`offline:${await recipeDigest({...recipe.input,geography:{...recipe.input.geography,reviewId:'owner-reviewed'}})}`}});
 return {ok:true,release:await readReviewedRelease(db,env,user,r.id)};
}
