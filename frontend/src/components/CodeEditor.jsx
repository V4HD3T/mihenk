import Editor from '@monaco-editor/react';

const MONACO_LANGUAGE = {
  python: 'python',
  cpp: 'cpp',
  java: 'java',
  javascript: 'javascript',
  c: 'c',
};

const FILE_EXTENSION = {
  python: 'py',
  cpp: 'cpp',
  java: 'java',
  javascript: 'js',
  c: 'c',
};

export default function CodeEditor({ language, value, onChange, height = '420px', onPaste }) {
  const handleMount = (editor) => {
    if (!onPaste) return;
    const domNode = editor.getDomNode();
    domNode?.addEventListener('paste', (e) => {
      const pastedText = e.clipboardData?.getData('text') || '';
      if (pastedText.length > 0) onPaste(pastedText.length);
    });
  };

  return (
    <div className="rounded-card overflow-hidden border border-line">
      <div className="bg-ink text-white/70 text-xs font-mono px-4 py-2 flex items-center justify-between">
        <span>main.{FILE_EXTENSION[language] || 'txt'}</span>
        <span className="flex gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-error/70" />
          <span className="w-2.5 h-2.5 rounded-full bg-warning/70" />
          <span className="w-2.5 h-2.5 rounded-full bg-success/70" />
        </span>
      </div>
      <Editor
        height={height}
        language={MONACO_LANGUAGE[language] || 'plaintext'}
        value={value}
        onChange={(v) => onChange(v ?? '')}
        onMount={handleMount}
        theme="vs-dark"
        options={{
          fontSize: 14,
          fontFamily: 'JetBrains Mono, monospace',
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          padding: { top: 16 },
          automaticLayout: true,
          tabSize: 4,
        }}
      />
    </div>
  );
}
