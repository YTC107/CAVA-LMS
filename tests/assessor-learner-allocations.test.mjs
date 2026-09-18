import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../', import.meta.url);
const read = path => fs.readFileSync(new URL(path, root), 'utf8');
const hub = read('assessor-hub.html');
const functionSource = read('supabase/functions/assessor-learner-allocations/index.ts');
const learnerHub = read('index.html');

test('Assessor Hub allocation UI uses UUID-backed l1 and l2 slots', () => {
  assert.match(hub, /Learner 1 — Level 2 Gym Instructor/);
  assert.match(hub, /Learner 2 — Level 3 Personal Trainer/);
  assert.match(hub, /data-allocation-slot="l1"/);
  assert.match(hub, /data-allocation-slot="l2"/);
  assert.match(hub, /learnerId:select\.value/);
  assert.match(hub, /targetAssessorId/);
  assert.match(hub, /learnerOptions/);
  assert.match(hub, /legacy text fields above are display-only/);
});

test('allocation Edge Function protects and implements list, assign and remove', () => {
  assert.match(functionSource, /auth\.getUser\(token\)/);
  assert.match(functionSource, /auth\.admin\.getUserById\(id\)/);
  assert.match(functionSource, /from\('learners'\)\.select\('id'\)\.eq\('auth_user_id', id\)/);
  assert.match(functionSource, /from\('super_admins'\)/);
  assert.match(functionSource, /body\.action === 'list'/);
  assert.match(functionSource, /body\.action === 'assign'/);
  assert.match(functionSource, /body\.action === 'remove'/);
  assert.match(functionSource, /validSlot/);
  assert.match(functionSource, /learner_slot/);
  assert.match(functionSource, /already assigned to the other learner slot/);
  assert.match(functionSource, /Deno\.serve\(handler\)/);
  assert.doesNotMatch(functionSource, /learner_assessor_allocations/);
});

test('allocation rollout preserves evidence authority and contexts', () => {
  assert.match(learnerHub, /from\('assessor_assignments table'\)\.select\('learner_id,learner_slot'\)/);
  assert.doesNotMatch(learnerHub, /from\('learner_assessor_allocations'\)/);
  assert.equal((learnerHub.match(/data-evidence-context="(?:unit2|unit3)\|/g) || []).length, 60);
});
