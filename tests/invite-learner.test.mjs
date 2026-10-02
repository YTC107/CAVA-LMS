import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../', import.meta.url);
const read = path => fs.readFileSync(new URL(path, root), 'utf8');

const inviteFunction = read('supabase/functions/invite-learner/index.ts');
const updateFunction = read('supabase/functions/update-learner-profile/index.ts');

test('invite-learner function uses admin auth and validates input', () => {
  assert.match(inviteFunction, /auth\.getUser\(token\)/);
  assert.match(inviteFunction, /from\('super_admins'\)/);
  assert.match(inviteFunction, /auth\.admin\.inviteUserByEmail/);
  assert.match(inviteFunction, /from\('learners'\)/);
  assert.match(inviteFunction, /full_name.*trim/);
  assert.match(inviteFunction, /email.*trim.*toLowerCase/);
  assert.match(inviteFunction, /learner_type.*trim/);
  assert.match(inviteFunction, /contact_number/);
  assert.match(inviteFunction, /programme_start_date/);
  assert.match(inviteFunction, /Deno\.serve\(handler\)/);
});

test('invite-learner handles existing email cases safely', () => {
  assert.match(inviteFunction, /findLearnerByEmail/);
  assert.match(inviteFunction, /findAuthUserByEmail/);
  assert.match(inviteFunction, /learner_exists/);
  assert.match(inviteFunction, /learner_auth_mismatch/);
  assert.match(inviteFunction, /orphan_learner_record/);
  assert.match(inviteFunction, /orphan_auth_user/);
});

test('invite-learner prevents orphaned records with compensating cleanup', () => {
  assert.match(inviteFunction, /auth\.admin\.deleteUser/);
  assert.match(inviteFunction, /learner_insert_failed/);
  assert.match(inviteFunction, /CRITICAL: Failed to clean up orphaned auth user/);
});

test('invite-learner supports resend invitation for existing learners', () => {
  assert.match(inviteFunction, /handleExistingLearnerInvite/);
  assert.match(inviteFunction, /body\.mode === 'existing'/);
  assert.match(inviteFunction, /body\.learner_id/);
  assert.match(inviteFunction, /auth\.admin\.generateLink/);
  assert.match(inviteFunction, /type: 'magiclink'/);
  assert.match(inviteFunction, /no_auth_account/);
  assert.match(inviteFunction, /link_generation_failed/);
  assert.match(inviteFunction, /invite_failed/);
  assert.match(inviteFunction, /learner_update_failed/);
  assert.match(inviteFunction, /invited_at.*new Date.*toISOString/);
});

test('invite-learner returns structured errors and uses correct redirect', () => {
  assert.match(inviteFunction, /redirectTo.*account-access\.html/);
  assert.match(inviteFunction, /code: 'invite_failed'/);
  assert.match(inviteFunction, /code: 'learner_exists'/);
  assert.match(inviteFunction, /code: 'internal_error'/);
  assert.match(inviteFunction, /console\.info.*Invite learner request/);
  assert.match(inviteFunction, /console\.error.*Auth invitation failed/);
});

test('update-learner-profile function uses admin auth and validates input', () => {
  assert.match(updateFunction, /auth\.getUser\(token\)/);
  assert.match(updateFunction, /from\('super_admins'\)/);
  assert.match(updateFunction, /from\('learners'\)/);
  assert.match(updateFunction, /full_name.*trim/);
  assert.match(updateFunction, /email.*trim.*toLowerCase/);
  assert.match(updateFunction, /contact_number/);
  assert.match(updateFunction, /VALID_LEARNER_TYPES.*funded.*commercial.*mentor.*unassigned/);
  assert.match(updateFunction, /Deno\.serve\(handler\)/);
});

test('update-learner-profile handles email changes with auth sync', () => {
  assert.match(updateFunction, /checkEmailAvailable/);
  assert.match(updateFunction, /findAuthUserByEmail/);
  assert.match(updateFunction, /auth\.admin\.updateUserById/);
  assert.match(updateFunction, /email_taken/);
  assert.match(updateFunction, /email_auth_conflict/);
  assert.match(updateFunction, /auth_email_update_failed/);
});

test('update-learner-profile preserves learner_type only when provided', () => {
  assert.match(updateFunction, /hasLearnerType/);
  assert.match(updateFunction, /learnerType !== null/);
  assert.match(updateFunction, /updateData\.learner_type/);
});

test('update-learner-profile returns structured errors', () => {
  assert.match(updateFunction, /code: 'learner_not_found'/);
  assert.match(updateFunction, /code: 'learner_update_failed'/);
  assert.match(updateFunction, /code: 'internal_error'/);
  assert.match(updateFunction, /console\.info.*Update learner profile request/);
  assert.match(updateFunction, /console\.error.*Learner record update failed/);
});

test('both functions share consistent architecture patterns', () => {
  assert.match(inviteFunction, /origin = 'https:\/\/cava-learner-hub\.pages\.dev'/);
  assert.match(updateFunction, /origin = 'https:\/\/cava-learner-hub\.pages\.dev'/);
  assert.match(inviteFunction, /Access-Control-Allow-Origin/);
  assert.match(updateFunction, /Access-Control-Allow-Origin/);
  assert.match(inviteFunction, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(updateFunction, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(inviteFunction, /UUID/);
  assert.match(updateFunction, /UUID/);
  assert.match(inviteFunction, /EMAIL/);
  assert.match(updateFunction, /EMAIL/);
});

test('both functions use supported Supabase Admin Auth methods (no getUserByEmail)', () => {
  assert.doesNotMatch(inviteFunction, /auth\.admin\.getUserByEmail/);
  assert.doesNotMatch(updateFunction, /auth\.admin\.getUserByEmail/);
  assert.match(inviteFunction, /auth\.admin\.listUsers\(\)/);
  assert.match(updateFunction, /auth\.admin\.listUsers\(\)/);
  assert.match(inviteFunction, /\.find\(u => u\.email/);
  assert.match(updateFunction, /\.find\(u => u\.email/);
});

const indexHtml = read('index.html');

test('Action Plan uploads use unified evidence attachment architecture', () => {
  assert.match(indexHtml, /data-evidence-context-base="action-plan\|l1"/);
  assert.match(indexHtml, /data-evidence-context-base="action-plan\|l2"/);
  assert.match(indexHtml, /data-evidence-context="action-plan\|l1\|initial"/);
  assert.match(indexHtml, /data-evidence-context="action-plan\|l2\|initial"/);
  assert.match(indexHtml, /data-evidence-list/);
  assert.doesNotMatch(indexHtml, /data-action-plan-list/);
  // Each plan-block should have data-evidence-context-base and its file input should have data-evidence-context
  assert.match(indexHtml, /plan-block[\s\S]*data-evidence-context-base="action-plan/);
  assert.match(indexHtml, /data-evidence-context="action-plan\|l1\|initial"/);
  assert.match(indexHtml, /data-evidence-context="action-plan\|l2\|initial"/);
});

test('evidenceContext parses Action Plan contexts correctly', () => {
  assert.match(indexHtml, /ctx\[0\] === 'action-plan'/);
  assert.match(indexHtml, /learningOutcomeCode: ctx\[1\]/);
  assert.match(indexHtml, /assessmentCriterion: ctx\[2\]/);
});

test('uploadEvidenceFile validates Action Plan type selection', () => {
  assert.match(indexHtml, /context\.unitCode === 'action-plan' && !context\.assessmentCriterion/);
  assert.match(indexHtml, /Please select an Action Plan Type before attaching a document/);
  assert.match(indexHtml, /const isActionPlan = context\.unitCode === 'action-plan'/);
  assert.match(indexHtml, /evidenceType = isActionPlan \? 'action-plan'/);
});

test('Action Plan dropdown updates evidence context on change', () => {
  assert.match(indexHtml, /plan-block select\[id\$="-plan-type"\]/);
  assert.match(indexHtml, /Session Review & Action Plan/);
  assert.match(indexHtml, /baseContext \+ '\|' \+ planType/);
  assert.match(indexHtml, /fileInput\.dataset\.evidenceContext/);
  assert.match(indexHtml, /block\.dataset\.evidenceContext/);
});