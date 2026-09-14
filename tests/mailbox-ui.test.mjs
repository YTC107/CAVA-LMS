import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const section=html.slice(html.indexOf('<section class="action-section" aria-labelledby="action-mailbox-title">'),html.indexOf('<section class="action-section" aria-labelledby="action-history-title">'));
const functions=html.slice(html.indexOf('  async function invoke(body) {'),html.indexOf('  async function prepare() {'));
function setup(status,options={}){
  const dom=new JSDOM(section+'<input id="actionAssessorEmail"><button id="actionEmailLearnerFooter"></button>',{url:'https://example.com/',runScripts:'outside-only'});
  const w=dom.window;w.Response=Response;const calls=[];
  w.mock={functions:{invoke:async(name,{body})=>{calls.push(body);if(options.rejectConnect&&body.action==='connect')return {error:{context:Response.json({error:'Use a valid app password.'},{status:409})}};return {data:body.action==='status'?status:body.action==='connect'?{connected:true}:{disconnected:true}};}},from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:options.event||null})})})})};
  w.eval('const $=id=>document.getElementById(id);let mailbox=null;const local=false;let active={id:"plan",status:"finalised"};const sb=window.mock;function save(){};'+functions+';window.api={checkMailbox,updateMailboxProvider,connectMailbox,closeMailboxOptions,disconnectMailbox};');
  return {w,calls,$:id=>w.document.getElementById(id),close:()=>w.close()};
}
test('unconfigured providers do not collect passwords or claim to connect',async()=>{
  const s=setup({connected:false,providers:{google:true,microsoft:false,icloud:false},accountEmail:'test@example.com'});
  try{await s.w.api.checkMailbox();s.$('actionMailboxProvider').value='icloud';s.w.api.updateMailboxProvider();assert.equal(s.$('actionMailboxPasswordFields').hidden,true);assert.equal(s.$('actionMailboxContinue').disabled,true);assert.match(s.$('actionMailboxProviderHelp').textContent,/administrator setup/);}finally{s.close();}
});
test('provider errors are displayed and app password is cleared after submission',async()=>{
  const s=setup({connected:false,providers:{icloud:true},accountEmail:'test@icloud.com'},{rejectConnect:true});
  try{await s.w.api.checkMailbox();s.$('actionMailboxProvider').value='icloud';s.w.api.updateMailboxProvider();s.$('actionMailboxAppPassword').value='test-only-app-password';await s.w.api.connectMailbox();assert.equal(s.$('actionMailboxAppPassword').value,'');assert.match(s.$('actionMailboxStatus').textContent,/valid app password/);assert.equal(s.$('actionMailboxContinue').disabled,false);assert.equal(s.w.localStorage.length,0);}finally{s.close();}
});
test('refresh keeps sent and uncertain records blocked',async()=>{
  for(const status of ['sent','sending','unknown']){
    const s=setup({connected:true,email:'test@example.com',provider:'google',providers:{google:true}},{event:{status,sender:'test@example.com',recipient:'learner@example.com'}});
    try{await s.w.api.checkMailbox();assert.equal(s.$('actionEmailLearner').disabled,true);assert.equal(s.$('actionEmailLearnerFooter').disabled,true);}finally{s.close();}
  }
});
test('cancel clears sensitive entry and closes provider choices',()=>{
  const s=setup({});try{s.$('actionMailboxAppPassword').value='test-only-password';s.w.api.closeMailboxOptions();assert.equal(s.$('actionMailboxAppPassword').value,'');assert.equal(s.$('actionMailboxOptions').hidden,true);assert.equal(s.$('actionConnectMailbox').getAttribute('aria-expanded'),'false');}finally{s.close();}
});
