-- Update evidence_attachment_criteria constraints to support Action Plan contexts
-- alongside existing Unit 2/3 evidence contexts.

-- 1. Update unit_code check to allow 'action-plan'
alter table public.evidence_attachment_criteria
  drop constraint if exists evidence_attachment_criteria_unit_code_check;

alter table public.evidence_attachment_criteria
  add constraint evidence_attachment_criteria_unit_code_check
  check (unit_code in ('unit2', 'unit3', 'action-plan'));

-- 2. Update learning_outcome_code check to allow 'l1', 'l2' for Action Plan
alter table public.evidence_attachment_criteria
  drop constraint if exists evidence_attachment_criteria_learning_outcome_code_check;

alter table public.evidence_attachment_criteria
  add constraint evidence_attachment_criteria_learning_outcome_code_check
  check (
    (unit_code = 'action-plan' and learning_outcome_code in ('l1', 'l2'))
    or (unit_code in ('unit2', 'unit3') and learning_outcome_code ~ '^lo[1-9][0-9]*$')
  );

-- 3. Update assessment_criterion check to allow 'initial', 'review' for Action Plan
alter table public.evidence_attachment_criteria
  drop constraint if exists evidence_attachment_criteria_assessment_criterion_check;

alter table public.evidence_attachment_criteria
  add constraint evidence_attachment_criteria_assessment_criterion_check
  check (
    (unit_code = 'action-plan' and assessment_criterion in ('initial', 'review'))
    or (unit_code in ('unit2', 'unit3') and assessment_criterion ~ '^[1-9][0-9]*\.[1-9][0-9]*$')
  );