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

test('embedded AC 1.1 uses persistent append/list wiring without a count limit', () => {
  assert.match(hub, /data-evidence-poc|initialiseEvidencePoc/);
  assert.match(hub, /input\.multiple = true/);
  assert.match(hub, /Array\.from\(input\.files \|\| \[\]\)/);
  assert.match(hub, /input\.value = ''/);
  assert.match(hub, /uploadToSignedUrl/);
  assert.match(hub, /Uploaded evidence \(' \+ attachments\.length \+ '\)/);
  assert.match(hub, /data-evidence-list/);
  assert.match(hub, /evidencePocRequest\('remove'/);
  assert.match(hub, /evidencePocUploads\.push\(upload\)/);
  assert.match(hub, /Upload failed/);
  assert.match(hub, /input\.removeAttribute\('onchange'\)/);
  assert.match(hub, /textContent\.includes\('AC 1\.1'\)/);
  assert.match(hub, /legacyDisplay\.hidden = true/);
});
