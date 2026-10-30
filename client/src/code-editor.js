// Monaco Editor wrapper (loaded from the pinned monaco-editor package via its
// AMD loader). Falls back to a plain textarea if Monaco cannot load.
let monacoPromise = null;

function loadMonaco() {
  if (monacoPromise) return monacoPromise;
  monacoPromise = new Promise((resolve, reject) => {
    const req = window.require;
    if (!req || !req.config) return reject(new Error('Monaco loader missing'));
    window.MonacoEnvironment = {
      getWorkerUrl() {
        return `data:text/javascript;charset=utf-8,${encodeURIComponent(`self.MonacoEnvironment={baseUrl:'${location.origin}/vendor/monaco/'};importScripts('${location.origin}/vendor/monaco/vs/base/worker/workerMain.js');`)}`;
      },
    };
    req.config({ paths: { vs: '/vendor/monaco/vs' } });
    req(['vs/editor/editor.main'], () => resolve(window.monaco), reject);
  });
  return monacoPromise;
}

export class CodeEditor {
  constructor(host) {
    this.host = host;
    this.editor = null;
    this.fallback = null;
    this.changeHandlers = [];
    this.decorations = [];
    this.ready = this.init();
  }

  async init() {
    try {
      const monaco = await loadMonaco();
      monaco.editor.defineTheme('vice-neon', {
        base: 'vs-dark',
        inherit: true,
        rules: [
          { token: 'comment', foreground: '8f7bb3', fontStyle: 'italic' },
          { token: 'keyword', foreground: 'ff4fa3' },
          { token: 'string', foreground: 'ffd23f' },
          { token: 'number', foreground: '4dff9a' },
          { token: 'identifier', foreground: 'f4ecff' },
        ],
        colors: {
          'editor.background': '#0f0820',
          'editor.lineHighlightBackground': '#1e1033',
          'editorLineNumber.foreground': '#5a4680',
          'editorCursor.foreground': '#4fe3ff',
          'editor.selectionBackground': '#3a216080',
        },
      });
      this.editor = monaco.editor.create(this.host, {
        value: '',
        language: 'javascript',
        theme: 'vice-neon',
        automaticLayout: true,
        minimap: { enabled: false },
        fontSize: 13,
        scrollBeyondLastLine: false,
        tabSize: 2,
        wordWrap: 'on',
        fixedOverflowWidgets: true,
      });
      // Turn off type-check squiggles for undeclared helpers; keep syntax errors.
      monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: false });
      this.editor.onDidChangeModelContent(() => this.changeHandlers.forEach((fn) => fn(this.getValue())));
    } catch (e) {
      console.warn('Monaco failed to load, using a basic editor.', e);
      this.fallback = document.createElement('textarea');
      this.fallback.className = 'fallback-editor';
      this.fallback.spellcheck = false;
      this.host.appendChild(this.fallback);
      this.fallback.addEventListener('input', () => this.changeHandlers.forEach((fn) => fn(this.getValue())));
    }
  }

  get isMonaco() {
    return !!this.editor;
  }

  getValue() {
    if (this.editor) return this.editor.getValue();
    if (this.fallback) return this.fallback.value;
    return '';
  }

  setValue(v) {
    if (this.editor) this.editor.setValue(v);
    else if (this.fallback) this.fallback.value = v;
  }

  /** Highlight lines (1-based) with a hover note. Pass [] to clear. */
  markLines(marks) {
    if (!this.editor) return;
    const monaco = window.monaco;
    this.decorations = this.editor.deltaDecorations(this.decorations, marks.map((m) => ({
      range: new monaco.Range(m.line, 1, m.line, 1),
      options: {
        isWholeLine: true,
        className: 'bug-line',
        linesDecorationsClassName: 'bug-line-gutter',
        hoverMessage: { value: m.message },
        overviewRuler: { color: '#ffd23f', position: monaco.editor.OverviewRulerLane.Left },
      },
    })));
  }

  revealLine(line) {
    if (this.editor) {
      this.editor.revealLineInCenter(line);
      this.editor.setPosition({ lineNumber: line, column: 1 });
      this.editor.focus();
    } else if (this.fallback) {
      const lines = this.fallback.value.split('\n');
      const start = lines.slice(0, line - 1).join('\n').length + (line > 1 ? 1 : 0);
      this.fallback.focus();
      this.fallback.setSelectionRange(start, start + (lines[line - 1] || '').length);
    }
  }

  setReadOnly(ro) {
    if (this.editor) this.editor.updateOptions({ readOnly: ro });
    else if (this.fallback) this.fallback.readOnly = ro;
  }

  onChange(fn) {
    this.changeHandlers.push(fn);
  }

  focus() {
    if (this.editor) this.editor.focus();
    else if (this.fallback) this.fallback.focus();
  }

  layout() {
    if (this.editor) this.editor.layout();
  }
}
