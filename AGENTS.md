# CAVA-LMS Agent Instructions

Read `CAVA-LMS-DEVELOPER-HANDOVER.md` before making changes.

## Operating rules

1. This is an existing CAVA Learner/Assessor Hub. Do not rebuild, redesign or replace working areas unless the task explicitly requires it.
2. Inspect the current implementation, recent commits, relevant tests, Supabase migrations/functions and documentation before editing.
3. Treat GitHub `YTC107/CAVA-LMS` as the source of truth. Work from the current code, not an older concept, screenshot or generated replacement.
4. Make minimal, scoped, coherent changes. Preserve unrelated UI, assessment content, records, workflows and styling.
5. Never commit or expose secrets, service-role keys, OAuth client secrets, refresh tokens, encryption keys, app passwords or learner credentials.
6. Preserve security boundaries, identity checks, RLS/private-schema controls, credential encryption and duplicate-send protections.
7. The trainee assessor's connected Action Plan sender must match their confirmed Learner Hub email. The PT Academy support mailbox must never be substituted as the Action Plan sender.
8. Dashboard support email is separate from the Action Plan mailbox workflow. Do not couple the two.
9. Preserve the established CAVA model: Learner 1 is Level 2 Gym Instructor/green; Learner 2 is Level 3 Personal Trainer/purple; vocational programme components are distinct from the trainee assessor's CAVA criteria.
10. Action Plans are live assessment-planning documents used with allocated vocational learners, not retrospective paperwork created only to satisfy CAVA.
11. Reflective Accounts explain assessment practice and reasoning using the established structure: Context, What I did, Why, Learner involvement, Evidence, Reflection.
12. Evidence guidance is criterion-specific. Do not turn it into one unrestricted generic list. At least two relevant pieces are normally required for each criterion, but file count alone does not prove the criterion.
13. Preserve existing Pass/Refer, assessor feedback, signatures, declarations, saved-record, finalisation and PDF behaviour unless the scoped task explicitly changes them.
14. Prefer shared fixes for shared behaviour rather than isolated patches repeated across Learning Outcomes.
15. Protect learner and assessor personal information in fixtures, screenshots, logs and demonstrations.
16. Run the relevant automated tests before committing. Report exactly what was tested and distinguish mocked/local tests from live browser/provider tests.
17. Do not claim external email/OAuth functionality is working until a real authorised end-to-end test has passed.
18. If Google, Microsoft, Supabase or another provider requires a manual project-owner approval/configuration action, stop at that exact point and give a precise instruction. Do not work around provider security requirements.
19. Do not replace existing Google OAuth IDs/secrets, the Action Plan token encryption key or callback configuration merely to fix a test-user/consent problem. Diagnose the existing setup first.
20. Do not introduce paid services, subscriptions or infrastructure unless the project owner explicitly approves the cost first.

## Before every coding task

- Read the handover.
- Inspect the affected code.
- State the current behaviour and intended change.
- Identify the smallest set of affected files.
- Check for existing tests before writing new implementation.

## Before finishing every coding task

- Run relevant tests.
- Review the diff for unrelated changes.
- Confirm no secrets or personal data were introduced.
- State what is fixed, what was tested and anything that still requires a real-user/provider test.
- Commit with a clear, specific message.