/* Supplemental course lessons compiled through the same schema as the owner authoring preview. */
import { norm } from './engine.mjs';
import { LESSONS } from './lesson-authoring.mjs';
export { LESSONS } from './lesson-authoring.mjs';
export const EXAMPLE = LESSONS.m27;
export function lessonFor(id) { return LESSONS[String(id).replace(/^family:/,'')] || null; }
export const escapeHTML = (x) => String(x ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
export function matchesExample(m) { const lesson=lessonFor(m.id); return !!lesson && m.id===lesson.questionId && m.answer===lesson.name; }
export function contrast(picked, catalog, lesson = EXAMPLE) {
  const other = catalog.molecules.find(m => [m.name, ...m.aliases].some(n => norm(n) === norm(picked)));
  if (!other || other.id === lesson.questionId) return '';
  return `Your choice, ${picked}, describes a different structure: ${other.explain} For this structure: ${lesson.summary}`;
}
export function renderExample(m, catalog, lesson = lessonFor(m.id)) {
  if (!lesson || !matchesExample(m)) return '';
  const e = escapeHTML;
  return `<section class="mr-worked" data-lesson-id="${e(lesson.questionId)}" aria-label="Worked example: ${e(lesson.name)}">
    <h4>Build the answer from the atoms</h4>
    ${m.picked ? `<p class="mr-worked__contrast">${e(contrast(m.picked, catalog, lesson))}</p>` : ''}
    <p>${e(lesson.summary)}</p>
    <p class="mr-worked__structure">${e(lesson.structure)}</p>
    <div role="group" aria-label="Explanation depth" class="mr-depth">${['Test essentials','Naming reasoning','Atoms and bonds','Advanced / history'].map((label,i) => `<button type="button" class="mr-btn mr-btn--quiet" data-depth="${i}" aria-pressed="${i === 0}">${label}</button>`).join('')}</div>
    <p class="mr-depth-note">Depth changes the explanation, not the question difficulty.</p>
    ${lesson.layers.map((l,i) => `<details data-layer-depth="${[2,2,1,1,2,1][i]}" hidden><summary>${e(l.title)}</summary><p>${e(l.text)}</p></details>`).join('')}
    <p data-layer-depth="2" hidden>${e(lesson.chargeNote)}</p>
    <details data-layer-depth="3" hidden><summary>Optional · history and advanced context</summary><p>${e(lesson.advanced)}</p><p>${e(lesson.history)}</p></details>
    <fieldset class="mr-check"><legend>Quick check · no score or timer</legend><p>${e(lesson.check.prompt)}</p>
      ${lesson.check.options.map((o,i) => `<button class="mr-btn mr-btn--quiet" type="button" data-lesson-choice="${i}">${e(o.label)}</button>`).join('')}
      <p role="status" data-lesson-feedback></p>
    </fieldset>
    <details><summary>Sources and course alignment</summary><p>This example supplements question ${e(lesson.questionId)} in the pinned Chem-108 deck. Accepted names: ${[lesson.name, ...(catalog.molecules.find(x=>x.id===lesson.questionId)?.aliases || [])].map(e).join(', ')}. No instructor syllabus was supplied; this is not an instructor approval.</p><ul>${lesson.sources.map(s => `<li><a href="${e(s.href)}" target="_blank" rel="noopener noreferrer">${e(s.label)}</a></li>`).join('')}</ul></details>
  </section>`;
}
export function bindExample(host, override = null) {
  host.querySelectorAll('.mr-worked').forEach(card => {
    const lesson = override || lessonFor(card.dataset.lessonId);
    if (!lesson) return;
    card.querySelectorAll('[data-depth]').forEach(button => {
      button.onclick = () => {
        const depth = Number(button.dataset.depth);
        card.querySelectorAll('[data-depth]').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
        card.querySelectorAll('[data-layer-depth]').forEach(layer => { layer.hidden = Number(layer.dataset.layerDepth) > depth; });
      };
    });
    card.querySelectorAll('[data-lesson-choice]').forEach(button => {
      button.onclick = () => {
        const option = lesson.check.options[Number(button.dataset.lessonChoice)];
        card.querySelector('[data-lesson-feedback]').textContent = option.feedback;
      };
    });
  });
}
