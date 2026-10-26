/* Delivery coordination only. The World publisher stays in mnet.js. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MCCWorldPublish = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function create(options) {
    var records = [], epoch = 0;
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
      return { user: options.currentUser(), org: input.org, account: input.account, handle: input.handle,
        caption: input.caption, file: file, key: options.randomKey(), state: 'waiting_for_world', worldId: null,
        storagePath: null, jobId: null, busy: false, error: null, epoch: epoch };
    }
    async function send(record, retry) {
      owner(record);
      if (record.busy || ['published','cancelled'].includes(record.state)) return;
      record.busy = true; record.error = null; notify();
      try {
        var status = await options.api('/v1/customer-social/status?org_id=' + encodeURIComponent(record.org));
        owner(record);
        if (record.epoch !== epoch) return;
        if (!status.configured || status.connection?.status !== 'connected') throw new Error('Instagram is unavailable or disconnected. Reconnect this site, then retry here. Your World post is already published.');
        if (status.connection.account_id !== record.account) throw new Error('The connected Instagram account changed. This delivery will not be sent to a different account.');
        if (!record.storagePath) {
          record.state = 'uploading'; notify();
          var upload = await options.api('/v1/customer-social/uploads', { method: 'POST', body: { org_id: record.org, mime_type: record.file.type, byte_size: record.file.size } });
          owner(record);
          await options.uploadFile(upload.upload_url, record.file);
          owner(record);
          record.storagePath = upload.storage_path;
        }
        if (record.epoch !== epoch) return;
        var path = record.jobId && retry ? '/v1/customer-social/jobs/' + record.jobId + '/retry' : '/v1/customer-social/publish';
        var result = await options.api(path, { method: 'POST', body: record.jobId && retry ? { org_id: record.org } : {
          org_id: record.org, storage_path: record.storagePath, caption: record.caption, idempotency_key: record.key
        } });
        owner(record);
        record.jobId = result.publish_job.id;
        record.state = result.publish_job.state;
        record.file = null; // Upload completed; release the potentially large local video.
      } catch (e) {
        record.state = 'failed'; record.error = e.message || 'Instagram delivery failed. Retry without reposting to World.';
      } finally { record.busy = false; if (record.epoch === epoch) notify(); }
    }
    function worldSucceeded(record, worldId) {
      if (!record) return;
      // A failed or stale World submission can never start external publishing.
      owner(record);
      if (!worldId) throw new Error('World did not return a post identifier; Instagram was not submitted.');
      if (record.worldId) return;
      record.worldId = worldId; records.unshift(record); notify();
      return send(record, false);
    }
    async function refresh(record) {
      owner(record);
      if (!record.jobId || record.busy) return;
      var result = await options.api('/v1/customer-social/jobs?org_id=' + encodeURIComponent(record.org));
      owner(record);
      var job = result.jobs.find(function (item) { return item.id === record.jobId; });
      if (job) { record.state = job.state; record.error = job.recovery || null; notify(); }
    }
    return { snapshot: snapshot, worldSucceeded: worldSucceeded, retry: function (record) { return send(record, true); }, refresh: refresh,
      reset: function () { epoch++; records.forEach(function (r) { r.file = null; }); records = []; notify(); }, records: function () { return records.slice(); } };
  }
  return { create: create };
});
