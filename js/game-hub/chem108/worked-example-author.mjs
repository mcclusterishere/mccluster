/* Local authoring inside the existing owner-gated Game Hub. Nothing is persisted or published.
   A review request is an exportable draft, never permission to alter the learner's lesson. */
import { structureAnswer, bindStructureAnswer } from './structure-answer.mjs';
import { EXAMPLE, lessonFor, escapeHTML as e } from './worked-example.mjs';
export function draftVersion(previous, summary, texts, note) {
  const base = lessonFor(previous.questionId);
  if (!base || !Number.isInteger(previous.version) || previous.version < 1) throw new Error('Unknown question or invalid version.');
  if (typeof summary !== 'string' || !summary.trim() || summary.length > 2000 ||
      !Array.isArray(texts) || texts.length !== base.layers.length ||
      texts.some(t => typeof t !== 'string' || !t.trim() || t.length > 4000) ||
      typeof note !== 'string' || note.length > 2000) throw new Error('Fill every explanation; use at most 2,000 characters for the summary or review note and 4,000 per layer.');
  return { ...structuredClone(base), version: previous.version + 1, status: 'draft',
    summary: summary.trim(), layers: base.layers.map((l,i) => ({ ...l, text: texts[i].trim() })), reviewNote: note.trim() };
}
export function requestReview(draft) {
  if (draft.status !== 'draft' || !draft.reviewNote) throw new Error('Add a review note, then preview a new draft before marking it for review.');
  return { ...structuredClone(draft), status: 'needs-review' };
}
export function mountAuthor(host, catalog, base = EXAMPLE) {
  if (document.documentElement.dataset.ownerAccess !== 'open') return;
  const versions = [structuredClone(base)];
  host.innerHTML = `<details class="mr-author"><summary>Owner · draft and review this explanation</summary>
    <p>Local preview only. Drafts disappear when you leave this screen. Download a draft to keep it. The question, accepted answers and learner history cannot be edited here.</p>
    <p>Annotation anchors are pinned to the original SVG: ${base.anchors.map(a=>`${e(a.label)} → ${e(a.source)}`).join('; ')}. Preview their alignment below. Changing geometry or anchors requires source review.</p>
    <form><label>Summary<textarea name="summary" required maxlength="2000">${e(base.summary)}</textarea></label>
    ${base.layers.map((l,i) => `<label>${e(l.title)}<textarea name="layer${i}" required maxlength="4000">${e(l.text)}</textarea></label>`).join('')}
    <label>Review note<textarea name="reviewNote" maxlength="2000" placeholder="What changed and what should a chemistry reviewer check?"></textarea></label>
    <button type="submit" class="mr-btn">Preview new draft version</button></form>
    <label>Preview version<select data-version><option value="0">Version 1 · local-review</option></select></label>
    <button type="button" class="mr-btn mr-btn--quiet" data-review>Mark draft for review</button>
    <button type="button" class="mr-btn mr-btn--quiet" data-download>Download selected version</button>
    <p role="status" data-author-status></p><div data-draft-preview></div></details>`;
  const select = host.querySelector('[data-version]');
  const status = host.querySelector('[data-author-status]');
  const selected = () => versions[Number(select.value)];
  function preview() {
    const lesson = selected();
    const target = host.querySelector('[data-draft-preview]');
    target.innerHTML = `<h3>Version ${lesson.version} · ${e(lesson.status)}</h3>${structureAnswer({ ...catalog.molecules.find(m=>m.id===base.questionId), answer:base.name },base.name,true,catalog,lesson)}`;
    bindStructureAnswer(target, lesson);
    target.querySelector('[data-continue]').remove();
    status.textContent = `Previewing version ${lesson.version}. The game still uses the original lesson.`;
  }
  host.querySelector('form').onsubmit = event => {
    event.preventDefault();
    if (document.documentElement.dataset.ownerAccess !== 'open') return;
    try {
      const form = new FormData(event.currentTarget);
      const draft = draftVersion(versions.at(-1), form.get('summary'), base.layers.map((_,i) => form.get('layer'+i)), form.get('reviewNote'));
      versions.push(draft);
      const option = document.createElement('option'); option.value = versions.length - 1; option.textContent = `Version ${draft.version} · draft`; select.append(option); select.value = option.value;
      preview();
    } catch (error) { status.textContent = error.message; }
  };
  select.onchange = preview;
  host.querySelector('[data-review]').onclick = () => {
    if (document.documentElement.dataset.ownerAccess !== 'open') return;
    try {
      versions[Number(select.value)] = requestReview(selected());
      select.selectedOptions[0].textContent = `Version ${selected().version} · needs-review`;
      preview(); status.textContent = 'Marked for review locally. Download this version to retain it; no reviewer has been contacted and nothing is approved or published.';
    } catch (error) { status.textContent = error.message; }
  };
  host.querySelector('[data-download]').onclick = () => {
    if (document.documentElement.dataset.ownerAccess !== 'open') return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(selected(), null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `chem108-${base.questionId}-explanation-v${selected().version}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
}
