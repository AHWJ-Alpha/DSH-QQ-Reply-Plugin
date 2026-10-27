import {readFileSync,writeFileSync,renameSync,mkdirSync,realpathSync,openSync,closeSync,fstatSync,readSync,constants,statSync,lstatSync,unlinkSync} from 'node:fs';
import {join,resolve,relative,isAbsolute,basename,posix,win32} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {lookup} from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import {isIP} from 'node:net';

const hash=x=>createHash('sha256').update(x).digest('hex');
const str=(x,n=2048)=>typeof x==='string'?x.slice(0,n):'';
export const MAX_FILE=20*1024*1024,MAX_IMAGE=8*1024*1024;
export function safeName(n){return (basename(String(n||'attachment').replaceAll('\\','/')).replace(/[\x00-\x1f<>:"/\\|?*]/g,'_').replace(/^\.+/,'').slice(0,120)||'attachment');}
function forwardId(p){
  const d=p.data||{};if(p.type==='forward')return str(d.id||d.resid);
  if(p.type==='json')try{const j=JSON.parse(d.data);if(j.app==='com.tencent.multimsg')return str(j.meta?.detail?.resid||j.meta?.detail?.resId);}catch{}
  if(p.type==='xml'&&/viewMultiMsg|MultiMsg/.test(d.data||''))return str(/\bresid=["']([^"']+)["']/.exec(d.data)?.[1]);
  return '';
}
export function extractMedia(parts,messageId){
  const result=[];
  for(const [i,p] of parts.slice(0,100).entries()){
    const d=p?.data||{},f=forwardId(p),type=f?'forward':p.type;
    if(!['image','file','forward'].includes(type))continue;
    const item={ref:hash(String(messageId)+':'+i).slice(0,24),type,name:safeName(d.name||d.file||type),size:Math.max(0,Number(d.file_size||d.size)||0)};
    if(f)item.fileId=f;
    else {item.fileId=str(type==='file'?(d.file_id||d.id):(d.file||d.file_id));item.url=str(d.url,8192);}
    result.push(item);if(result.length>=20)break;
  }
  return result;
}
export function publicMessage(m){
  const {attachments,...rest}=m;
  return {...rest,...attachments?.length?{attachments:attachments.map(({ref,type,name,size})=>({ref,type,name,size}))}:{}};
}
export function publicAddress(ip){
  if(isIP(ip)===4){const a=ip.split('.').map(Number);return !(a[0]===0||a[0]===10||a[0]===127||a[0]>=224||a[0]===169&&a[1]===254||a[0]===172&&a[1]>=16&&a[1]<=31||a[0]===192&&(a[1]===168||a[1]===0)||a[0]===100&&a[1]>=64&&a[1]<=127||a[0]===198&&(a[1]===18||a[1]===19));}
  // Only global unicast IPv6; excludes mapped IPv4, loopback and link-local.
  return isIP(ip)===6&&/^[23][0-9a-f]{3}:/i.test(ip);
}
export async function downloadQq(url,max,redirects=3,deadline=Date.now()+20000){
  const u=new URL(url);if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.port&&!['80','443'].includes(u.port))throw Error('附件下载地址不受支持');
  const host=u.hostname.replace(/^\[|\]$/g,'');
  if(!isIP(host)&&!/(^|\.)(qq\.com|qq\.com\.cn|qpic\.cn|gtimg\.cn|gtimg\.com|qqmail\.com)$/i.test(host))throw Error('仅允许QQ附件服务器');
  const addresses=await lookup(host,{all:true});if(!addresses.length||addresses.some(a=>!publicAddress(a.address)))throw Error('拒绝访问内部网络地址');
  const left=deadline-Date.now();if(left<=0)throw Error('附件下载超时');
  return new Promise((ok,no)=>{
    const a=addresses.find(a=>a.family===4)||addresses[0],req=(u.protocol==='https:'?https:http).get(u,{lookup:(_h,o,cb)=>o?.all?cb(null,[a]):cb(null,a.address,a.family)},r=>{
      if([301,302,303,307,308].includes(r.statusCode)){r.resume();if(redirects<=0)return no(Error('附件重定向过多'));return downloadQq(new URL(r.headers.location,u),max,redirects-1,deadline).then(ok,no);}
      if(r.statusCode!==200){r.resume();return no(Error('QQ附件下载失败或已过期'));}
      if(Number(r.headers['content-length'])>max){r.destroy();return no(Error('附件超过大小限制'));}
      let n=0;const chunks=[];r.on('data',b=>{n+=b.length;if(n>max){r.destroy(Error('附件超过大小限制'));}else chunks.push(b);});r.on('error',no);r.on('end',()=>ok(Buffer.concat(chunks)));
    });
    const t=setTimeout(()=>req.destroy(Error('附件下载超时')),left);req.on('close',()=>clearTimeout(t));req.on('error',no);
  });
}
function within(root,p){const rel=relative(root,p);return rel!==''&&!rel.startsWith('..')&&!isAbsolute(rel);}
export function readBounded(path,max,root){
  const p=resolve(path),real=realpathSync(p);
  if(root&&(!within(realpathSync(root),real)||real!==p))throw Error('附件路径超出沙箱或包含符号链接');
  const fd=openSync(p,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
  try{const s=fstatSync(fd);if(!s.isFile()||s.size>max)throw Error('仅支持大小限制内的普通文件');const b=Buffer.alloc(s.size);let n=0;while(n<b.length){const k=readSync(fd,b,n,b.length-n,null);if(!k)throw Error('读取附件时文件发生变化');n+=k;}return b;}finally{closeSync(fd);}
}
export class QqMedia{
  constructor({home,phone,nap,container=null,mediaPathPrefix='/',mediaUploadDir=null,download=downloadQq}){
    Object.assign(this,{home,phone,nap,container,mediaPathPrefix,mediaUploadDir,download});this.cache=join(home,'media');mkdirSync(this.cache,{recursive:true,mode:0o700});this.file=join(home,'media.json');
    try{this.state=JSON.parse(readFileSync(this.file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;this.state={version:1,forwards:{},files:{},uploads:{}};}
    if(this.state.version!==1||!this.state.files||!this.state.forwards||!this.state.uploads)throw Error('媒体索引异常，保留数据并停止');
    for(const s of Object.values(this.state.uploads))if(s.phase==='sending')s.phase='uncertain';this.pending=new Map();this.save();
  }
  save(){writeFileSync(this.file+'.tmp',JSON.stringify(this.state),{mode:0o600});renameSync(this.file+'.tmp',this.file);}
  authorized(key){const c=this.phone.state.channels[key];if(!c?.enabled)throw Error('频道已暂停或未绑定');return c;}
  find(key,ref){
    this.authorized(key);
    const messages=[...(this.phone.state.channels[key].history||[]),...this.phone.state.jobs.filter(j=>j.channelKey===key).flatMap(j=>j.messages),...Object.values(this.state.forwards).filter(f=>f.channel===key).flatMap(f=>f.messages)];
    const a=messages.flatMap(m=>m.attachments||[]).find(a=>a.ref===ref);if(!a)throw Error('附件不属于当前频道或引用已过期');return a;
  }
  once(key,fn){if(this.pending.has(key))return this.pending.get(key);const p=Promise.resolve().then(fn).finally(()=>this.pending.delete(key));this.pending.set(key,p);return p;}
  forward(key,ref,depth=0){return this.once('forward:'+key+':'+ref,async()=>{
    const a=this.find(key,ref);if(a.type!=='forward')throw Error('引用不是合并转发');
    depth=Math.max(depth,a.depth||0);
    const cacheKey=key+':'+ref;if(this.state.forwards[cacheKey])return this.state.forwards[cacheKey];
    if(depth>=3)throw Error('合并转发嵌套最多3层');
    if(Object.keys(this.state.forwards).length>=500)throw Error('转发缓存已满');
    const r=await this.nap.onebot('get_forward_msg',{message_id:a.fileId});
    const rows=Array.isArray(r?.messages)?r.messages:[];let budget=24000;
    const messages=[];let nodes=0;
    const walk=(list,level)=>{if(level>3||!Array.isArray(list))return;for(const [i,m]of list.slice(0,60).entries()){
      if(nodes++>=60||budget<=0)break;
      const d=m.type==='node'?m.data:m;
      let parts=d?.message||d?.content||[];if(typeof parts==='string')parts=[{type:'text',data:{text:parts}}];if(!Array.isArray(parts))continue;
      const id='forward:'+ref+':'+nodes+':'+i;
      const text=parts.filter(p=>p.type==='text').map(p=>str(p.data?.text,4000)).join('').slice(0,Math.min(4000,budget));budget-=text.length;
      messages.push({id,at:Number(d.time)*1000||null,sender:str(d.sender?.nickname||d.nickname||String(d.user_id||'?'),80),senderId:String(d.sender?.user_id||d.user_id||''),text,forwarded:true,depth:level,attachments:extractMedia(parts,id).map(a=>({...a,depth:level+1}))});
      for(const p of parts){if(p.type==='node')walk([p],level+1);else if(p.type==='forward'&&Array.isArray(p.data?.content))walk(p.data.content,level+1);}
    }};
    walk(rows,depth);const value={channel:key,ref,untrusted:true,messages,truncated:rows.length>messages.length||nodes>=60||budget<=0};this.state.forwards[cacheKey]=value;this.save();return value;
  });}
  localDownloadPath(path){
    if(this.container&&process.platform==='win32'&&!this.mediaPathPrefix)throw Error('Windows 上读取本地附件前，必须配置 NapCat 共享目录 mediaPathPrefix');
    if(this.container&&this.mediaPathPrefix)return this.mapRemotePath(path,'附件路径不在配置的媒体映射目录');
    if(!this.container)throw Error('未配置 NapCat 容器映射目录；仅可通过 QQ 附件地址接收');
    // Only QQ's download trees are mapped from proot to Android. Never accept
    // a tool caller's path or a path from the incoming message itself here.
    if(typeof path!=='string'||!posix.isAbsolute(path))throw Error('NapCat未返回本地附件');
    const clean=posix.normalize(path);
    if(!['/root/.config/QQ/','/root/NapCat.linux.arm64/','/tmp/','/root/.local/share/QQ/'].some(r=>clean.startsWith(r)))throw Error('NapCat附件路径不在下载目录');
    const p=join(this.container,clean.slice(1));if(!within(realpathSync(this.container),realpathSync(p)))throw Error('附件路径超出容器');return p;
  }
  mapRemotePath(path,message='NapCat 未返回本地附件',createDirectory=false){
    if(!this.container)throw Error('未配置 NapCat 媒体映射目录');
    const style=process.platform==='win32'?win32:posix;
    if(typeof path!=='string'||!style.isAbsolute(path))throw Error('NapCat附件路径不是绝对路径');
    const root=style.resolve(this.mediaPathPrefix||'/'),candidate=style.resolve(path),rel=style.relative(root,candidate);
    if(!rel||rel.startsWith('..')||style.isAbsolute(rel))throw Error(message);
    const mapped=join(this.container,...rel.split(/[\\/]+/));
    if(createDirectory){
      const realRoot=realpathSync(this.container),target=resolve(mapped),pathFromRoot=relative(realRoot,target);
      if(!within(realRoot,target))throw Error('附件路径超出媒体映射目录');
      let current=realRoot;
      for(const part of pathFromRoot.split(/[\\/]+/).filter(Boolean)){
        current=join(current,part);
        try{
          const item=lstatSync(current);
          if(item.isSymbolicLink()||!item.isDirectory())throw Error('媒体映射目录中不允许符号链接或非目录路径');
        }catch(error){
          if(error.code!=='ENOENT')throw error;
          mkdirSync(current,{mode:0o700});
        }
      }
      if(!within(realRoot,realpathSync(current)))throw Error('附件路径超出媒体映射目录');
    }else if(!within(realpathSync(this.container),realpathSync(mapped)))throw Error('附件路径超出媒体映射目录');
    return mapped;
  }
  receive(key,ref){return this.once('receive:'+key+':'+ref,async()=>{
    const a=this.find(key,ref);if(!['image','file'].includes(a.type))throw Error('请先展开合并转发');
    const limit=a.type==='image'?MAX_IMAGE:MAX_FILE;if(a.size>limit)throw Error('附件过大：图片8MB，文件20MB');
    const cached=Object.values(this.state.files).find(f=>f.channel===key&&f.ref===ref);if(cached)return this.fileInfo(cached);
    let bytes;const errors=[];
    if(a.type==='image'&&a.url)try{bytes=await this.download(a.url,limit);}catch{errors.push('image-url');}
    if(!bytes&&a.fileId&&!/^(?:[a-z]+:|\/|\\|\.\.)/i.test(a.fileId))try{
      const r=await this.nap.onebot(a.type==='image'?'get_image':'get_file',{file:a.fileId});
      if(Number(r?.file_size)>limit)throw Error('附件超过大小限制');
      if(r?.file)try{bytes=readBounded(this.localDownloadPath(r.file),limit);}catch{errors.push('local');}
      if(!bytes&&r?.url&&/^https?:/.test(r.url))bytes=await this.download(r.url,limit);
    }catch{errors.push('api');}
    if(!bytes&&a.url&&a.type!=='image')bytes=await this.download(a.url,limit);
    if(!bytes&&a.type==='file'&&a.fileId){const c=this.authorized(key);const r=await this.nap.onebot(c.kind==='private'?'get_private_file_url':'get_group_file_url',{file_id:a.fileId,...c.kind==='group'?{group_id:String(c.id)}:{}});if(r?.url)bytes=await this.download(r.url,limit);}
    if(!bytes)throw Error('附件下载失败，可能已过期；请对方重新发送');if(bytes.length>limit)throw Error('附件超过大小限制');
    const digest=hash(bytes),fileId=hash(key+':'+ref+':'+digest).slice(0,32),name=safeName(a.name),path=join(this.cache,fileId);
    const used=Object.values(this.state.files).reduce((n,f)=>n+f.bytes,0);if(used+bytes.length>256*1024*1024)throw Error('媒体缓存已达256MB，请机主整理缓存');
    try{writeFileSync(path,bytes,{mode:0o600,flag:'wx'});}catch(e){if(e.code!=='EEXIST'||hash(readBounded(path,limit,this.cache))!==digest)throw e;}
    const f={fileId,channel:key,ref,name,bytes:bytes.length,sha256:digest,path,type:a.type,at:Date.now()};this.state.files[fileId]=f;this.save();return this.fileInfo(f);
  });}
  fileInfo(f){return {fileId:f.fileId,ref:f.ref,name:f.name,bytes:f.bytes,sha256:f.sha256,type:f.type};}
  fileRecord(key,fileId){this.authorized(key);const f=this.state.files[fileId];if(!f||f.channel!==key)throw Error('文件不属于当前频道');return f;}
  bytes(key,fileId){const f=this.fileRecord(key,fileId);return readBounded(f.path,MAX_FILE,this.cache);}
  readText(key,fileId,offset=0){
    const f=this.fileRecord(key,fileId),bytes=this.bytes(key,fileId);
    if(!/\.(txt|md|csv|tsv|json|jsonl|log|xml|html|yaml|yml|js|mjs|py|ini|srt|vtt)$/i.test(f.name))return {...this.fileInfo(f),text:null,note:'二进制文件已接收；当前接口仅预览UTF-8文本。'};
    if(!Number.isInteger(offset)||offset<0||offset>bytes.length)throw Error('offset超出文件范围');
    const end=Math.min(bytes.length,offset+32768),text=bytes.subarray(offset,end).toString('utf8');return {...this.fileInfo(f),untrusted:true,text,offset,nextOffset:end<bytes.length?end:null};
  }
  async upload(key,sessionId,args,privileged=false){
    if(!this.container)throw Error('未配置媒体共享目录；当前设备仅支持文字回复和附件下载');
    if(process.platform==='win32'&&!this.mediaPathPrefix)throw Error('Windows 上上传附件前，必须配置 NapCat 共享目录 mediaPathPrefix');
    const c=this.authorized(key),id=str(args.requestId,100);if(!id||id!==args.requestId)throw Error('需要1至100字符的稳定requestId');
    if([args.fileId!==undefined,args.path!==undefined,args.text!==undefined].filter(Boolean).length!==1)throw Error('fileId、path、text必须且只能提供一项');
    let bytes,name=args.name;
    if(args.fileId){const f=this.fileRecord(key,args.fileId);bytes=this.bytes(key,args.fileId);name||=f.name;}
    else if(args.path){if(!privileged)throw Error('其他联系人和群聊不能上传任意本机路径');bytes=readBounded(args.path,MAX_FILE);name||=safeName(args.path);}
    else {if(typeof args.text!=='string'||Buffer.byteLength(args.text)>1024*1024)throw Error('文本文件最大1MB');bytes=Buffer.from(args.text);name||='reply.txt';}
    name=safeName(name);const fingerprint=hash(Buffer.concat([Buffer.from(name+'\0'),bytes])),request=hash(key+':'+sessionId+':'+id);
    const old=this.state.uploads[request];if(old){if(old.fingerprint!==fingerprint)throw Error('requestId已用于不同文件');if(old.phase==='done')return {sent:true,duplicatePrevented:true,fileId:old.fileId};throw Error('该文件发送结果未知或仍在发送，不会重复上传；请机主核对QQ');}
    if(Object.keys(this.state.uploads).length>=5000)throw Error('上传回执已满，请机主整理');
    const pathStyle=process.platform==='win32'?win32:posix;
    const remoteDir=this.mediaUploadDir||pathStyle.join(this.mediaPathPrefix||'/', 'root','dsh-chat-phone-transfer',hash(this.home).slice(0,16));
    const dir=this.mapRemotePath(remoteDir,'媒体上传目录必须位于 NapCat 映射目录内',true);
    // The container path is fixed; no user-supplied file names become paths.
    const leaf=randomUUID(),staged=join(dir,leaf);writeFileSync(staged,bytes,{mode:0o600,flag:'wx'});
    const record={channel:key,sessionId,fingerprint,name,phase:'sending',at:Date.now()};this.state.uploads[request]=record;this.save();
    try{
      if(!this.authorized(key)||this.phone.state.scope?.paused)throw Object.assign(Error('频道已暂停'),{definite:true});
      const remotePath=pathStyle.join(remoteDir,leaf);
      const r=await this.nap.onebot(c.kind==='private'?'upload_private_file':'upload_group_file',{[c.kind==='private'?'user_id':'group_id']:String(c.id),file:remotePath,name});
      if(!r?.file_id)throw Error('缺少文件发送回执');record.phase='done';record.fileId=String(r.file_id);this.save();try{unlinkSync(staged);}catch{}return {sent:true,fileId:record.fileId,name,bytes:bytes.length};
    }catch(e){record.phase=e.definite?'rejected':'uncertain';this.save();if(e.definite)try{unlinkSync(staged);}catch{}throw Error(e.definite?'文件发送被拒绝，请机主检查后使用新requestId':'文件发送结果未知，已禁止自动重发；请机主核对QQ');}
  }
  async prepare(j){
    const forwards=[],notes=[];for(const a of j.messages.flatMap(m=>m.attachments||[]).filter(a=>a.type==='forward').slice(0,2))try{const f=await this.forward(j.channelKey,a.ref);forwards.push({ref:a.ref,untrusted:true,messages:f.messages.map(publicMessage),truncated:f.truncated});}catch{notes.push('转发 '+a.ref+' 暂未读取，可调用chat_phone_media重试');}
    return {forwards,notes};
  }
}
