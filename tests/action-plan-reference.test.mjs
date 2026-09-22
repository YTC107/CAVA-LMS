import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../', import.meta.url);
const read = path => fs.readFileSync(new URL(path, root), 'utf8');
const hub = read('index.html');
const mailboxFunction = read('supabase/functions/action-plan-mailbox/index.ts');
const referenceBlock = hub.slice(hub.indexOf('  function learnerInitials(name) {'), hub.indexOf('  function create(values = {}) {'));
const factory = records => new Function('records', referenceBlock + '; return {learnerInitials,reference,isCanonicalReference};')(records);
const make = factory([]);
const initial = (meetingNumber, meetingDate, learnerName = 'Mikey Kwame') => make.reference({ planType: 'Initial Action Plan', meetingNumber, meetingDate, learnerName });
const review = (meetingNumber, meetingDate, learnerName = 'Mikey Kwame') => make.reference({ planType: 'Session Review and Action Plan', meetingNumber, meetingDate, learnerName });

test('canonical references use plan type, learner initials, plan number and meeting date', () => {
  assert.equal(initial('1', '2026-09-14'), 'IAP-MK-01-14-09-2026');
  assert.equal(review('2', '2026-09-28'), 'SRAP-MK-02-28-09-2026');
  assert.equal(review('4', '2026-10-26'), 'SRAP-MK-04-26-10-2026');
  assert.match(initial('1', '2026-09-14'), /^IAP-[A-Z]+-\d{2}-\d{2}-\d{2}-\d{4}$/);
  assert.match(review('2', '2026-09-28'), /^SRAP-[A-Z]+-\d{2}-\d{2}-\d{2}-\d{4}$/);
  assert.equal(make.reference({ planType: 'Initial Action Plan', meetingNumber: '1', meetingDate: '2026-09-14', learnerName: '   ' }), '');
});

test('the plan number is the stored plan or review number, zero padded and never invented', () => {
  assert.equal(review('2', '2026-09-28'), 'SRAP-MK-02-28-09-2026');
  assert.equal(review('10', '2026-10-26'), 'SRAP-MK-10-26-10-2026');
  assert.equal(review('123', '2026-10-26'), 'SRAP-MK-123-26-10-2026');
  for (const missing of [undefined, '', '0', 'not-a-number', -4]) assert.equal(initial(missing, '2026-09-14'), 'IAP-MK-01-14-09-2026');
});

test('references are deterministic and never carry correction, recovery or timestamp suffixes', () => {
  const values = { planType: 'Initial Action Plan', meetingNumber: '1', meetingDate: '2026-09-14', learnerName: 'Mikey Kwame' };
  assert.equal(make.reference(values), make.reference(values));
  const withHistory = factory([
    { payload: { values: { recordRef: 'IAP-MK-01-14-09-2026-CORRECTED-CORRECTED-CORRECTED-CORRECTED-recovered' } } },
    { payload: { values: { recordRef: 'AP-14-09-2026-MK-02' } } }
  ]);
  assert.equal(withHistory.reference(values), 'IAP-MK-01-14-09-2026');
  const generated = [make.reference(values), make.reference({ ...values, planType: 'Session Review and Action Plan', meetingNumber: '2', meetingDate: '2026-09-28' })];
  generated.forEach(reference => assert.doesNotMatch(reference, /CORRECTED|recovered/i));
  assert.equal(make.isCanonicalReference('IAP-MK-01-14-09-2026'), true);
  assert.equal(make.isCanonicalReference('SRAP-MK-04-26-10-2026'), true);
  assert.equal(make.isCanonicalReference('IP-14-09-2026-01-CORRECTED-CORRECTED-recovered'), false);
  assert.equal(make.isCanonicalReference(''), false);
});

test('the canonical reference reaches the Hub record, PDF, filename and learner email unchanged', () => {
  // The Hub record reference is system generated and cannot be edited into a divergent value.
  assert.match(hub, /id="actionRecordRef"[^>]*readonly/);
  // Correction copies regenerate the canonical reference and keep the audit link to the original.
  assert.match(hub, /values\.recordRef = reference\(values\)/);
  assert.match(hub, /correctsRecordRef = source\.payload\.values\.recordRef/);
  // No code path may append CORRECTED, recovered or a timestamp to a reference.
  assert.doesNotMatch(hub, /-CORRECTED|-recovered/);
  // PDF header, record identification row and download filename all read the stored reference.
  assert.match(hub, /var reference = pdfSafeText\(values\.recordRef \|\| 'Draft record'\)/);
  assert.match(hub, /\{ label: 'Record reference', key: 'recordRef', value: values\.recordRef \|\| '' \}/);
  assert.match(hub, /var reference = pdfSafeText\(data\.values\.recordRef \|\| 'Action-Plan'\)/);
  // The learner email body prints the same stored reference.
  assert.match(mailboxFunction, /'Action Plan reference: ' \+ String\(v\.recordRef \|\| ''\)/);
});

test('PDF layout keeps the reference and long content inside the page and paginates safely', () => {
  // The header reference is shrink-to-fit, wrapped to at most two lines and clamped to the margin.
  assert.match(hub, /while \(refSize > 6 && regular\.widthOfTextAtSize\(reference, refSize\) > refLimit\)/);
  assert.match(hub, /x: Math\.max\(margin, pageWidth - margin - refWidth\)/);
  // Field heights follow wrapped content instead of a fixed 220pt cap.
  assert.match(hub, /var height = Math\.max\(options\?\.minHeight \|\| 54, \(lines\.length \* 12\) \+ 18\);/);
  // Tall or long blocks move to the sequential paginating field path.
  assert.match(hub, /height > y - 110/);
});
