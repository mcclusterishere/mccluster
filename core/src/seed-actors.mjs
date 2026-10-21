import { rest, resolveHouseOrgId, enqueueJob, hasPendingJob } from './supabase.mjs';
async function main(){
  const orgId=await resolveHouseOrgId();
  const {body:actors=[]}=await rest(`ops_platform_actors?org_id=eq.${orgId}&enabled=eq.true&select=actor_key&limit=10`);
  for(const actor of actors){
    if(await hasPendingJob({orgId,jobType:'actor_news_comment',targetId:actor.actor_key})) continue;
    const job=await enqueueJob({orgId,jobType:'actor_news_comment',targetType:'platform_actor',targetId:actor.actor_key,priority:10,maxAttempts:2,input:{seeded_by:'mccluster-core-actors.timer'}});
    console.log(JSON.stringify({event:'actor_seeded',actor_key:actor.actor_key,job_id:job.id}));
  }
}
main().catch(error=>{console.error(JSON.stringify({event:'actor_seed_failed',message:error.message}));process.exitCode=1;});
