# CAVA-LMS Developer Handover

Last reviewed: 15 September 2026

## Purpose

CAVA-LMS is the PT Academy platform supporting delivery of the Focus Awards Level 3 Certificate in Assessing Vocational Achievement (RQF), referred to throughout the learner-facing platform as CAVA.

This is an existing live build. It must be improved incrementally, not rebuilt or replaced with a new concept.

## Source of truth and infrastructure

- GitHub repository: `YTC107/CAVA-LMS`
- Production branch: `main`
- Front end is currently published through GitHub Pages.
- Supabase project ref: `qwjejqqgkvkroqhmfglg`
- Supabase provides authentication, database services and Edge Functions.
- Google Cloud provides the existing Google OAuth configuration used by the Action Plan mailbox workflow.
- Never commit credentials, OAuth client secrets, Supabase service-role keys, encryption keys, app passwords or other secrets to GitHub.

Before changing anything, inspect the current repository, recent commits, migrations, Edge Functions, tests and relevant documentation. Do not assume this document replaces the implementation.

## CAVA delivery model

A trainee assessor completes CAVA after relevant vocational preparation. The trainee receives two allocated vocational learners and gathers evidence through actual assessment practice over time.

Allocated learner identification:

- Learner 1: Level 2 Gym Instructor, identified in green.
- Learner 2: Level 3 Personal Trainer, identified in purple.

The Hub does not create assessment evidence for the trainee. The trainee assessor's work with allocated vocational learners creates the evidence. The Learner Hub is where the trainee demonstrates, uploads and reflects on that work for CAVA.

The platform must preserve the distinction between:

1. the trainee assessor who is completing CAVA;
2. the trainee assessor's allocated vocational learners; and
3. the CAVA assessment criteria against which the trainee assessor is judged.

Do not confuse a vocational learner's programme components with the trainee assessor's CAVA Learning Outcomes or assessment criteria.

## Qualification structure in the Hub

The Hub supports Units 1, 2 and 3. Units 2 and 3 include the practical evidence and assessment workflows currently implemented in the Learner Hub.

Existing Unit 2 and Unit 3 assessment content, Pass/Refer controls, feedback, signatures, declarations, saved records and assessment logic must be preserved unless a scoped requirement explicitly changes them.

Where Unit 2 and Unit 3 share equivalent interaction patterns, maintain visual and behavioural consistency rather than applying isolated page-specific patches.

## Assessment evidence principles

Evidence selection is criterion-specific. Do not replace it with one unrestricted generic evidence list.

For each assessment criterion, the learner is guided to choose at least two relevant pieces of evidence that demonstrate that criterion. Two uploaded files do not automatically prove an assessment criterion; relevance and sufficiency still matter.

Evidence suggestions are guidance, not an exhaustive list. Each criterion should allow an appropriate `Other relevant evidence` option with a description.

Seven assessment methods used across the vocational learners are:

- recognising prior learning;
- direct observation;
- examining work products;
- learner statement;
- witness statement;
- discussion;
- questioning.

The intended delivery model distributes these across the two allocated learners, normally three methods with one learner and four with the other where appropriate to the assessment activity.

Formal evidence considerations include validity, authenticity, currency, sufficiency and reliability.

Simulation must not replace real assessment activity where real assessment is required.

## Action Plans and Reviews

Action Plans are live vocational assessment documents completed with the allocated vocational learner. They are not retrospective documents manufactured purely to satisfy CAVA evidence requirements.

The working cycle is:

`PLAN -> AGREE -> ASSESS -> REVIEW -> NEXT ACTION`

An Action Plan may record:

- planned assessment activity;
- assessment method(s);
- evidence required;
- support and resources;
- submission method;
- target date;
- communication and agreement with the learner.

A Session Review records what happened, progress/outcome, feedback, gaps and the next agreed action.

A separate Action Plan is not required for every CAVA assessment criterion. One real Action Plan may support more than one criterion where the content directly demonstrates those requirements.

Action Plans & Reviews should form a clear chronological story of the vocational learner's progress and the trainee assessor's practice.

## Reflective Accounts

Reflective Accounts explain the trainee assessor's own assessment practice and professional reasoning rather than merely listing uploaded files.

The standard structure is:

1. Context
2. What I did
3. Why
4. Learner involvement
5. Evidence
6. Reflection

The reflection should allow the assessor/IQA to understand what happened, why decisions were made, how the vocational learner was involved, what evidence supports the account and what the trainee assessor learned or would develop next.

## Learner Hub journey

The established learner journey includes:

`Dashboard -> Introduction -> Assessment Plan -> Action Plans & Reviews -> Assessment Documents`

Existing navigation and approved workspace content should not be redesigned without an explicit requirement.

The Dashboard includes progress/next-step information, upcoming activity/support, assessment journey information and support functions.

The Assessment Plan is a working qualification plan with target dates and Unit 1/2/3 progression.

Assessment Documents contain Unit 2/3 evidence workspaces, reflective guidance, evidence upload/selection, assessor judgement and feedback, and tutorial-video locations.

## Video tutorial model

The planned core tutorial set consists of:

- Learner Hub Tour;
- Action Plan & Session Review tutorial;
- Reflective Account tutorial;
- Unit 2 LO1, LO2, LO3 and LO4 tutorials;
- Unit 3 LO1, LO2, LO3 and LO4 tutorials.

Videos should be embedded or linked into the established Hub tutorial locations so learners remain within the Hub journey rather than being expected to browse a Drive folder.

Do not hard-code temporary filming placeholders into the production learner experience.

## Action Plan mailbox architecture

The Action Plan email workflow has already been substantially implemented. Do not rebuild it from scratch.

The trainee assessor connects their own mailbox. The connected sending mailbox must match the trainee assessor's confirmed Learner Hub email address. The PT Academy support mailbox is not the sender or relay account for trainee Action Plans.

When the trainee selects `Send a copy to the learner by email` and finalises the record, the intended workflow is:

1. finalise/save the Action Plan or Session Review record;
2. generate the clean finalised record PDF;
3. send the PDF to the vocational learner email stored on that record;
4. send from the trainee assessor's connected mailbox;
5. allow the vocational learner to reply directly to that trainee assessor;
6. retain the trainee assessor's mailbox connection so reconnection is not required for every plan;
7. provide clear success/reconnect/error information and prevent accidental duplicate sends.

The deployed `action-plan-mailbox` Supabase Edge Function implements provider connection/status/disconnection and Action Plan sending. Inspect the live function and repository implementation before modifying it.

### Google

Preserve the existing Google OAuth configuration and secrets. The current callback is:

`https://qwjejqqgkvkroqhmfglg.supabase.co/functions/v1/action-plan-mailbox/callback`

The existing implementation uses Google OAuth/Gmail send permission and verifies that the connected Google identity matches the confirmed Hub email.

The current launch blocker observed during testing is Google OAuth `403: access_denied` while the application is in Google's testing/unverified state. During testing, actual authorised assessor Google accounts may need to be explicitly approved as test users. Public rollout may require the appropriate Google consent-screen publication/verification for the requested scopes.

Do not replace the existing Google OAuth client, token encryption key or redirect configuration simply to work around this error. Diagnose the existing Google configuration first.

### Microsoft and other providers

The repository contains multi-provider mailbox work including Microsoft OAuth and a protected SMTP relay path for supported non-OAuth providers. These are secondary to the immediate Google launch path. Do not introduce paid infrastructure solely to activate optional providers without an explicit decision.

See `docs/mailbox-setup.md` for the implementation-specific setup and security notes.

## Dashboard support email

Dashboard support email is a separate workflow from the Action Plan mailbox.

The `Prepare support email` action is intended to prepare/open an email containing the learner's support-request details and address it to the appropriate PT Academy support/assessor mailbox.

It must not send an Action Plan, impersonate the trainee assessor's mailbox or depend on the Action Plan mailbox connection.

A current outstanding issue is that the button has been observed not opening the prepared email reliably. Inspect the current front-end implementation before changing it and test the completed behaviour in the supported browser environment.

## Supabase deployment state

As of this handover, the connected Supabase project is active and includes Edge Functions for learner invitations/profile updates, assessment-plan workflow, learner/assessor engagement, learner notifications and `action-plan-mailbox`.

The mailbox Edge Function intentionally has `verify_jwt=false` because the OAuth callback cannot carry a Hub JWT; its POST paths perform their own user-token validation. Do not casually switch this setting without understanding the callback/custom-auth design.

Mailbox database changes are additive and include private credential/state handling. Preserve existing Action Plan records and email events.

Never expose service-role credentials, OAuth secrets, refresh tokens, encryption keys or SMTP/app passwords to the browser or repository.

## Existing mailbox tests

The repository includes mailbox tests and setup documentation. Before mailbox changes, inspect:

- `docs/mailbox-setup.md`
- `tests/`
- `mailbox-relay/`
- `supabase/functions/action-plan-mailbox/`
- relevant Supabase migrations.

Use the project's declared package scripts and dependency versions rather than inventing replacements. Automated provider tests use synthetic/mocked behaviour and do not prove live Google/Microsoft/provider-console readiness or real delivery. A real authorised mailbox test is still required before launch.

## Records and archive model

The Hub is the live qualification environment. On full completion/pass, the intended completed archive includes the consolidated assessment record/PDF and Assessment Plan PDF in the learner's PT Academy archive location. Do not prematurely turn the live Hub into a static archive.

## Current launch priorities

Work in this order unless the project owner explicitly changes the priority:

1. preserve and document the current working build;
2. resolve the Google OAuth/test-user blocker for the trainee-assessor mailbox;
3. test Action Plan finalisation, PDF generation, sending, connection persistence and direct reply end-to-end;
4. fix and test Dashboard `Prepare support email`;
5. embed/link approved tutorial videos into the existing Hub locations;
6. test the complete learner and assessor journeys;
7. invite the first live learners only after launch-critical workflows pass testing.

## Non-negotiable change rules

- This is an existing application. Do not restart or redesign it because a different implementation appears cleaner.
- Inspect before editing.
- Preserve approved CAVA assessment content and business rules.
- Preserve working authentication, saved records, finalisation and PDF behaviour.
- Make the smallest coherent change that solves the stated problem.
- Prefer shared fixes where the same behaviour exists in multiple Learning Outcomes.
- Do not delete working functionality as a shortcut.
- Do not weaken identity, authorisation, RLS, credential encryption or duplicate-send protection.
- Do not expose secrets in source, logs, browser storage, URLs or documentation.
- Do not use the PT Academy support mailbox as the sender of trainee assessor Action Plans.
- Do not change the trainee-assessor mailbox rule: connected sender must match the confirmed Learner Hub email.
- Protect learner and assessor personal information in demonstrations, screenshots, logs and test fixtures.
- Run relevant automated tests before committing changes and perform real end-to-end validation where external OAuth/email behaviour is involved.
- Keep GitHub `main` as the production source of truth; use controlled branches/commits for future development where practical.

## Communication and implementation discipline

For each development task:

1. state what currently exists;
2. identify the exact fault or requested change;
3. identify the files/functions affected;
4. preserve unrelated functionality;
5. implement the smallest coherent fix;
6. run relevant tests;
7. report what changed and what was actually verified;
8. distinguish simulated/local tests from real provider/browser tests;
9. if a provider requires a manual owner action, stop only at that action and state exactly what the project owner needs to approve or configure.

Do not claim a workflow is production-ready until the relevant end-to-end path has actually been tested.