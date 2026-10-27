import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ChatPhone} from './store.mjs';
import {NapCat,classify} from './napcat.mjs';
import {isExternalTurn} from './index.js';
function fixture(options={}){
 let time=1000000,wakes=[],sends=[];const file=join(mkdtempSync(join(tmpdir(),'chat-phone-')),'inbox.json');
 const p=new ChatPhone({file,allowedGroups:['123456789'],now:()=>time,wake:async(j,prompt)=>{wakes.push({sessionId:j.sessionId,prompt});return true;},deliver:async(g,t)=>{sends.push([g,t]);return {message_id:42};},...options});
 const msg=(id,mention=false)=>({id:String(id),at:time,sender:'test',text:'synthetic',mention});
 p.bind('123456789','original-session');p.ingest('123456789',[msg(1)]);
 return {p,file,wakes,sends,msg,advance:n=>time+=n};
}
test('baseline, de-duplication and same-session wake with producer boundary',async()=>{
 const f=fixture();assert.equal(f.p.state.jobs.length,0);
 f.p.ingest('123456789',[f.msg(1),f.msg(2,true)]);f.p.ingest('123456789',[f.msg(2,true)]);f.advance(2100);await f.p.tick();
 assert.equal(f.wakes.length,1);assert.equal(f.wakes[0].sessionId,'original-session');assert.match(f.wakes[0].prompt,/不是机主/);assert.equal(f.p.state.jobs[0].messages.length,1);assert.equal(f.sends.length,0);
});
test('busy original conversation defers wake, keeps receiving, and merges',async()=>{
 let ready=false;const f=fixture({wake:async()=>ready});f.p.ingest('123456789',[f.msg(2,true)]);f.advance(2100);await f.p.tick();assert.equal(f.p.state.jobs[0].phase,'pending');
 f.p.ingest('123456789',[f.msg(3)]);assert.equal(f.p.state.jobs[0].messages.length,2);ready=true;f.advance(2100);await f.p.tick();assert.equal(f.p.state.jobs[0].phase,'woken');
});
test('only explicit own-session reply sends, twice returns receipt without sending',async()=>{
 const f=fixture();f.p.ingest('123456789',[f.msg(2,true)]);f.advance(2100);await f.p.tick();const id=f.p.state.jobs[0].id;
 await assert.rejects(f.p.reply(id,'other-session','test'),/另一个/);
 await assert.rejects(async()=>f.p.complete(id,'original-session'),/@/);
 await f.p.reply(id,'original-session','test');await f.p.reply(id,'original-session','test');assert.equal(f.sends.length,1);
});
test('timeout and process restart preserve uncertain send and block duplicates',async()=>{
 const f=fixture({deliver:async()=>{throw Error('timeout');}});f.p.ingest('123456789',[f.msg(2,true)]);f.advance(2100);await f.p.tick();const j=f.p.state.jobs[0];
 await assert.rejects(f.p.reply(j.id,'original-session','test'),/未知/);
 const p=new ChatPhone({file:f.file,wake:async()=>true,deliver:async()=>{throw Error('must not send');}});
 await assert.rejects(p.reply(j.id,'original-session','test'),/未知/);assert.equal(p.state.jobs[0].phase,'uncertain');
});
test('paused late results do not send and unapproved group cannot bind',async()=>{
 const f=fixture();f.p.ingest('123456789',[f.msg(2,true)]);f.advance(2100);await f.p.tick();const j=f.p.state.jobs[0];f.p.pause('123456789');
 await assert.rejects(f.p.reply(j.id,'original-session','test'),/暂停/);assert.equal(f.sends.length,0);assert.throws(()=>f.p.bind('123','original-session'),/授权/);
});
test('corrupt inbox remains byte-identical; no destructive reset',()=>{
 const f=fixture();writeFileSync(f.file,'broken');assert.throws(()=>new ChatPhone({file:f.file}));assert.equal(readFileSync(f.file,'utf8'),'broken');
});
test('ordinary final answers never imply delivery; guard follows last human/source boundary',()=>{
 const agent=events=>({session:{snapshotEvents:()=>events}});
 assert.equal(isExternalTurn(agent([{type:'user/message',data:{source:{kind:'plugin:dsh-chat-phone'}}},{type:'assistant/message',data:{}}])),true);
 assert.equal(isExternalTurn(agent([{type:'user/message',data:{source:{kind:'plugin:dsh-chat-phone'}}},{type:'user/message',data:{source:{kind:'user'}}}])),false);
});
test('retry is bounded; no rebind of an outstanding turn into another conversation',async()=>{
 const f=fixture();f.p.ingest('123456789',[f.msg(2,true)]);f.advance(2100);await f.p.tick();assert.throws(()=>f.p.bind('123456789','other'),/未完成/);
 for(let i=0;i<3;i++){f.advance(181000);f.advance(2100);await f.p.tick();}assert.equal(f.wakes.length,3);assert.equal(f.p.state.jobs[0].phase,'stalled');
});
test('NapCat health distinguishes real login, API faults and scan confirmation',()=>{
 assert.equal(classify({isLogin:false,loginPhase:'reconnecting'},false).state,'reconnecting');
 assert.equal(classify({isLogin:true},true).state,'online');assert.equal(classify({isLogin:true},false).state,'api-unavailable');
 assert.equal(classify({qrLoginAccepted:true,qrcodeurl:'synthetic'},false).state,'confirmation');assert.equal(classify(null,false).state,'service-unavailable');
});
test('QR wait never triggers quick login or restart, including repeated ticks',async()=>{
 const home=mkdtempSync(join(tmpdir(),'napcat-recover-'));let calls=[],restarts=0;
 const n=new NapCat({home,now:()=>10000000,restart:async()=>{restarts++;}});
 n.probe=async()=>{n.login={qrcodeurl:'synthetic'};n.health=classify(n.login,false);return n.health;};
 n.web=async(path)=>{calls.push(path);if(path==='QQLogin/GetQuickLoginListNew')return [{uin:'123',isQuickLogin:true}];return null;};
 await n.recover({manual:true});assert.equal(calls.length,0);
 await n.recover();await n.tick();assert.equal(calls.length,0);
 await n.recover({manual:true,restart:true});assert.equal(restarts,0);
 const restored=new NapCat({home});assert.equal(restored.recovery.nextAttempt,n.recovery.nextAttempt);
 const qr=await n.qr();assert.match(qr.image,/^data:image\/gif;base64,/);
});
test('authenticated offline and stale login info cannot trigger quick login',async()=>{
 assert.equal(classify({isOffline:true,qrcodeurl:'stale'},true,{online:false}).state,'reconnecting');
 const home=mkdtempSync(join(tmpdir(),'napcat-offline-'));const n=new NapCat({home});let calls=0;
 n.web=async(path)=>{if(path!=='QQLogin/CheckLoginStatus'){calls++;throw Error('must not login');}return {isOffline:true};};
 n.onebot=async action=>action==='get_login_info'?{user_id:123}:{online:false};
 await n.recover({manual:true});await n.tick();assert.equal(calls,0);assert.equal(n.health.state,'reconnecting');
});
test('manual login limit persists across engines and automatic recovery never logs in',async()=>{
 const home=mkdtempSync(join(tmpdir(),'napcat-limit-'));let calls=0,time=10000000;
 const setup=()=>{const n=new NapCat({home,now:()=>time});n.probe=async()=>{n.login={loginPhase:'offline'};n.health=classify(n.login,false);return n.health;};n.web=async path=>{if(path==='QQLogin/GetQuickLoginListNew')return [{uin:'123',isQuickLogin:true}];if(path==='QQLogin/SetQuickLogin')calls++;};return n;};
 await setup().recover();assert.equal(calls,0);
 await setup().recover({manual:true});await setup().recover({manual:true});assert.equal(calls,1);
 time+=600001;await setup().recover({manual:true});time+=600001;await setup().recover({manual:true});time+=600001;await setup().recover({manual:true});assert.equal(calls,3);
});

test('network outage suppresses quick login and service restart, then recovers',async()=>{
 const home=mkdtempSync(join(tmpdir(),'napcat-network-'));let available=false,restarts=0,calls=0;
 const n=new NapCat({home,now:()=>10000000,networkAvailable:()=>available,loginServiceFault:()=>true,restart:async()=>{restarts++;}});
 n.web=async()=>({isLogin:false,loginPhase:'offline'});
 n.onebot=async()=>{throw Error('offline');};
 await n.probe();assert.equal(n.status().state,'network-unavailable');
 n.web=async()=>{calls++;return {isLogin:false,loginPhase:'offline'};};
 await n.recover({manual:true,restart:true});assert.equal(restarts,0);assert.equal(calls,1);
 available=true;await n.probe();assert.equal(n.status().state,'login-service-unavailable');
});
import {QqRouting,activeOwnerBatch,peerSession} from './routing.mjs';
test('v1 migration retains history, receipts and unknown sends without reusing private context',()=>{
 const f=fixture();const before=JSON.parse(readFileSync(f.file,'utf8'));before.version=1;before.channels['123456789'].history=[{id:'kept',text:'synthetic history'}];before.sent={old:{messageId:'kept-receipt'}};before.jobs=[{id:'unknown',group:'123456789',sessionId:'original-session',phase:'sending',messages:[]}];writeFileSync(f.file,JSON.stringify(before));
 const p=new ChatPhone({file:f.file});assert.equal(p.state.version,2);assert.equal(p.state.channels['123456789'].history[0].id,'kept');assert.equal(p.state.sent.old.messageId,'kept-receipt');assert.equal(p.state.jobs[0].phase,'uncertain');assert.equal(p.state.jobs[0].channelKey,'123456789');
});
function routed(){const f=fixture({allowedGroups:'*'}),r=new QqRouting(f.p);r.configure({ownerId:'7654321',rootSessionId:'original-session',accountId:'8888888',allGroups:true,friendPrivate:true});r.directory([{group_id:'123456789'},{group_id:'123456'}],[{user_id:'7654321'},{user_id:'222222'}]);return {...f,r};}
const event=(kind,id,sender,messageId,time=1000)=>({post_type:'message',message_type:kind,self_id:8888888,group_id:kind==='group'?id:undefined,user_id:kind==='private'?id:sender,sender:{user_id:sender,nickname:'机主'},message_id:messageId,time,message:[{type:'text',data:{text:'synthetic'}}]});
test('owner private uses original session; all other peers get stable separate sessions',()=>{
 const {p,r}=routed();assert.equal(p.state.channels['private:7654321'].sessionId,'original-session');assert.notEqual(p.state.channels['private:222222'].sessionId,'original-session');assert.notEqual(p.state.channels['123456789'].sessionId,p.state.channels['123456'].sessionId);assert.notEqual(p.state.channels['private:222222'].sessionId,p.state.channels['123456'].sessionId);assert.equal(peerSession(r.scope,'private','222222'),p.state.channels['private:222222'].sessionId);assert.equal(p.state.channels['123456789'].history[0].id,'1');
});
test('only verified owner private batch gains owner identity; nickname and group do not',async()=>{
 const {p,r,advance}=routed();r.event(event('private',7654321,7654321,'owner'),r.scope.accountId);advance(7000);await p.tick();const job=p.state.jobs.find(j=>j.owner),agent={id:job.sessionId,session:{snapshotEvents:()=>[{type:'user/message',data:{source:{kind:'plugin:dsh-chat-phone',batchId:job.id}}}]}};
 assert.equal(activeOwnerBatch(p,agent),true);assert.throws(()=>p.complete(job.id,job.sessionId),/机主/);
 r.event(event('group',123456,7654321,'group-owner'),r.scope.accountId);const group=p.state.jobs.find(j=>j.idValue==='123456');assert.equal(group.owner,false);assert.equal(activeOwnerBatch(p,{...agent,session:{snapshotEvents:()=>[{type:'user/message',data:{source:{kind:'plugin:dsh-chat-phone',batchId:group.id}}}]}}),false);
 const privateOwner=p.state.jobs.find(j=>j.owner);privateOwner.messages[0].senderId='222222';assert.equal(activeOwnerBatch(p,agent),false);
});
test('live events deliver first new private message, ignore self, wrong account, stranger and old history',()=>{
 const {p,r}=routed();assert.equal(r.event(event('private',222222,222222,'new'),r.scope.accountId),true);assert.equal(p.state.jobs.length,1);
 assert.equal(r.event(event('private',333333,333333,'stranger'),r.scope.accountId),false);assert.equal(r.event(event('private',222222,8888888,'echo'),r.scope.accountId),false);assert.equal(r.event({...event('group',123456,222222,'wrong'),self_id:123},r.scope.accountId),false);
 p.ingest('private:222222',[{id:'old',at:999000,text:'old',senderId:'222222'}],'private');assert.equal(p.state.jobs[0].messages.length,1);
});
test('directory refresh preserves manual pause and private reply keeps target and dedupe',async()=>{
 const {p,r,sends,advance}=routed();r.event(event('private',222222,222222,'new'),r.scope.accountId);advance(7000);await p.tick();const j=p.state.jobs[0];await p.reply(j.id,j.sessionId,'synthetic reply');await p.reply(j.id,j.sessionId,'synthetic reply');assert.equal(sends.length,1);assert.equal(sends[0][0].kind,'private');assert.equal(sends[0][0].idValue,'222222');
 p.pause('private:222222');r.directory([{group_id:123456789}],[{user_id:222222}]);assert.equal(p.state.channels['private:222222'].enabled,false);
});
test('all QQ wake is bounded to two concurrent conversations and prioritizes owner',async()=>{
 const {p,r,advance,wakes}=routed();r.event(event('group',123456,222222,'a'),r.scope.accountId);r.event(event('private',222222,222222,'b'),r.scope.accountId);r.event(event('private',7654321,7654321,'owner'),r.scope.accountId);advance(7000);await p.tick();assert.equal(wakes.length,2);assert.equal(wakes[0].sessionId,'original-session');
});
test('QQ history refresh does not render the local reply receipt a second time',async()=>{
 const f=fixture();f.p.ingest('123456789',[f.msg(2,true)]);f.advance(2100);await f.p.tick();const j=f.p.state.jobs[0];await f.p.reply(j.id,j.sessionId,'synthetic reply');
 f.p.ingest('123456789',[{id:'42',at:1000000,text:'synthetic reply',self:true}]);assert.equal(f.p.state.channels['123456789'].history.filter(m=>m.id==='42').length,1);
});
