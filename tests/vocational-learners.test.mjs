import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../', import.meta.url);
const read = path => fs.readFileSync(new URL(path, root), 'utf8');
const hub = read('index.html');
const assessorHub = read('assessor-hub.html');
const functionSource = read('supabase/functions/cava-vocational-learners/index.ts');
const migration = read('supabase/migrations/20260919120000_add_cava_vocational_learners.sql');

test('vocational learner records are assessor-owned and slot-labelled', () => {
  assert.match(migration, /create table if not exists public\.cava_vocational_learners/);
  assert.match(migration, /assessor_id uuid not null/);
  assert.match(migration, /learner_slot text not null check \(learner_slot in \('l1', 'l2'\)\)/);
  assert.match(migration, /unique \(assessor_id, learner_slot\)/);
  assert.match(migration, /qualification_label text not null/);
  assert.match(migration, /alter table public\.evidence_attachments/);
  assert.match(migration, /learner_source text not null default 'legacy'/);
  assert.match(migration, /drop constraint if exists evidence_attachments_learner_id_fkey/);
  assert.doesNotMatch(migration, /insert into public\.learners/);
  assert.doesNotMatch(migration, /learner_assessor_allocations/);
});

test('vocational learner function validates ownership and preserves slot identity', () => {
  assert.match(functionSource, /auth\.getUser\(token\)/);
  assert.match(functionSource, /from\('cava_vocational_learners'\)/);
  assert.match(functionSource, /body\.action === 'list'/);
  assert.match(functionSource, /body\.action !== 'save'/);
  assert.match(functionSource, /labels = \{l1: 'Level 2 Gym Instructor', l2: 'Level 3 Personal Trainer'\}/);
  assert.match(functionSource, /upsert\(/);
  assert.match(functionSource, /Deno\.serve\(handler\)/);
  assert.doesNotMatch(functionSource, /learner_assessor_allocations/);
});

test('Learner Hub captures details once and evidence resolves vocational UUIDs first', () => {
  assert.match(hub, /vocationalL1Name/);
  assert.match(hub, /vocationalL2Name/);
  assert.match(hub, /vocationalLearnerRequest\('save'/);
  assert.match(hub, /from\('cava_vocational_learners'\)/);
  assert.match(hub, /vocationalRows\.find\(row => row\.learner_slot === 'l1'\)/);
  assert.match(hub, /vocationalRows\.find\(row => row\.learner_slot === 'l2'\)/);
  assert.match(hub, /Learner 1 • Level 2 Gym Instructor • '/);
  assert.match(hub, /Learner 2 • Level 3 Personal Trainer • '/);
  assert.match(hub, /from\('assessor_assignments table'\)/);
  assert.equal((hub.match(/data-evidence-context="(?:unit2|unit3)\|/g) || []).length, 60);
});

test('Assessor Hub is read-only for submitted vocational details', () => {
  assert.match(assessorHub, /Vocational Learner Details/);
  assert.match(assessorHub, /cava-vocational-learners/);
  assert.match(assessorHub, /Details supplied by the trainee assessor/);
  assert.doesNotMatch(assessorHub, /assessor-learner-allocations/);
  assert.doesNotMatch(assessorHub, /data-allocation-slot/);
  assert.doesNotMatch(assessorHub, /assessor-learner-allocations/);
});
