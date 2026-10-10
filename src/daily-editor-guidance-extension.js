const { StateField } = require('@codemirror/state');
const { Decoration, EditorView, WidgetType } = require('@codemirror/view');
const { analyzeDailyEditor } = require('./daily-editor-guidance-model');

class GuidanceWidget extends WidgetType {
  constructor(descriptor, onAction) { super(); this.descriptor = descriptor; this.onAction = onAction; }
  eq(other) { return other instanceof GuidanceWidget && other.descriptor.id === this.descriptor.id && other.descriptor.label === this.descriptor.label; }
  toDOM(view) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'hz-daily-editor-placeholder';
    button.dataset.hzGuidanceId = this.descriptor.id;
    button.textContent = this.descriptor.label;
    button.setAttribute('aria-label', `${this.descriptor.label}，点击开始填写`);
    button.addEventListener('click', () => {
      const current = analyzeDailyEditor(view.state.doc.toString());
      const latest = current.placeholders.find((item) => item.id === this.descriptor.id);
      if (!latest) return;
      if (latest.interaction === 'action') {
        this.onAction(latest.action);
        return;
      }
      view.dispatch({ selection: { anchor: latest.cursor }, scrollIntoView: true });
      view.focus();
    });
    return button;
  }
}

function buildDecorations(doc, settings, onAction) {
  const result = analyzeDailyEditor(doc.toString(), {
    showGuidance: settings.showDailyGuidance,
    showTechnicalMarkers: settings.showDailyTechnicalMarkers,
  });
  const ranges = [];
  for (const marker of result.hiddenMarkers) {
    ranges.push(Decoration.line({ attributes: { class: 'cm-hz-technical-marker-line' } }).range(marker.from));
  }
  for (const prompt of result.placeholders) {
    ranges.push(Decoration.widget({
      widget: new GuidanceWidget(prompt, onAction),
      side: prompt.block ? -1 : 1,
      block: prompt.block,
    }).range(prompt.at));
  }
  return Decoration.set(ranges, true);
}

function createDailyEditorGuidanceExtension({ settings, onAction }) {
  if (typeof onAction !== 'function') throw new TypeError('onAction must be a function');
  const snapshot = Object.freeze({
    showDailyGuidance: settings.showDailyGuidance !== false,
    showDailyTechnicalMarkers: settings.showDailyTechnicalMarkers === true,
  });
  return StateField.define({
    create: (state) => buildDecorations(state.doc, snapshot, onAction),
    update: (decorations, transaction) => (
      transaction.docChanged ? buildDecorations(transaction.state.doc, snapshot, onAction) : decorations
    ),
    provide: (field) => EditorView.decorations.from(field),
  });
}

module.exports = { GuidanceWidget, buildDecorations, createDailyEditorGuidanceExtension };
