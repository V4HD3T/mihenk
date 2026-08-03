const { executeCode, runTestCases } = require('./src/services/codeExecution.service');

function ok(label, condition, detail) {
  console.log(`[${condition ? 'PASS' : 'FAIL'}] ${label}${detail ? ' -> ' + detail : ''}`);
}

(async () => {
  console.log('\n=== 1) Python - Hello World ===');
  const py = await executeCode('python', 'print("Hello World")\nprint(2 + 2)', '');
  console.log(py);
  ok('Python ran', py.stdout.trim() === 'Hello World\n4'.trim() || py.stdout.includes('Hello World'));

  console.log('\n=== 2) C++ - Hello World ===');
  const cpp = await executeCode(
    'cpp',
    '#include <iostream>\nint main(){ std::cout << "Hello World" << std::endl; return 0; }',
    ''
  );
  console.log(cpp);
  ok('C++ compiled and ran', cpp.stdout.includes('Hello World'));

  console.log('\n=== 3) Java - Hello World ===');
  const java = await executeCode(
    'java',
    'public class Main { public static void main(String[] args) { System.out.println("Hello World"); } }',
    ''
  );
  console.log(java);
  ok('Java compiled and ran', java.stdout.includes('Hello World'));

  console.log('\n=== 4) Compile error (C++) ===');
  const cppErr = await executeCode('cpp', '#include <iostream>\nint main() { std::cout << "missing brace"; ', '');
  console.log({ stage: cppErr.stage, exitCode: cppErr.exitCode, stderrPreview: cppErr.stderr.slice(0, 120) });
  ok('Compile error caught', cppErr.stage === 'compile');

  console.log('\n=== 5) Test case comparison (Python - add two numbers) ===');
  const testCases = [
    { id: 1, input: '3\n4\n', expected_output: '7', is_sample: true },
    { id: 2, input: '10\n20\n', expected_output: '30', is_sample: false },
    { id: 3, input: '-5\n5\n', expected_output: '0', is_sample: false },
  ];
  const sum = await runTestCases('python', 'a = int(input())\nb = int(input())\nprint(a + b)', testCases);
  console.log(JSON.stringify(sum, null, 2));
  ok('All tests passed', sum.passedCount === 3 && sum.totalCount === 3);

  console.log('\n=== 6) Test cases - Java addition (some tests should fail) ===');
  const javaSum = await runTestCases(
    'java',
    `import java.util.Scanner;
public class Main {
  public static void main(String[] args) {
    Scanner sc = new Scanner(System.in);
    int a = sc.nextInt();
    int b = sc.nextInt();
    System.out.println(a + b + 1); // deliberate bug
  }
}`,
    testCases
  );
  console.log({ passedCount: javaSum.passedCount, totalCount: javaSum.totalCount });
  ok('Deliberately buggy code correctly marked as failing', javaSum.passedCount === 0);

  console.log('\n=== 7) Timeout test (infinite loop) ===');
  const t0 = Date.now();
  const timeout = await executeCode('python', 'while True:\n    pass', '');
  const elapsed = Date.now() - t0;
  console.log({ timedOut: timeout.timedOut, elapsedMs: elapsed });
  ok('Infinite loop timed out within a reasonable duration', timeout.timedOut === true && elapsed < 10000);

  console.log('\n=== 8) Fork-bomb protection (Python) ===');
  const forkBomb = await executeCode(
    'python',
    'import os\ntry:\n    for _ in range(1000):\n        os.fork()\nexcept Exception as e:\n    print("blocked:", type(e).__name__)',
    ''
  );
  console.log({ stdout: forkBomb.stdout, stderr: forkBomb.stderr.slice(0, 200), timedOut: forkBomb.timedOut });

  console.log('\nAll tests completed.');
  process.exit(0);
})().catch((e) => {
  console.error('TEST SCRIPT ERROR:', e);
  process.exit(1);
});
