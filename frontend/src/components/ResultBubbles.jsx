/**
 * Bubble-sheet-inspired test result indicator.
 * Each test case is represented as a filled/empty "bubble" —
 * the platform's signature visual element.
 */
export default function ResultBubbles({ results = [], totalCount, size = 'md' }) {
  const count = totalCount ?? results.length;
  const dimension = size === 'sm' ? 'w-4 h-4 border' : 'w-[22px] h-[22px] border-2';

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {Array.from({ length: count }).map((_, i) => {
        const r = results[i];
        let state = 'pending';
        if (r) {
          if (r.timedOut) state = 'timeout';
          else if (r.passed) state = 'pass';
          else state = 'fail';
        }
        const colorClass =
          state === 'pass'
            ? 'bg-success border-success'
            : state === 'fail'
            ? 'bg-error border-error'
            : state === 'timeout'
            ? 'bg-warning border-warning'
            : 'bg-transparent border-line';
        return (
          <span
            key={i}
            title={r ? (r.passed ? `Test ${i + 1}: passed` : `Test ${i + 1}: failed`) : `Test ${i + 1}`}
            className={`${dimension} rounded-full flex-shrink-0 inline-block ${colorClass}`}
          />
        );
      })}
    </div>
  );
}
