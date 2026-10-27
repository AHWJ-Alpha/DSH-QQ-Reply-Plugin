import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ChatPhone} from './store.mjs';

function fixture(){
  let time=1000000,serial=0;const wakes=[],sends=[],file=join(mkdtempSync(join(tmpdir(),'qq-group-reply-')),'inbox.json');
  const options={file,now:()=>time,allowedGroups:'*',wake:async(j,prompt)=>{wakes.push({id:j.id,prompt});return true;},deliver:async(j,text)=>{sends.push({id:j.id,text});return {message_id:'reply-'+sends.length};}};
  const p=new ChatPhone(options);p.bind('123456789','group-session');p.bind('123456','other-group');
  const put=(text,mention=false,key='123456789')=>{const id=String(++serial);p.ingest(key,[{id,at:time,sender:'member',senderId:'222222',text,mention}]);return id;};
  put('baseline');p.ingest('123456',[]);
  return {p,options,wakes,sends,put,advance:n=>time+=n};
}

test('continuous group fragments reset the quiet window and produce one batch',async()=>{
  const f=fixture();f.put('first');f.advance(4000);f.put('second');f.advance(3000);await f.p.tick();assert.equal(f.wakes.length,0);
  f.advance(3000);await f.p.tick();assert.equal(f.wakes.length,1);assert.equal(f.p.state.jobs[0].messages.length,2);
  await f.p.reply(f.p.state.jobs[0].id,'group-session','one combined reply');assert.equal(f.sends.length,1);
});
test('duplicate WS/history delivery does not extend the quiet window',async()=>{
  const f=fixture(),id=f.put('one');f.advance(5000);f.p.ingest('123456789',[{id,at:1000000,text:'duplicate'}]);f.advance(1000);await f.p.tick();assert.equal(f.wakes.length,1);
});
test('active group reaches bounded 20-second wake instead of waiting forever',async()=>{
  const f=fixture();f.put('one');for(let i=0;i<4;i++){f.advance(4500);f.put('more');await f.p.tick();assert.equal(f.wakes.length,0);}
  f.advance(2000);await f.p.tick();assert.equal(f.wakes.length,1);assert.equal(f.p.state.jobs[0].messages.length,5);
});
test('@ waits briefly for follow-up fragments, stays bounded, and cannot be silently completed',async()=>{
  const f=fixture();f.put('@model question',true);await f.p.tick();assert.equal(f.wakes.length,0);
  for(let i=0;i<3;i++){f.advance(1500);f.put('follow-up');await f.p.tick();assert.equal(f.wakes.length,0);}
  f.advance(1500);await f.p.tick();assert.equal(f.wakes.length,1);const j=f.p.state.jobs[0];assert.equal(j.messages.length,4);assert.throws(()=>f.p.complete(j.id,'group-session'),/@/);
});
test('ordinary replies have a persistent 15-second interval while @ bypasses the interval',async()=>{
  const f=fixture();f.put('one');f.advance(6000);await f.p.tick();await f.p.reply(f.p.state.jobs[0].id,'group-session','first answer');
  f.put('next topic');f.advance(6000);const restarted=new ChatPhone(f.options);await restarted.tick();assert.equal(f.wakes.length,1);
  f.advance(9000);await restarted.tick();assert.equal(f.wakes.length,2);await restarted.complete(restarted.state.jobs.at(-1).id,'group-session');
  // Fresh @ shortly after a reply is urgent even when the ordinary interval is active.
  f.p.state=restarted.state;f.put('again');f.advance(6000);await f.p.tick();await f.p.reply(f.p.state.jobs.at(-1).id,'group-session','second answer');
  f.put('@model urgent',true);f.advance(2000);await f.p.tick();assert.equal(f.wakes.length,4);
});
test('new messages during generation defer one stale reply without duplicating or losing attachments',async()=>{
  const f=fixture();f.put('first');f.advance(6000);await f.p.tick();const old=f.p.state.jobs[0];
  const nextId=f.put('second');f.p.state.jobs.at(-1).messages[0].attachments=[{ref:'image-ref',type:'image'}];
  const deferred=await f.p.reply(old.id,'group-session','stale draft');assert.equal(deferred.deferred,true);assert.equal(f.sends.length,0);
  const next=f.p.state.jobs.find(j=>j.id===deferred.batchId);assert.deepEqual(next.messages.map(m=>m.text),['first','second']);assert.equal(next.messages.find(m=>m.id===nextId).attachments[0].ref,'image-ref');
  assert.equal((await f.p.reply(old.id,'group-session','same stale draft')).deferred,true);assert.equal(next.messages.length,2);
  f.advance(6000);await f.p.tick();f.put('third during reconsideration');await f.p.reply(next.id,'group-session','updated reply');assert.equal(f.sends.length,1);
});
test('unrelated chatter may be completed, and the prompt provides only this group context',async()=>{
  const f=fixture();f.put('other secret',false,'123456');f.put('member-to-member chat');f.advance(6000);await f.p.tick();
  const j=f.p.state.jobs.find(j=>j.channelKey==='123456789');const prompt=f.wakes.find(w=>w.id===j.id).prompt;
  assert.match(prompt,/默认保持安静/);assert.match(prompt,/不强制只说一句/);assert.ok(prompt.includes('baseline'));assert.ok(!prompt.includes('other secret'));
  assert.equal(f.p.complete(j.id,'group-session').completed,true);assert.equal(f.sends.length,0);
});
test('explicit manual send is not deferred by automatic group batching',async()=>{
  const f=fixture();f.put('ordinary new discussion');
  const j={id:'manual:group-session:1',kind:'group',idValue:'123456789',channelKey:'123456789',sessionId:'group-session',phase:'woken',createdAt:1000000,messages:[]};f.p.state.jobs.push(j);
  assert.equal((await f.p.reply(j.id,'group-session','owner requested send')).sent,true);assert.equal(f.sends.length,1);
});
