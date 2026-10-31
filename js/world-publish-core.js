/* The database commits World + external intent atomically. This coordinator
   submits/retries the existing job only; it never publishes another World post. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MCCWorldPublish = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function create(options) {
    var records = [], epoch = 0, pending = null, loading = 0;
    function notify() { options.onChange(records.slice()); }
    function owner(record) {
      if (!record.user || record.user !== options.currentUser()) throw new Error('Sign in to the original account to manage this delivery.');
    }
    function snapshot(input) {
      if (!input.org) return null;
      if (!options.currentUser()) throw new Error('Sign in before choosing an external destination.');
      if (input.visibility !== 'public') throw new Error('Instagram is public. Choose Public for this cross-post or turn off Instagram.');
      var media = input.media || [], file = media[0] && media[0].file;
      if (media.length !== 1 || !file || !['video/mp4', 'video/quicktime'].includes(file.type) || file.size <= 0 || file.size > 524288000) throw new Error('Instagram Reels needs exactly one MP4 or MOV video, up to 500 MB. Turn off Instagram to post other formats to World.');
      if (String(input.caption || '').length > 2200) throw new Error('Instagram captions are limited to 2,200 characters.');
      return { user:options.currentUser(),org:input.org,account:input.account,handle:input.handle,action_mission_id:input.action_mission_id || null,
        action_campaign_id:input.action_campaign_id || null,state:'waiting_for_world',worldId:null,epoch:epoch };
    }
    function request(record, draft) {
      owner(record);
      var delivery = {org_id:record.org,account_id:record.account,action_mission_id:record.action_mission_id,action_campaign_id:record.action_campaign_id};
      var fingerprint = JSON.stringify({user:record.user,draft:draft,delivery:delivery});
      // Retain the key after ambiguous HTTP failures; changing the payload creates
      // a new operation. Reload recovery reads durable history, not browser files.
      if (!pending || pending.fingerprint !== fingerprint) pending = {fingerprint:fingerprint,key:options.randomKey()};
      record.key = pending.key;
      return Object.assign(delivery,{operation_key:record.key});
    }
    function merge(value) {
      var current = records.find(function(r){return r.id===value.id;});
      if(current) { Object.assign(current,value,{error:null}); return current; }
      var record=Object.assign({epoch:epoch,busy:false,error:null},value); records.unshift(record); return record;
    }
    async function recover() {
      var user=options.currentUser(), generation=epoch, load=++loading;
      if(!user) return;
      var result=await options.api('/v1/mnet/deliveries');
      if(user!==options.currentUser() || generation!==epoch || load!==loading) return;
      (result.deliveries||[]).forEach(function(r){if(r.user===user)merge(r);}); notify();
    }
    async function send(record) {
      owner(record);
      if(record.busy || ['published','cancelled'].includes(record.state)) return;
      loading++; record.busy=true; record.error=null; notify();
      try {
        var result=await options.api('/v1/customer-social/deliveries/'+record.id+'/submit',{method:'POST',body:{org_id:record.org}});
        owner(record); if(record.epoch!==epoch)return;
        record.jobId=result.publish_job.id;record.state=result.publish_job.state;
      } catch(e) {
        // An HTTP error is not authoritative job failure; keep the persisted
        // state and expose a recovery action. Retry is server-idempotent.
        record.error=e.message || 'Instagram is unavailable. Retry Instagram only.';
      } finally { loading++;record.busy=false;if(record.epoch===epoch)notify(); }
    }
    function worldSucceeded(record, result) {
      if(!record)return;
      owner(record);
      if(!result?.post?.id || !result.delivery?.id) throw new Error('World delivery confirmation missing. Refresh deliveries before retrying.');
      if(record.worldId)return;
      pending=null;record.worldId=result.post.id;
      var saved=merge(result.delivery);notify();return send(saved);
    }
    async function refresh(record) {
      owner(record); if(record.busy)return; await recover();
    }
    return {snapshot:snapshot,request:request,worldSucceeded:worldSucceeded,retry:send,refresh:refresh,recover:recover,
      reset:function(){epoch++;loading++;pending=null;records=[];notify();},records:function(){return records.slice();}};
  }
  return { create:create };
});
