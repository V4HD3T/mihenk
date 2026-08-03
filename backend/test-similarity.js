const { computeFingerprint, compareFingerprints, getMatchedSpans, computeClassReport } = require('./src/services/similarity.service');

function ok(label, condition, detail) {
  console.log(`[${condition ? 'PASS' : 'FAIL'}] ${label}${detail !== undefined ? ' -> ' + detail : ''}`);
}

console.log('=== 1) Identical code -> should be ~100% ===');
const codeA1 = `a = int(input())
b = int(input())
total = a + b
print(total)`;
const fpA1 = computeFingerprint(codeA1, 'python');
const fpA2 = computeFingerprint(codeA1, 'python');
const cmp1 = compareFingerprints(fpA1.fingerprints, fpA2.fingerprints);
console.log({ similarity: cmp1.similarity });
ok('Identical code scores ~100%', cmp1.similarity >= 99);

console.log('\n=== 2) Renamed variables, same structure -> should stay high ===');
const codeB = `x = int(input())
y = int(input())
result = x + y
print(result)`;
const fpB = computeFingerprint(codeB, 'python');
const cmp2 = compareFingerprints(fpA1.fingerprints, fpB.fingerprints);
console.log({ similarity: cmp2.similarity });
ok('Renamed-variable copy still scores high', cmp2.similarity >= 80);

console.log('\n=== 3) Different string literal content, same logic -> should stay high ===');
const codeC = `name = input()
print("Hello " + name)`;
const codeC2 = `name = input()
print("Bonjour " + name)`;
const fpC1 = computeFingerprint(codeC, 'python');
const fpC2 = computeFingerprint(codeC2, 'python');
const cmp3 = compareFingerprints(fpC1.fingerprints, fpC2.fingerprints);
console.log({ similarity: cmp3.similarity });
ok('Different string content does not break the match', cmp3.similarity >= 90);

console.log('\n=== 4) Genuinely different algorithms -> raw pairwise score stays below the flagging floor ===');
const codeD = `n = int(input())
is_prime = True
if n < 2:
    is_prime = False
for i in range(2, int(n**0.5) + 1):
    if n % i == 0:
        is_prime = False
        break
print(is_prime)`;
const fpD = computeFingerprint(codeD, 'python');
const cmp4 = compareFingerprints(fpA1.fingerprints, fpD.fingerprints);
console.log({ similarity: cmp4.similarity });
ok(
  'Unrelated algorithms score below the notable threshold (60)',
  cmp4.similarity < 60,
  `${cmp4.similarity}% - some overlap from shared "read input" boilerplate is expected; this is exactly why flagging (see test 7) uses the class-relative baseline and never this raw number alone`
);

console.log('\n=== 5) Matched-span mapping (for the diff view) ===');
const cmpSpans = compareFingerprints(fpA1.fingerprints, fpB.fingerprints);
const spansA = getMatchedSpans(fpA1.fingerprints, cmpSpans.shared);
console.log('matched spans in doc A:', spansA);
ok('At least one matched span found', spansA.length > 0);
ok('Spans are valid [start,end] ranges within source length', spansA.every(([s, e]) => s >= 0 && e <= codeA1.length && s < e));

console.log('\n=== 6) Class report: trivial problem where everyone converges -> nobody flagged ===');
// Five *independently written* but structurally-forced-similar solutions to a trivial problem.
const trivialSubmissions = [
  { submissionId: 1, userId: 1, userName: 'Ada', language: 'python', code: 'a=int(input())\nb=int(input())\nprint(a+b)' },
  { submissionId: 2, userId: 2, userName: 'Bob', language: 'python', code: 'x = int(input())\ny = int(input())\nprint(x + y)' },
  { submissionId: 3, userId: 3, userName: 'Cem', language: 'python', code: 'first = int(input())\nsecond = int(input())\nprint(first+second)' },
  { submissionId: 4, userId: 4, userName: 'Duru', language: 'python', code: 'p=int(input())\nq=int(input())\ns=p+q\nprint(s)' },
  { submissionId: 5, userId: 5, userName: 'Ece', language: 'python', code: 'num1=int(input())\nnum2=int(input())\nprint(num1 + num2)' },
];
const trivialReport = computeClassReport(trivialSubmissions);
console.log('baseline:', trivialReport.baseline, '| pairs:', trivialReport.pairs.map(p => `${p.similarity}%${p.isNotable ? ' [NOTABLE]' : ''}`));
ok('No pair flagged as notable when everyone is equally similar', trivialReport.pairs.every(p => !p.isNotable));

console.log('\n=== 7) Class report: one copied pair standing out among varied solutions -> should be flagged ===');
const variedSubmissions = [
  { submissionId: 10, userId: 10, userName: 'Fikret', language: 'python', code:
    'a=int(input())\nb=int(input())\nprint(a+b)' },
  { submissionId: 11, userId: 11, userName: 'Gul', language: 'python', code:
    'total=0\nfor _ in range(2):\n    total+=int(input())\nprint(total)' },
  { submissionId: 12, userId: 12, userName: 'Hakan', language: 'python', code:
    'nums=[int(input()) for _ in range(2)]\nprint(sum(nums))' },
  // 13 and 14: near-identical to each other (a copy), but different from the rest of the class
  { submissionId: 13, userId: 13, userName: 'Irem', language: 'python', code:
    'def read_val():\n    return int(input())\nleft = read_val()\nright = read_val()\ncombined = left + right\nprint(combined)' },
  { submissionId: 14, userId: 14, userName: 'Jale', language: 'python', code:
    'def read_val():\n    return int(input())\nfirst = read_val()\nsecond = read_val()\ncombined = first + second\nprint(combined)' },
];
const variedReport = computeClassReport(variedSubmissions);
console.log('baseline:', variedReport.baseline, '| pairs:');
variedReport.pairs.forEach(p => console.log(`  ${p.userNameA} <-> ${p.userNameB}: ${p.similarity}%${p.isNotable ? '  [NOTABLE]' : ''}`));
const notablePair = variedReport.pairs.find(p => p.isNotable);
ok('The Irem/Jale pair is flagged as notable', notablePair && new Set([notablePair.userNameA, notablePair.userNameB]).size === 2 &&
  ['Irem', 'Jale'].includes(notablePair.userNameA) && ['Irem', 'Jale'].includes(notablePair.userNameB));

console.log('\n=== 8) Cross-language safety: tokenizer does not crash on C++/Java ===');
const cppCode = `#include <iostream>
using namespace std;
int main() {
    int a, b;
    cin >> a >> b;
    cout << a + b << endl;
    return 0;
}`;
const javaCode = `import java.util.Scanner;
public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int a = sc.nextInt();
        int b = sc.nextInt();
        System.out.println(a + b);
    }
}`;
const fpCpp = computeFingerprint(cppCode, 'cpp');
const fpJava = computeFingerprint(javaCode, 'java');
console.log({ cppTokens: fpCpp.tokenCount, cppFingerprints: fpCpp.fingerprints.length, javaTokens: fpJava.tokenCount, javaFingerprints: fpJava.fingerprints.length });
ok('C++ tokenized without error', fpCpp.tokenCount > 0);
ok('Java tokenized without error', fpJava.tokenCount > 0);

console.log('\nAll similarity engine tests completed.');
