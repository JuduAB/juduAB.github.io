const fs = require('node:fs');
const path = require('node:path');
const core = require('../js/matcher-core.js');

const goldenPath = path.join(__dirname, '..', 'tests', 'golden-matches.json');
const golden = JSON.parse(fs.readFileSync(goldenPath, 'utf8'));
const failures = [];

for (const testCase of golden.cases) {
  const actual = core.matchFeatures(testCase.query_mfcc, golden.reference_features);
  const actualCategory = actual ? actual.category : null;
  if (actualCategory !== testCase.expected_category) {
    failures.push(`${testCase.id}: category ${actualCategory} != ${testCase.expected_category}`);
    continue;
  }
  if (actual && Math.abs(actual.confidence - testCase.expected_confidence) > golden.confidence_tolerance) {
    failures.push(`${testCase.id}: confidence ${actual.confidence} != ${testCase.expected_confidence}`);
  }
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`JS matcher matches ${golden.cases.length} Python golden cases.`);
}