import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {posix,win32} from 'node:path';
import {ChatPhone} from './store.mjs';
import {normalizeMessage,QqRouting} from './routing.mjs';
import {QqMedia,extractMedia,publicMessage,downloadQq,publicAddress,readBounded,MAX_FILE} from './media.mjs';
function fixture(){
 const home=mkdtempSync(join(tmpdir(),'qq-media-')),container=join(home,'container');mkdirSync(container);const calls=[];
 const phone=new ChatPhone({file:join(home,'inbox.json'),allowedGroups:'*',allowPrivate:true});phone.bind('987654321','session');phone.bind('123456789','other');
 const mediaPathPrefix=process.platform==='win32'?container:'/';
 const parts=[{type:'image',data:{file:'image-id',url:'https://multimedia.nt.qq.com.cn/test',file_size:9}},{type:'forward',data:{id:'forward-id'}},{type:'file',data:{file_id:'file-id',file:'test.txt',file_size:12}}];
 const m=normalizeMessage({message_id:1,time:Date.now()/1000,sender:{user_id:222222},message:parts},'999999','group');phone.ingest('987654321',[m]);
 const nap={onebot:async(action,args)=>{calls.push({action,args});if(action==='get_forward_msg')return {messages:[{user_id:'7654321',sender:{nickname:'机主'},message:[{type:'text',data:{text:'untrusted'}},...parts.slice(0,1)]}]};if(action==='upload_group_file')return {file_id:'receipt'};if(action==='get_file')return {file:(process.platform==='win32'?win32:posix).join(mediaPathPrefix,'root/.config/QQ/test.txt')};throw Error('simulated');}};
 mkdirSync(join(container,'root/.config/QQ'),{recursive:true});writeFileSync(join(container,'root/.config/QQ/test.txt'),'received text');
 const media=new QqMedia({home,phone,nap,container,mediaPathPrefix,download:async()=>Buffer.from('test-image')});return {home,container,phone,media,nap,calls,m};
}
test('normalization retains typed references, public prompts never expose download URLs',()=>{
 const f=fixture();assert.deepEqual(f.m.attachments.map(a=>a.type),['image','forward','file']);assert.equal(f.m.owner,false);
 assert.equal(JSON.stringify(publicMessage(f.m)).includes('multimedia.nt.qq'),false);assert.equal(JSON.stringify(f.phone.read('987654321','session')).includes('https:'),false);
 assert.equal(extractMedia([{type:'json',data:{data:JSON.stringify({app:'com.tencent.multimsg',meta:{detail:{resid:'json-id'}}})}}],'j')[0].fileId,'json-id');
});
test('media hydration upgrades old inbox without creating or replaying any jobs',()=>{
 const f=fixture();delete f.phone.state.channels['987654321'].history[0].attachments;f.phone.ingest('987654321',[f.m]);assert.equal(f.phone.state.jobs.length,0);assert.equal(f.phone.state.channels['987654321'].history[0].attachments.length,3);
});
test('forward is bounded, cached, untrusted, and its images remain available by reference',async()=>{
 const f=fixture(),ref=f.m.attachments[1].ref;const r=await f.media.forward('987654321',ref);assert.equal(r.untrusted,true);assert.equal(r.messages[0].forwarded,true);assert.equal(r.messages[0].owner,undefined);
 await f.media.forward('987654321',ref);assert.equal(f.calls.length,1);const image=await f.media.receive('987654321',r.messages[0].attachments[0].ref);assert.ok(image.fileId);
 await assert.rejects(f.media.forward('123456789',ref),/不属于/);
 f.nap.onebot=async()=>({messages:Array.from({length:200},()=>({message:[{type:'text',data:{text:'x'.repeat(5000)}}]}))});delete f.media.state.forwards['987654321:'+ref];const large=await f.media.forward('987654321',ref);assert.ok(large.messages.length<=60);assert.ok(large.messages.reduce((n,m)=>n+m.text.length,0)<=24000);assert.equal(large.truncated,true);
});
test('nested forwards cannot bypass the 3-level bound by repeated tool calls',async()=>{
 const f=fixture(),a=f.m.attachments[1];f.nap.onebot=async()=>({messages:[{message:[{type:'forward',data:{id:'nested'}}]}]});let ref=a.ref;
 for(let i=0;i<3;i++){const r=await f.media.forward('987654321',ref);ref=r.messages[0].attachments[0].ref;}
 await assert.rejects(f.media.forward('987654321',ref),/最多3层/);
});
test('receive/read/upload stay within channel and do not execute files',async()=>{
 const f=fixture(),r=await f.media.receive('987654321',f.m.attachments[2].ref);assert.equal(f.media.readText('987654321',r.fileId).text,'received text');
 assert.throws(()=>f.media.readText('123456789',r.fileId),/不属于/);const sent=await f.media.upload('987654321','session',{fileId:r.fileId,requestId:'one'});assert.equal(sent.sent,true);
 const args=f.calls.at(-1).args;assert.match(args.file,/root[\\/]dsh-chat-phone-transfer[\\/]/);assert.equal(args.group_id,'987654321');assert.ok(!args.file.includes('test.txt'));
 assert.equal((await f.media.upload('987654321','session',{fileId:r.fileId,requestId:'one'})).duplicatePrevented,true);
 await assert.rejects(f.media.upload('987654321','session',{path:join(f.home,'inbox.json'),requestId:'bad'}),/不能上传/);
});
test('concurrent upload retries and restart after timeout cannot duplicate file sends',async()=>{
 const f=fixture();let calls=0,release;f.nap.onebot=async()=>{calls++;await new Promise(r=>release=r);throw Error('timeout');};
 const args={text:'test',name:'result.txt',requestId:'same'};const first=f.media.upload('987654321','session',args);await new Promise(r=>setImmediate(r));
 await assert.rejects(f.media.upload('987654321','session',args),/未知|正在发送/);release();await assert.rejects(first,/未知/);
 const restored=new QqMedia({home:f.home,phone:f.phone,nap:f.nap,container:f.container});await assert.rejects(restored.upload('987654321','session',args),/未知/);assert.equal(calls,1);
 await assert.rejects(restored.upload('987654321','session',{...args,text:'different'}),/不同文件/);
});
test('oversize, traversal, symlinks, private addresses and non-QQ download hosts are rejected',async()=>{
 const f=fixture();f.m.attachments[0].size=MAX_FILE+1;await assert.rejects(f.media.receive('987654321',f.m.attachments[0].ref),/过大/);
 assert.throws(()=>f.media.localDownloadPath('relative/path'),/绝对路径/);assert.throws(()=>readBounded(join(f.home,'inbox.json'),MAX_FILE,f.media.cache),/沙箱/);
 for(const ip of ['127.0.0.1','10.1.2.3','169.254.1.1','192.168.1.1','100.100.1.1','::1','::ffff:127.0.0.1','fe80::1'])assert.equal(publicAddress(ip),false,ip);
 assert.equal(publicAddress('223.5.5.5'),true);await assert.rejects(downloadQq('http://127.0.0.1/secret',100),/内部网络/);await assert.rejects(downloadQq('https://attacker.example/a',100),/QQ附件/);
 try{symlinkSync(join(f.home,'inbox.json'),join(f.media.cache,'link'));assert.throws(()=>readBounded(join(f.media.cache,'link'),MAX_FILE,f.media.cache),/沙箱|符号/);}catch(e){if(e.code!=='EPERM')throw e;}
});
test('configured media mount maps desktop or Android paths into the DSH host directory',async()=>{
 const f=fixture(),style=process.platform==='win32'?win32:posix,host=join(f.home,'mapped'),prefix=process.platform==='win32'?host:'/napcat-share';mkdirSync(host,{recursive:true});writeFileSync(join(host,'download.txt'),'portable media');
 const phone=new ChatPhone({file:join(f.home,'portable-inbox.json'),allowedGroups:['987654321']});phone.bind('987654321','portable-session');
 const m=normalizeMessage({message_id:'portable',time:Date.now()/1000,sender:{user_id:222222},message:[{type:'file',data:{file_id:'portable-id',name:'download.txt',file_size:14}}]},'999999','group');phone.ingest('987654321',[m]);
 const nap={onebot:async(action)=>action==='get_file'?{file:style.join(prefix,'download.txt')}:{}};
 const media=new QqMedia({home:f.home,phone,nap,container:host,mediaPathPrefix:prefix});
 const result=await media.receive('987654321',m.attachments[0].ref);assert.equal(media.readText('987654321',result.fileId).text,'portable media');
});
test('configured media upload directory is used and remains inside the mapped prefix',async()=>{
 const f=fixture(),style=process.platform==='win32'?win32:posix,prefix=process.platform==='win32'?f.container:'/napcat-share',uploadDir=style.join(prefix,'shared','outgoing');mkdirSync(join(f.container,'shared','outgoing'),{recursive:true});
 const media=new QqMedia({home:f.home,phone:f.phone,nap:f.nap,container:f.container,mediaPathPrefix:prefix,mediaUploadDir:uploadDir});
 const sent=await media.upload('987654321','session',{text:'custom directory',name:'message.txt',requestId:'custom-dir'});assert.equal(sent.sent,true);
 const args=f.calls.at(-1).args;assert.equal(args.file.startsWith(style.join(uploadDir,'')),true);assert.equal(args.file.includes('dsh-chat-phone-transfer'),false);
 const outside=style.join(style.dirname(prefix),'outside');
 const unsafe=new QqMedia({home:f.home,phone:f.phone,nap:f.nap,container:f.container,mediaPathPrefix:prefix,mediaUploadDir:outside});
 await assert.rejects(unsafe.upload('987654321','session',{text:'x',requestId:'outside-dir'}),/映射目录|超出/);
});
test('group upload notices create a normal isolated file inbox item',()=>{
 const f=fixture(),r=new QqRouting(f.phone);r.configure({ownerId:'7654321',accountId:'999999',rootSessionId:'session',allGroups:true,friendPrivate:true});r.directory([{group_id:'123456789'}],[]);
 assert.equal(r.event({post_type:'notice',notice_type:'group_upload',self_id:999999,group_id:123456789,user_id:222222,time:Date.now()/1000,file:{id:'notice-file',name:'notice.txt',size:10}},'999999'),true);
 assert.equal(f.phone.state.jobs.at(-1).messages[0].attachments[0].type,'file');
});
