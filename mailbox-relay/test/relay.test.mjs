import {test} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {authenticate,providerConfig,publicIPv4,deliver,createServer} from '../server.mjs';
test('relay signatures reject tampering, stale requests and replay',()=>{
  const raw='{"action":"verify"}', secret='test-only-secret-not-a-real-credential', time=Date.now(), nonce=crypto.randomUUID(), seen=new Map();
  const headers={'x-mailbox-time':String(time),'x-mailbox-nonce':nonce,'x-mailbox-signature':crypto.createHmac('sha256',secret).update(time+'.'+nonce+'.'+raw).digest('base64url')};
  assert.equal(authenticate(headers,raw+' ',secret,seen,time),false);
  assert.equal(authenticate(headers,raw,secret,seen,time+61000),false);
  assert.equal(authenticate(headers,raw,secret,seen,time),true);
  assert.equal(authenticate(headers,raw,secret,seen,time),false);
});
test('only provider domains and administrator-approved hosts are accepted',()=>{
  assert.deepEqual(providerConfig('icloud','test@icloud.com'),{host:'smtp.mail.me.com',port:587});
  assert.throws(()=>providerConfig('icloud','test@outlook.com'));
  assert.throws(()=>providerConfig('custom','test@example.com'));
  assert.throws(()=>providerConfig('custom','test@example.com',{'example.com':{host:'127.0.0.1',port:587}}));
  assert.throws(()=>providerConfig('custom','test@example.com',{'example.com':{host:'mail.example.com',port:25}}));
  assert.deepEqual(providerConfig('custom','test@example.com',{'example.com':{host:'mail.example.com',port:587}}),{host:'mail.example.com',port:587});
  for(const ip of ['127.0.0.1','10.0.0.1','169.254.169.254','172.31.1.1','192.168.1.1','100.64.0.1','::1','::ffff:127.0.0.1'])assert.equal(publicIPv4(ip),false);
});
const payload={action:'send',provider:'yahoo',email:'assessor@yahoo.com',password:'test-only-password',recipient:'learner@example.com',subject:'Action Plan',text:'Your plan',pdf:Buffer.from('%PDF-1.7\n').toString('base64'),messageId:'<11111111-1111-4111-8111-111111111111@action-plans.pt-academy.invalid>'};
test('SMTP sender and login are fixed to assessor; credentials are not in the message',async()=>{
  let options,message,closed=false;
  const result=await deliver({...payload,from:'attacker@example.com',host:'localhost'}, {}, o=>{options=o;return {sendMail:async m=>{message=m;return {accepted:[payload.recipient],messageId:m.messageId};},close(){closed=true;}};},async()=>[{address:'1.1.1.1'}]);
  assert.equal(result.sent,true);assert.equal(options.auth.user,payload.email);assert.equal(options.tls.rejectUnauthorized,true);assert.equal(options.tls.servername,'smtp.mail.yahoo.com');assert.equal(options.requireTLS,true);assert.equal(message.from,payload.email);assert.equal(message.envelope.from,payload.email);assert.equal(JSON.stringify(message).includes(payload.password),false);assert.equal(closed,true);
});
test('SMTP timeout stays uncertain, explicit rejection is retryable, no secret leaks',async()=>{
  for(const [error,rejected] of [[Object.assign(new Error(payload.password),{code:'ETIMEDOUT'}),false],[Object.assign(new Error(payload.password),{code:'EAUTH',responseCode:535}),true]]){
    const result=await deliver(payload,{},()=>({sendMail:async()=>{throw error},close(){}}),async()=>[{address:'1.1.1.1'}]);
    assert.equal(result.definitivelyRejected,rejected);assert.equal(JSON.stringify(result).includes(payload.password),false);
  }
});
test('private DNS result is blocked before connecting',async()=>{
  await assert.rejects(()=>deliver(payload,{},()=>{throw new Error('Must never connect')},async()=>[{address:'127.0.0.1'}]),/Unsafe host/);
});
test('verify authenticates without sending an email',async()=>{
  let verified=false;
  const result=await deliver({...payload,action:'verify'},{},()=>({verify:async()=>{verified=true},sendMail:async()=>{assert.fail('Unexpected email')},close(){}}),async()=>[{address:'1.1.1.1'}]);
  assert.equal(verified,true);assert.equal(result.verified,true);
});
test('HTTP service refuses unauthenticated relay calls',async()=>{
  const server=createServer({secret:'test-only-relay-secret-at-least-32-characters',deliverFn:()=>assert.fail('Unauthorized send')});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {const r=await fetch('http://127.0.0.1:'+server.address().port+'/mailbox',{method:'POST',body:JSON.stringify(payload)});assert.equal(r.status,401);}finally{await new Promise(resolve=>server.close(resolve));}
});
