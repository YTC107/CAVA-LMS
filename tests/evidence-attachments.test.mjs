import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../', import.meta.url);
const read = path => fs.readFileSync(new URL(path, root), 'utf8');
const migration = read('supabase/migrations/20260916150000_evidence_attachments.sql');
const functionSource = read('supabase/functions/evidence-attachments/index.ts');
const hub = read('index.html');

test('evidence migration models one physical file and reusable criterion links', () => {
  assert.match(migration, /create table if not exists public\.evidence_attachments/);
  assert.match(migration, /create table if not exists public\.evidence_attachment_criteria/);
  assert.match(migration, /unique \(attachment_id, unit_code, learning_outcome_code, assessment_criterion\)/);
  assert.match(migration, /unit_code in \('unit2','unit3'\)/);
  assert.match(migration, /alter table public\.evidence_attachments enable row level security/);
  assert.match(migration, /values \('cava-evidence', 'cava-evidence', false\)/);
});

test('evidence function uses authenticated allocation ownership and private signed access', () => {
  assert.match(functionSource, /auth\.getUser\(token\)/);
  assert.match(functionSource, /from\('assessor_assignments table'\)/);
  assert.match(functionSource, /eq\('assessor_id', owner\)/);
  assert.match(functionSource, /eq\('learner_id', learnerId\)/);
  assert.match(functionSource, /createSignedUploadUrl\(path\)/);
  assert.match(functionSource, /createSignedUrl\(attachment\.storage_path, 300\)/);
  assert.match(functionSource, /status === 'locked'/);
  assert.match(functionSource, /storage\.from\(bucket\)\.remove/);
  assert.match(functionSource, /pathFor\(owner, body\.learnerId/);
  assert.match(functionSource, /async function isSuperAdmin\(owner/);
  assert.match(functionSource, /async function allocationExists\(owner, learnerId\)/);
  assert.match(functionSource, /data\.owner_id === owner/);
  assert.match(functionSource, /Only the owning assessor can remove evidence/);
});

test('evidence accepts common CAVA document and image formats', () => {
  for (const mime of [
    'application/pdf', 'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain', 'image/jpeg', 'image/png', 'image/gif', 'image/webp'
  ]) assert.match(functionSource, new RegExp(mime.replaceAll('.', '\\.'), 'g'));
  assert.match(hub, /input\.accept = '\.pdf,\.doc,\.docx,\.xls,\.xlsx,\.ppt,\.pptx,\.txt,\.jpg,\.jpeg,\.png,\.gif,\.webp/);
});

test('evidence function exposes the proof-of-concept lifecycle', () => {
  for (const action of ['create-upload', 'complete-upload', 'list', 'download', 'remove']) {
    assert.match(functionSource, new RegExp(`body\\.action === '${action}'`));
  }
  assert.match(functionSource, /status: 'pending'/);
  assert.match(functionSource, /status: 'uploaded'/);
  assert.match(functionSource, /status: 'failed'/);
});

test('embedded Unit 2 and Unit 3 ACs use the shared persistent uploader', () => {
  assert.match(hub, /initialiseEvidenceUploaders/);
  assert.match(hub, /input\.multiple = true/);
  assert.match(hub, /Array\.from\(input\.files \|\| \[\]\)/);
  assert.match(hub, /input\.value = ''/);
  assert.match(hub, /uploadToSignedUrl/);
  assert.match(hub, /Uploaded evidence \(' \+ state\.attachments\.length \+ '\)/);
  assert.match(hub, /data-evidence-list/);
  assert.match(hub, /evidenceRequest\('remove'/);
  assert.match(hub, /state\.uploads\.push\(upload\)/);
  assert.match(hub, /Upload failed/);
  assert.match(hub, /document\.querySelectorAll\('input\[data-evidence-context\]'\)/);
  assert.match(hub, /data-evidence-context="unit2\|l1\|lo1\|1\.1"/);
  assert.match(hub, /data-evidence-context="unit3\|l2\|lo4\|4\.3"/);
  assert.match(hub, /select\('learner_id,learner_slot'\)/);
  assert.match(hub, /l1: l1Rows\.length === 1 \? l1Rows\[0\]\.learner_id : ''/);
  assert.match(hub, /l2: l2Rows\.length === 1 \? l2Rows\[0\]\.learner_id : ''/);
  assert.match(hub, /row\.learner_slot === 'l1'/);
  assert.match(hub, /row\.learner_slot === 'l2'/);
  assert.match(hub, /l1Rows\.length > 1/);
  assert.match(hub, /l2Rows\.length > 1/);
  assert.match(hub, /l1Rows\[0\]\.learner_id === l2Rows\[0\]\.learner_id/);
  assert.match(hub, /This learner slot is not currently allocated/);
  assert.doesNotMatch(hub, /learner_type/);
  assert.doesNotMatch(hub, /ids\[0\]|ids\.find\(|full_name \|\|/);
  assert.equal((hub.match(/data-evidence-context="(?:unit2|unit3)\|/g) || []).length, 59);
  assert.equal((hub.match(/data-evidence-list/g) || []).length >= 59, true);
  assert.doesNotMatch(hub, /onchange="showFilename\(this,'fn-l[12]-lo[1-4]-ac[1-6]'\)/);
  assert.doesNotMatch(hub, /onchange="showFilenameUnit3\(this\)"[^>]*id="u3-[^"]+-ac[1-6]-files"/);
  assert.match(hub, /Deno\.serve/);
});

test('learner-slot migration preserves NULL rows and enforces one slot per assessor', () => {
  const slots = read('supabase/migrations/20260918120000_add_assessor_learner_slots.sql');
  assert.match(slots, /add column if not exists learner_slot text/);
  assert.match(slots, /check \(learner_slot in \('l1', 'l2'\)\)/);
  assert.match(slots, /where learner_slot = 'l1'/);
  assert.match(slots, /where learner_slot = 'l2'/);
  assert.match(slots, /if not exists/);
});
