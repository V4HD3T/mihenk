/**
 * Renders one submission's source with its matched character ranges
 * highlighted. matchedSpans is a list of [start, end) character offsets
 * into `code`, already merged/sorted by the backend.
 */
function HighlightedCode({ code, matchedSpans }) {
  const segments = [];
  let cursor = 0;
  for (const [start, end] of matchedSpans) {
    if (start > cursor) segments.push({ text: code.slice(cursor, start), matched: false });
    segments.push({ text: code.slice(start, end), matched: true });
    cursor = end;
  }
  if (cursor < code.length) segments.push({ text: code.slice(cursor), matched: false });

  return (
    <pre className="text-xs font-mono whitespace-pre-wrap leading-relaxed p-4 overflow-x-auto">
      {segments.map((seg, i) =>
        seg.matched ? (
          <span key={i} className="bg-warning/25 text-ink rounded-[2px]">
            {seg.text}
          </span>
        ) : (
          <span key={i}>{seg.text}</span>
        )
      )}
    </pre>
  );
}

export default function CodeDiffView({ submissionA, submissionB, similarity }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm text-inkmuted">
          Highlighted regions matched between the two submissions (renamed variables and
          reformatting are ignored by design).
        </p>
        <span className="text-sm font-mono px-2 py-1 rounded-full bg-warning-bg text-warning whitespace-nowrap ml-3">
          {similarity}% match
        </span>
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <div className="border border-line rounded-card overflow-hidden bg-surface">
          <div className="bg-ink/5 px-4 py-2 text-xs font-medium border-b border-line">{submissionA.userName}</div>
          <HighlightedCode code={submissionA.code} matchedSpans={submissionA.matchedSpans} />
        </div>
        <div className="border border-line rounded-card overflow-hidden bg-surface">
          <div className="bg-ink/5 px-4 py-2 text-xs font-medium border-b border-line">{submissionB.userName}</div>
          <HighlightedCode code={submissionB.code} matchedSpans={submissionB.matchedSpans} />
        </div>
      </div>
    </div>
  );
}
