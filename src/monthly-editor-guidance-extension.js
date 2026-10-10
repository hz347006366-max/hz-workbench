const { StateField } = require('@codemirror/state');
const { Decoration, EditorView, WidgetType } = require('@codemirror/view');
const { analyzeMonthlyEditor } = require('./monthly-editor-guidance-model');

class MonthlyGuidanceWidget extends WidgetType {
  constructor(descriptor) { super(); this.descriptor = descriptor; }

  eq(other) {
    return other instanceof MonthlyGuidanceWidget
      && other.descriptor.id === this.descriptor.id
      && other.descriptor.label === this.descriptor.label;
  }

  toDOM(view) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'hz-month-editor-placeholder';
    button.dataset.hzGuidanceId = this.descriptor.id;
    button.textContent = this.descriptor.label;
    button.setAttribute('aria-label', `${this.descriptor.label}，点击开始填写`);
    button.addEventListener('click', () => {
      const current = analyzeMonthlyEditor(view.state.doc.toString(), { showGuidance: true });
      const latest = current.placeholders.find((item) => item.id === this.descriptor.id);
      if (!latest) return;
      view.dispatch({ selection: { anchor: latest.cursor }, scrollIntoView: true });
      view.focus();
    });
    return button;
  }
}

function buildDecorations(doc, settings) {
  const result = analyzeMonthlyEditor(doc.toString(), {
    showGuidance: settings.showMonthlyGuidance,
  });
  return Decoration.set(result.placeholders.map((prompt) => Decoration.widget({
    widget: new MonthlyGuidanceWidget(prompt), side: 1,
  }).range(prompt.at)), true);
}

function createMonthlyEditorGuidanceExtension({ settings }) {
  const snapshot = Object.freeze({ showMonthlyGuidance: settings.showMonthlyGuidance !== false });
  return StateField.define({
    create: (state) => buildDecorations(state.doc, snapshot),
    update: (decorations, transaction) => (
      transaction.docChanged ? buildDecorations(transaction.state.doc, snapshot) : decorations
    ),
    provide: (field) => EditorView.decorations.from(field),
  });
}

module.exports = { MonthlyGuidanceWidget, buildDecorations, createMonthlyEditorGuidanceExtension };
