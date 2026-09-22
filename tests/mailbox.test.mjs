import {test,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import {PGlite} from '@electric-sql/pglite';
const root=new URL('../',import.meta.url);
const read=p=>fs.readFileSync(new URL(p,root),'utf8');
const compile=p=>ts.transpileModule(read(p),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const referenceSource=read('index.html');
const referenceBlock=referenceSource.slice(referenceSource.indexOf('  function learnerInitials(name) {'),referenceSource.indexOf('  function create(values = {}) {'));
const referenceFactory=records=>new Function('records',referenceBlock+'; return {learnerInitials,reference,isCanonicalReference};')(records);
const security={};new Function('exports',compile('supabase/functions/action-plan-mailbox/security.ts'))(security);
const keyText=Buffer.alloc(32,173).toString('base64url');
const db=new PGlite();
await db.exec("create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql as 'select null::uuid';");
await db.exec(read('tests/legacy-schema.sql'));
await db.exec(read('supabase/mailbox-upgrade.sql'));
await db.exec(read('supabase/mailbox-upgrade.sql')); // additive upgrade is idempotent
const owner='11111111-1111-4111-8111-111111111111', other='22222222-2222-4222-8222-222222222222', plan='33333333-3333-4333-8333-333333333333';
await db.query('insert into auth.users values ($1),($2)',[owner,other]);
let account='assessor@example.com', providerEmail=account, requests=[], providerStatus=200, refreshDenied=false, delayedToken=null;
const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'test-only',SUPABASE_DB_URL:'test-only',ACTION_PLAN_TOKEN_KEY:keyText,ACTION_PLAN_GOOGLE_CLIENT_ID:'test-google-id',ACTION_PLAN_GOOGLE_CLIENT_SECRET:'test-google-secret',ACTION_PLAN_MICROSOFT_CLIENT_ID:'test-ms-id',ACTION_PLAN_MICROSOFT_CLIENT_SECRET:'test-ms-secret',ACTION_PLAN_SMTP_RELAY_URL:'https://relay.example.com/mailbox',ACTION_PLAN_SMTP_RELAY_KEY:'test-only-signing-secret-at-least-32-characters'};
const user=id=>({id,email:account,email_confirmed_at:'2026-01-01'});
const admin={auth:{
  getUser:async token=>token==='valid'?{data:{user:user(owner)}}:{data:{user:null},error:true},
  admin:{getUserById:async id=>({data:{user:user(id)}})}
}};
function sqlFor(database){
  const sql=async(strings,...params)=>{
    const query=strings.reduce((s,part,i)=>s+(i?'$'+i:'')+part,'');
    // PGlite is single-session; production advisory locks are covered by schema review, not emulated concurrency.
    if(query.includes('pg_advisory_xact_lock'))return [];
    const result=await database.query(query,params.map(p=>p instanceof Date?p.toISOString():p));return result.rows;
  };
  sql.begin=fn=>database.transaction(tx=>fn(sqlFor(tx)));
  return sql;
}
async function providerFetch(url,init){
  requests.push({url,init});
  if(url.includes('/token')){
    if(delayedToken)await delayedToken;
    if(refreshDenied)return Response.json({error:'invalid_grant',secret:'must-not-leak'},{status:400});
    return Response.json({access_token:'test-access',refresh_token:'rotated-test-refresh',scope:url.includes('google')?'openid email https://www.googleapis.com/auth/gmail.send':'openid email User.Read Mail.Send'});
  }
  if(url.includes('userinfo'))return Response.json({email:providerEmail,email_verified:true});
  if(url.includes('/me?'))return Response.json({mail:providerEmail,userPrincipalName:'not-the-mailbox@example.com'});
  if(url.includes('relay.example'))return Response.json(JSON.parse(init.body).action==='verify'?{verified:true}:{sent:true,messageId:'test-id'});
  if(providerStatus===0)throw new Error('test-network-drop');
  if(url.includes('sendMail'))return new Response(null,{status:providerStatus===200?202:providerStatus});
  if(url.includes('messages/send'))return Response.json({id:'test-message'},{status:providerStatus});
  throw Error('Unexpected URL '+url);
}
const exports={};
new Function('exports','require','Deno','fetch',compile('supabase/functions/action-plan-mailbox/index.ts'))(exports,p=>p.includes('supabase-js')?{createClient:()=>admin}:p.includes('postgres')?{default:()=>sqlFor(db)}:security,{env:{get:k=>env[k]},serve(){}},providerFetch);
const invoke=(body,token='valid')=>exports.handler(new Request('https://example.supabase.co/functions/v1/action-plan-mailbox',{method:'POST',headers:{Authorization:'Bearer '+token,Origin:'https://cava-learner-hub.pages.dev','Content-Type':'application/json'},body:JSON.stringify(body)}));
const callback=state=>exports.handler(new Request('https://example.supabase.co/functions/v1/action-plan-mailbox/callback?state='+state+'&code=test-code'));
const pdf=Buffer.from('%PDF-1.7\nfixture').toString('base64');
async function mailbox(provider='google',email=account,legacy=false){
  let cipher;
  const key=await security.credentialKey(keyText);
  if(legacy){const iv=crypto.getRandomValues(new Uint8Array(12));const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode('old-google-refresh'));cipher=Buffer.from(iv).toString('base64')+'.'+Buffer.from(encrypted).toString('base64');}
  else cipher=await security.encrypt('test-only-refresh',key,owner,provider);
  await db.query('insert into action_plan_private.mailboxes(owner_id,email,provider,token_cipher) values($1,$2,$3,$4)',[owner,email,provider,cipher]);
}
async function finalPlan(planOwner=owner,values={}){const {actionCount=undefined,...recordValues}=values;await db.query("insert into public.action_plan_records(id,owner_id,payload,status) values($1,$2,$3,'finalised')",[plan,planOwner,JSON.stringify({...(actionCount === undefined ? {} : {actionCount}),values:{assessorEmail:account,learnerEmail:'learner@example.com',learnerName:'Test Learner',assessorName:'Test Assessor',recordRef:'AP-TEST',...recordValues}})]);}
beforeEach(async()=>{await db.exec('delete from public.action_plan_email_events; delete from public.action_plan_records; delete from action_plan_private.mailboxes; delete from action_plan_private.oauth_states; delete from action_plan_private.connection_guards;');account='assessor@example.com';providerEmail=account;requests=[];providerStatus=200;refreshDenied=false;delayedToken=null;});
after(()=>db.close());
test('encrypted credentials bind to owner and provider, base64url keys work',async()=>{
  const key=await security.credentialKey(keyText),cipher=await security.encrypt('private-test-value',key,owner,'microsoft');
  assert.equal(await security.decrypt(cipher,key,owner,'microsoft'),'private-test-value');
  await assert.rejects(()=>security.decrypt(cipher,key,other,'microsoft'));
  await assert.rejects(()=>security.decrypt(cipher,key,owner,'google'));
  await assert.rejects(()=>security.decrypt(cipher.slice(0,-5)+'aaaaa',key,owner,'microsoft'));
});
test('unauthenticated requests fail and status never returns credentials',async()=>{
  assert.equal((await invoke({action:'status'},'bad')).status,401);
  await mailbox();const text=await(await invoke({action:'status'})).text();
  assert.equal(JSON.parse(text).connected,true);assert.equal(text.includes('token_cipher'),false);assert.equal(text.includes('refresh'),false);
});
test('Google PKCE state is single use and wrong mailbox is rejected',async()=>{
  const connected=await(await invoke({action:'connect',provider:'google'})).json();const url=new URL(connected.url);
  assert.equal(url.searchParams.get('code_challenge_method'),'S256');assert.equal(url.searchParams.get('redirect_uri'),'https://example.supabase.co/functions/v1/action-plan-mailbox/callback');
  providerEmail='somebody-else@example.com';
  const state=url.searchParams.get('state');assert.match((await callback(state)).headers.get('location'),/identity_mismatch/);
  assert.match((await callback(state)).headers.get('location'),/expired/);
  assert.equal((await db.query('select * from action_plan_private.mailboxes')).rows.length,0);
});
test('Microsoft connects and sends with Graph 202, rotates refresh token',async()=>{
  const connected=await(await invoke({action:'connect',provider:'microsoft'})).json();const url=new URL(connected.url);
  assert.equal(url.hostname,'login.microsoftonline.com');assert.match(url.searchParams.get('scope'),/offline_access/);
  assert.match((await callback(url.searchParams.get('state'))).headers.get('location'),/mailbox=connected/);
  await finalPlan();const result=await invoke({action:'send',planId:plan,pdf});assert.equal(result.status,200);
  const sent=requests.find(r=>r.url.includes('sendMail'));assert.ok(sent);assert.match(Buffer.from(sent.init.body,'base64').toString(),/From: assessor@example.com/);
  const row=(await db.query('select * from action_plan_private.mailboxes')).rows[0];assert.equal(await security.decrypt(row.token_cipher,await security.credentialKey(keyText),owner,'microsoft'),'rotated-test-refresh');
});
test('existing Gmail ciphertext survives migration and sends from the original assessor',async()=>{
  await mailbox('google',account,true);await finalPlan();assert.equal((await invoke({action:'send',planId:plan,pdf})).status,200);
  const sent=requests.find(r=>r.url.includes('messages/send'));const mime=Buffer.from(JSON.parse(sent.init.body).raw,'base64url').toString();assert.match(mime,/From: assessor@example.com\r\nTo: learner@example.com/);assert.ok(!mime.includes('ptacademy.cava.support'));
});
test('learner email includes dynamic actions, UK dates, review date and existing PDF attachment',async()=>{
  await mailbox();
  await finalPlan(owner,{learnerName:'  Coral Jamieson  ',assessorName:'Alex Assessor',recordRef:'AP-EMAIL',actionCount:3,planType:'Initial Action Plan',meetingDate:'2026-09-16T10:00',action0Task:'Complete the programme card.\n\nDetailed evidence instructions that must remain in the Action Plan.',action0Target:'2026-09-16',action1Task:'Submit the reflection',action1Target:'2026-10-07',action2Task:'   ',action2Target:'not-a-date',reviewDate:'2026-10-07T14:30'});
  assert.equal((await invoke({action:'send',planId:plan,pdf})).status,200);
  const sent=requests.find(r=>r.url.includes('messages/send'));const mime=Buffer.from(JSON.parse(sent.init.body).raw,'base64url').toString();const encodedBody=mime.split('Content-Transfer-Encoding: base64\r\n\r\n')[1].split('\r\n--')[0];const text=Buffer.from(encodedBody,'base64').toString();
  assert.match(mime,/Subject: =\?UTF-8\?B\?WW91ciBJbml0aWFsIFBsYW4g4oCTIDE2IFNlcHRlbWJlciAyMDI2\?=/);
  assert.match(text,/Hi Coral,/);
  assert.match(text,/Your agreed actions\r\n\r\nAction 1: Complete the programme card\r\nTarget date: 16 September 2026\r\n\r\nAction 2: Submit the reflection\r\nTarget date: 7 October 2026/);
  assert.match(text,/Next review: 7 October 2026/);
  assert.match(text,/Full details of your agreed actions are included in the attached Action Plan\./);
  assert.match(text,/Action Plan reference: AP-EMAIL/);
  assert.match(text,/Kind regards,\r\nAlex Assessor/);
  assert.doesNotMatch(text,/Detailed evidence instructions/);
  assert.match(mime,/Content-Type: application\/pdf; name="Action-Plan\.pdf"\r\nContent-Disposition: attachment; filename="Action-Plan\.pdf"\r\nContent-Transfer-Encoding: base64\r\n\r\n[\s\S]*JVBERi0xLjcKZml4dHVyZQ==/);
});
test('invalid or absent review date omits the next review line safely',async()=>{
  await mailbox();await finalPlan(owner,{actionCount:1,action0Task:'Complete the task',action0Target:'2026-02-30',reviewDate:'invalid'});
  assert.equal((await invoke({action:'send',planId:plan,pdf})).status,200);
  const sent=requests.find(r=>r.url.includes('messages/send'));const mime=Buffer.from(JSON.parse(sent.init.body).raw,'base64url').toString();const encodedBody=mime.split('Content-Transfer-Encoding: base64\r\n\r\n')[1].split('\r\n--')[0];const text=Buffer.from(encodedBody,'base64').toString();
  assert.doesNotMatch(text,/Next review:/);
  assert.match(text,/Action 1: Complete the task/);
});
test('canonical references use plan type, initials, plan number and meeting date',()=>{
  const first=referenceFactory([]);
  assert.equal(first.learnerInitials('   '),'');
  assert.equal(first.reference({planType:'Initial Action Plan',meetingNumber:'1',meetingDate:'2026-09-14',learnerName:'   '}),'');
  assert.equal(first.learnerInitials(' Megan  Louise King '),'MK');
  assert.equal(first.learnerInitials('Mary-Jane Smith'),'MS');
  assert.equal(first.reference({planType:'Initial Action Plan',meetingNumber:'1',meetingDate:'2026-09-14T10:00',learnerName:'Mikey Kwame'}),'IAP-MK-01-14-09-2026');
  assert.equal(first.reference({planType:'Session Review and Action Plan',meetingNumber:'2',meetingDate:'2026-09-28T10:00',learnerName:'Mikey Kwame'}),'SRAP-MK-02-28-09-2026');
  assert.equal(first.reference({planType:'Session Review and Action Plan',meetingNumber:'4',meetingDate:'2026-10-26',learnerName:'Mikey Kwame'}),'SRAP-MK-04-26-10-2026');
  assert.equal(first.reference({planType:'Session Review and Action Plan',meetingNumber:'10',meetingDate:'2026-10-26',learnerName:'Mikey Kwame'}),'SRAP-MK-10-26-10-2026');
  assert.equal(first.reference({planType:'Initial Action Plan',meetingDate:'2026-09-14',learnerName:'Mikey Kwame'}),'IAP-MK-01-14-09-2026');
  assert.equal(first.reference({planType:'Initial Action Plan',meetingNumber:'0',meetingDate:'2026-09-14',learnerName:'Mikey Kwame'}),'IAP-MK-01-14-09-2026');
  const invalidDate=first.reference({planType:'Initial Action Plan',meetingNumber:'1',meetingDate:'2026-02-30',learnerName:'Megan King'});
  assert.notEqual(invalidDate,'IAP-MK-01-30-02-2026');
  assert.match(invalidDate,/^IAP-MK-01-\d{2}-\d{2}-\d{4}$/);
  const missingDate=first.reference({planType:'Initial Action Plan',meetingNumber:'1',learnerName:'Megan King'});
  assert.match(missingDate,/^IAP-MK-01-\d{2}-\d{2}-\d{4}$/);
  assert.equal(first.isCanonicalReference('IAP-MK-01-14-09-2026'),true);
  assert.equal(first.isCanonicalReference('SRAP-MK-02-28-09-2026'),true);
  assert.equal(first.isCanonicalReference('IP-14-09-2026-01-CORRECTED-CORRECTED-recovered'),false);
  assert.equal(first.isCanonicalReference(''),false);
  const polluted=referenceFactory([{payload:{values:{recordRef:'IAP-MK-01-14-09-2026-CORRECTED-recovered'}}},{payload:{values:{recordRef:'AP-14-09-2026-MK-02'}}}]);
  assert.equal(polluted.reference({planType:'Initial Action Plan',meetingNumber:'1',meetingDate:'2026-09-14',learnerName:'Mikey Kwame'}),'IAP-MK-01-14-09-2026');
  assert.equal(first.reference({planType:'Initial Action Plan',meetingNumber:'1',meetingDate:'2026-09-14',learnerName:'Mikey Kwame'}),'IAP-MK-01-14-09-2026');
});
test('session review email uses Action Plan subject and reference-date fallback',async()=>{
  await mailbox();await finalPlan(owner,{planType:'Session Review and Action Plan',recordRef:'AP-14-09-2026-MK',actionCount:1,action0Task:'Review the submitted evidence',action0Target:'2026-09-23',meetingDate:'invalid'});
  assert.equal((await invoke({action:'send',planId:plan,pdf})).status,200);
  const sent=requests.find(r=>r.url.includes('messages/send'));const mime=Buffer.from(JSON.parse(sent.init.body).raw,'base64url').toString();const encodedBody=mime.split('Content-Transfer-Encoding: base64\r\n\r\n')[1].split('\r\n--')[0];const text=Buffer.from(encodedBody,'base64').toString();
  assert.match(mime,/Subject: =\?UTF-8\?B\?WW91ciBBY3Rpb24gUGxhbiDigKwgMTQgU2VwdGVtYmVyIDIwMjY=\?=/);
  assert.match(text,/Action Plan reference: AP-14-09-2026-MK/);
});
test('wrong owner, changed email and header injection cannot send',async()=>{
  await mailbox();await finalPlan(other);assert.equal((await invoke({action:'send',planId:plan,pdf})).status,409);assert.equal(requests.length,0);
  account='changed@example.com';assert.equal((await invoke({action:'send',planId:plan,pdf})).status,409);
  assert.throws(()=>security.assertIdentity('a@example.com','a@example.com\r\nBcc: victim@example.com'));
});
test('repeat send cannot deliver twice and timeout stays unknown',async()=>{
  await mailbox();await finalPlan();providerStatus=0;
  assert.equal((await invoke({action:'send',planId:plan,pdf})).status,502);
  assert.equal((await db.query('select status from public.action_plan_email_events')).rows[0].status,'unknown');
  assert.equal((await invoke({action:'send',planId:plan,pdf})).status,409);
  assert.equal(requests.filter(r=>r.url.includes('messages/send')).length,1);
});
test('revoked permission requires reconnect and never creates a send event',async()=>{
  await mailbox();await finalPlan();refreshDenied=true;
  const result=await invoke({action:'send',planId:plan,pdf});const text=await result.text();assert.equal(result.status,409);assert.ok(!text.includes('must-not-leak'));
  assert.equal((await db.query('select connection_status from action_plan_private.mailboxes')).rows[0].connection_status,'reconnect_required');assert.equal((await db.query('select * from public.action_plan_email_events')).rows.length,0);
});
test('disconnect invalidates a callback in progress',async()=>{
  const url=new URL((await(await invoke({action:'connect',provider:'google'})).json()).url);
  let release;delayedToken=new Promise(r=>release=r);const pending=callback(url.searchParams.get('state'));
  while(!requests.some(r=>r.url.includes('/token')))await new Promise(r=>setImmediate(r));
  await invoke({action:'disconnect'});release();assert.match((await pending).headers.get('location'),/expired/);
  assert.equal((await db.query('select * from action_plan_private.mailboxes')).rows.length,0);
});
test('SMTP connection ignores client-supplied email and encrypts app password',async()=>{
  account='assessor@icloud.com';
  assert.equal((await invoke({action:'connect',provider:'icloud',email:'someoneelse@icloud.com',appPassword:'test-only-app-password'})).status,200);
  const sent=JSON.parse(requests.find(r=>r.url.includes('relay.example')).init.body);assert.equal(sent.email,account);
  const row=(await db.query('select * from action_plan_private.mailboxes')).rows[0];assert.ok(!row.token_cipher.includes('test-only-app-password'));
  await finalPlan();assert.equal((await invoke({action:'send',planId:plan,pdf})).status,200);
});
test('frontend scripts parse and mailbox controls have unique ids',()=>{
  const html=read('index.html');for(const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)){if(match[1].trim())new Function(match[1]);}
  for(const id of ['actionMailboxProvider','actionMailboxAppPassword','actionMailboxContinue','actionDisconnectMailbox','actionMailboxNotice'])assert.equal(html.split('id="'+id+'"').length-1,1);
});
