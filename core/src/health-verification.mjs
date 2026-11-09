// A successful ref/manifest comparison is not a runtime health response.
export function finalizeRuntimeHealth(snapshot) {
  const probes = snapshot.runtime_checks || {};
  const problems = [];
  const validSha = value => /^[a-f0-9]{40}$/i.test(value || '');
  const missingSha = [];
  const access = probe => probe?.http_status == null ? 'unverified' : probe.ok === true ? 'ok' : 'fail';
  for (const [name, probe] of [['local_core', probes.local_core], ['public_core', probes.public_core]]) {
    if (access(probe) === 'fail') problems.push({component:'core',code:`${name}_probe_failed`,severity:name === 'local_core' ? 'critical' : 'warning',message:`${name} returned HTTP ${probe.http_status} without a valid healthy response.`});
    if (access(probe) === 'ok' && !validSha(probe.deployment_sha)) {
      missingSha.push(name);
      problems.push({component:'deployment',code:`${name}_sha_unverified`,severity:'warning',message:`${name} is reachable but did not attest a valid serving SHA; deployment is unverified.`});
    }
    if (access(probe) === 'ok' && validSha(probe.deployment_sha) && probe.deployment_sha !== snapshot.deployment?.deployed_sha) {
      problems.push({component:'deployment',code:`${name}_sha_mismatch`,severity:'warning',message:`${name} serving SHA differs from the host deployment record.`,detail:{serving_sha:probe.deployment_sha,host_record_sha:snapshot.deployment?.deployed_sha || null}});
    }
  }
  // The reconcile timer being "active" says nothing about its cycles: in incident
  // #510 it stayed active for a day while every fetch failed. Cycle receipts
  // (deployment.reconcile) do. A failed or stale cycle is a warning, as an
  // inactive timer already is. "unverified" means the host's reconciler predates
  // the receipts: that is neither a failure nor a success and adds nothing.
  const reconcile = snapshot.deployment?.reconcile || null;
  const lastCycle = reconcile?.last_cycle || null;
  if (reconcile?.status === 'failed') {
    problems.push({component:'deployment',code:'reconcile_cycle_failed',severity:'warning',
      message:lastCycle?.interrupted
        ? `The last OVH reconcile cycle was terminated at stage ${lastCycle?.stage || 'unknown'} before it finished.`
        : `The last OVH reconcile cycle failed at stage ${lastCycle?.stage || 'unknown'}.`,
      detail:{stage:lastCycle?.stage || null,exit_code:lastCycle?.exit_code ?? null,interrupted:lastCycle?.interrupted === true,
        transport:lastCycle?.transport || null,trigger:lastCycle?.trigger || null,finished_at:lastCycle?.finished_at || null,
        consecutive_failed_cycles:reconcile.consecutive_failed_cycles ?? null,last_verified_at:reconcile.last_verified_at || null}});
  } else if (reconcile?.status === 'stale') {
    problems.push({component:'deployment',code:'reconcile_cycle_stale',severity:'warning',
      message:'No OVH reconcile cycle has succeeded within the freshness window.',
      detail:{last_verified_at:reconcile.last_verified_at || null,age_ms:reconcile.age_ms ?? null,stale_after_ms:reconcile.stale_after_ms ?? null,
        last_cycle_outcome:lastCycle?.outcome || null,last_cycle_stage:lastCycle?.stage || null,last_cycle_finished_at:lastCycle?.finished_at || null}});
  }
  const degradation = [...(snapshot.degradation || []), ...problems];
  const overall = degradation.some(item=>item.severity === 'critical') ? 'fail' : degradation.length ? 'degraded' : snapshot.overall;
  const previous = snapshot.health_sections?.infrastructure || {status:'unverified',issues:[]};
  const infrastructure = {...previous,issues:[...(previous.issues || []),...problems],
    local_access:access(probes.local_core),public_access:access(probes.public_core),
    local_serving_sha:probes.local_core?.deployment_sha || null,public_serving_sha:probes.public_core?.deployment_sha || null};
  if (problems.some(item=>item.severity === 'critical')) infrastructure.status='fail';
  else if (missingSha.length && infrastructure.status === 'ok') infrastructure.status='unverified';
  else if (problems.length && infrastructure.status !== 'fail') infrastructure.status='degraded';
  else if (probes.local_core && access(probes.local_core) === 'unverified' && infrastructure.status === 'ok') infrastructure.status='unverified';
  const summary = String(snapshot.summary || '').replace(/^system=\S+/,`system=${overall}`).replace(/infrastructure=\S+/,`infrastructure=${infrastructure.status}`);
  const verified = [probes.local_core,probes.public_core].every(probe => access(probe) === 'ok' && validSha(probe.deployment_sha) && probe.deployment_sha === snapshot.deployment?.deployed_sha);
  return {...snapshot,overall,degradation,deployment:{...snapshot.deployment,runtime_verification:verified ? 'verified' : 'unverified'},health_sections:{...snapshot.health_sections,infrastructure},
    summary:`${summary} local_core=${infrastructure.local_access} public_core=${infrastructure.public_access}`};
}
