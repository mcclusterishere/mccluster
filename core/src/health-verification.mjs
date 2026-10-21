// A successful ref/manifest comparison is not a runtime health response.
export function finalizeRuntimeHealth(snapshot) {
  const probes = snapshot.runtime_checks || {};
  const problems = [];
  const access = probe => probe?.http_status == null ? 'unverified' : probe.ok === true ? 'ok' : 'fail';
  for (const [name, probe] of [['local_core', probes.local_core], ['public_core', probes.public_core]]) {
    if (access(probe) === 'fail') problems.push({component:'core',code:`${name}_probe_failed`,severity:name === 'local_core' ? 'critical' : 'warning',message:`${name} returned HTTP ${probe.http_status} without a valid healthy response.`});
    if (access(probe) === 'ok' && probe.deployment_sha && probe.deployment_sha !== snapshot.deployment?.deployed_sha) {
      problems.push({component:'deployment',code:`${name}_sha_mismatch`,severity:'warning',message:`${name} serving SHA differs from the host deployment record.`,detail:{serving_sha:probe.deployment_sha,host_record_sha:snapshot.deployment?.deployed_sha || null}});
    }
  }
  const degradation = [...(snapshot.degradation || []), ...problems];
  const overall = degradation.some(item=>item.severity === 'critical') ? 'fail' : degradation.length ? 'degraded' : snapshot.overall;
  const previous = snapshot.health_sections?.infrastructure || {status:'unverified',issues:[]};
  const infrastructure = {...previous,issues:[...(previous.issues || []),...problems],
    local_access:access(probes.local_core),public_access:access(probes.public_core),
    local_serving_sha:probes.local_core?.deployment_sha || null,public_serving_sha:probes.public_core?.deployment_sha || null};
  if (problems.some(item=>item.severity === 'critical')) infrastructure.status='fail';
  else if (problems.length && infrastructure.status !== 'fail') infrastructure.status='degraded';
  else if (probes.local_core && access(probes.local_core) === 'unverified' && infrastructure.status === 'ok') infrastructure.status='unverified';
  const summary = String(snapshot.summary || '').replace(/^system=\S+/,`system=${overall}`).replace(/infrastructure=\S+/,`infrastructure=${infrastructure.status}`);
  return {...snapshot,overall,degradation,health_sections:{...snapshot.health_sections,infrastructure},
    summary:`${summary} local_core=${infrastructure.local_access} public_core=${infrastructure.public_access}`};
}
