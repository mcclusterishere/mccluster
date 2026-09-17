/* PRIM3 — learning operations against the real curriculum endpoints. */
import { all, endpoints } from '../api.js';
import { esc, failure, fields, panel, pill, raw, table } from '../ui.js';

export default {
  async mount(root, { signal }) {
    const s = await all({
      root: endpoints.prim3(), course: endpoints.prim3Course(), health: endpoints.prim3CourseHealth()
    });
    if (signal.aborted) return;
    const modules = s.course.ok ? (s.course.data?.modules || s.course.data?.lessons || []) : [];

    root.innerHTML = `<div class="op-grid">
      ${panel({ title:'Course health', span:'6', body: s.health.ok
        ? (typeof s.health.data === 'object'
            ? fields(Object.entries(s.health.data).filter(([,v])=>typeof v!=='object').map(([k,v])=>[k, pill(v)]))
            : raw(s.health.data))
        : failure(s.health) })}
      ${panel({ title:'Curriculum', span:'6', meta:`${modules.length} units`, body: s.course.ok
        ? (modules.length
            ? table([
                { key:'id', label:'Unit', render:(r)=>esc(r.id||r.slug||r.title) },
                { key:'title', label:'Title', render:(r)=>esc(r.title||r.name||'—') }
              ], modules, { idKey:'id' })
            : raw(s.course.data, 'GET /v1/prim3/course'))
        : failure(s.course) })}
      ${panel({ title:'PRIM3 surface', body: s.root.ok ? raw(s.root.data,'GET /v1/prim3') : failure(s.root) })}
      ${panel({ title:'Learner progress', body: `
        <p class="op-state__hint" style="margin:0">
          <span class="op-mono">/v1/prim3/progress</span> is a learner-scoped write path, not an
          operator report: there is no cohort or per-learner read route, so no progress table can be
          shown without inventing one.
        </p>` })}
    </div>`;
  }
};
