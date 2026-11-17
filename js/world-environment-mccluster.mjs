/* McCluster host binding. The reusable panel receives transport and identity
   through this adapter, never service-role keys, copied sessions or a new auth stack. */
import { mountEnvironment } from './world-environment.mjs';
import { createEnvironmentTransport } from '../vendor/equity-uprise/src/environment/transport.mjs';
export function mcclusterEnvironmentAdapter(w) {
  const token = async () => await w.MCC_SUPA?.token?.() || null;
  const messages = {
    proof_service_unavailable:'Mission evidence is unavailable until the approved backend release is installed.',
    proof_requires_live_capture:'This mission requires the existing live-capture workflow. Text or link evidence cannot bypass it.',
    proof_too_long_for_sharing:'Public proof, including its link, must fit within 2,000 characters. Shorten it or submit privately.',
    proof_changed:'This evidence changed after you opened it. Refresh and inspect the latest evidence before reviewing.',
    proof_immutable:'This evidence is already verified and cannot be replaced.',
    mission_not_taking_proof:'This assignment is not accepting evidence in its current state.',
    proof_already_used:'This evidence has already been used for another mission.',
    review_not_authorized:'Your account does not have the existing proof-review permission.',
    self_review_forbidden:'You cannot verify your own evidence.',
    current_news_review_required:'The exact news review is no longer current. Review the latest source before proposing.',
    article_changed_reload_required:'This headline changed. Reload it and review the new version.',
    reviewed_news_preview_required:'Review relevant current news before preparing sponsor drafts.',
    exact_crm_alignment_evidence_required:'The company notes changed or do not support that excerpt. Refresh sponsor candidates.',
    planning_unavailable:'News or sponsor planning is unavailable. No mission or outreach was created.',
    sign_in_required:'Sign in to participate.', identity_required:'Finish your M Account profile to participate.',
    join_team_first:'Join the Environmental Justice Team first.', membership_blocked:'This membership cannot be changed here.',
    team_unavailable:'The team is not accepting membership right now.', persistence_unavailable:'Team and mission records are unavailable. No change was confirmed.',
    current_event_and_action_required:'This observation no longer supports that action. Refresh the sources.',
    source_expired:'The source is too old to approve. Refresh current observations.', mission_full:'This mission has reached capacity.', mission_not_open:'This mission is not open.', mission_not_eligible:'This mission’s eligibility requirements were not met.',
    mission_expired:'This mission has expired.', proposal_limit:'Your daily proposal limit has been reached.',
    approved_environment_mission_required:'This mission has not been approved for participation.'
  };
  const transport = createEnvironmentTransport({
    installation: {
      schema:'equity-uprise.installation/v1', id:'mccluster',
      appOrigin:w.location?.origin || 'https://mccluster.org', apiOrigin:'https://api.mccluster.org',
      brand:{name:'McCluster'}, modules:{environment:true}
    },
    fetchImpl:(...args)=>w.fetch(...args), token, messages,
    allowLocalhost:true
  });
  /* WHERE THE PANEL LIVES (owner, 2026-11-17): behind the feed's Equity Uprise tab (js/mnet.js, MCC_FEED_SCOPE), on the
     feed, never in Travel. It was the E=UP mode in the centre of the globe; the panel still asks for that mode by name, so
     this adapter answers 'environment' exactly while the tab is chosen on the feed, and tells it whenever either changes. */
  const worldMode = () => w.MCC_WORLD_MODE?.get?.() || w.document?.documentElement.dataset.worldMode;
  const shown = () => worldMode() === 'posts' && w.MCC_FEED_SCOPE?.get?.() === 'equity';
  const relay = () => { try { w.dispatchEvent(new w.CustomEvent('mcc:world-environment')); } catch (_) {} };
  for (const type of ['mcc:world-mode', 'mcc:feed-scope']) w.addEventListener?.(type, relay);
  return {
    token,
    mode:()=>shown() ? 'environment' : 'feed',
    modeEvent:'mcc:world-environment', authEvent:'mcc:auth-changed', sessionStorageKey:'mccdb_session',
    revealPanel() {
      w.document?.documentElement.classList.remove('wt-expanded');
      w.document?.querySelector('.mn__world-expand')?.setAttribute('aria-label','Expand the map');
    },
    signIn() {
      /* back to this tab after signing in (?feed=equity, js/mnet.js) */
      const url = new URL(w.location.href); url.searchParams.delete('mode');url.searchParams.set('feed','equity');url.searchParams.set('signin','1');
      w.location.assign(url.pathname+url.search);
    },
    request:transport.request
  };
}
if (typeof window!=='undefined' && typeof document!=='undefined') mountEnvironment(window,document,mcclusterEnvironmentAdapter(window));
