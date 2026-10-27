import {createHash} from 'node:crypto';
import {extractMedia} from './media.mjs';

export function peerSession(scope,kind,id) {
  if(kind==='private'&&String(id)===scope.ownerId)return scope.rootSessionId;
  return 'session-qq-'+createHash('sha256').update([scope.accountId,scope.rootSessionId,kind,String(id)].join(':')).digest('hex').slice(0,32);
}
export function normalizeMessage(m,selfId,kind,ownerId) {
  const senderId=String(m.sender?.user_id??m.user_id??'');
  const parts=Array.isArray(m.message)?m.message:[{type:'text',data:{text:String(m.raw_message||m.message||'')}}];
  return {id:String(m.message_id??''),at:Number(m.time)*1000,senderId,sender:String(m.sender?.card||m.sender?.nickname||senderId||'?'),
    owner:kind==='private'&&senderId===ownerId,self:senderId===String(selfId),
    mention:parts.some(p=>p.type==='at'&&(String(p.data?.qq)===String(selfId)||p.data?.qq==='all')),
    text:parts.map(p=>p.type==='text'?p.data?.text||'':p.type==='at'?`[@${p.data?.qq}]`:`[${p.type}]`).join(''),attachments:extractMedia(parts,String(m.message_id??''))};
}
export function activeOwnerBatch(phone,agent) {
  const source=lastSource(agent);
  if(source?.kind!=='plugin:dsh-chat-phone')return false;
  const j=phone.state.jobs.find(j=>j.id===source.batchId);
  return !!(j&&j.sessionId===agent?.id&&j.kind==='private'&&j.idValue===phone.ownerId&&j.owner&&j.messages.length&&
    j.messages.every(m=>m.senderId===phone.ownerId&&!m.self));
}
export function lastSource(agent) {
  const events=agent?.session?.snapshotEvents?.()||[];
  for(let i=events.length-1;i>=0;i--)if(events[i].type==='user/message')return events[i].data?.source;
  return null;
}

export class QqRouting {
  constructor(phone){this.phone=phone;this.groups=new Set();this.friends=new Set();this.directoryReady=false;this.apply();}
  apply(){const s=this.scope;this.phone.allowedGroups=s?.enabled&&s.allGroups?'*':this.phone.initialAllowedGroups;this.phone.allowPrivate=!!s?.enabled&&!!s.friendPrivate;this.phone.ownerId=s?.ownerId||null;}
  get scope(){return this.phone.state.scope||null;}
  configure({ownerId,rootSessionId,accountId,allGroups,friendPrivate}){
    if(!/^\d{5,12}$/.test(String(ownerId))||!/^\d{5,12}$/.test(String(accountId)))throw Error('需要明确的机主QQ号和登录账号');
    if(String(ownerId)===String(accountId))throw Error('机主联系人不能是模型登录账号本身');
    if(!rootSessionId||allGroups!==true||friendPrivate!==true)throw Error('需要明确原会话、所有群及好友私聊授权');
    if(this.phone.state.jobs.some(j=>!['done','skipped','expired','cancelled'].includes(j.phase)))throw Error('请先处理现有未结批次，再扩展范围');
    const previous=this.scope;
    this.phone.state.scope={enabled:true,ownerId:String(ownerId),rootSessionId,accountId:String(accountId),allGroups:true,friendPrivate:true,since:previous?.since||this.phone.now(),paused:previous?.paused||false};
    this.apply();
    // Preserve existing channel histories and receipts. Change only future
    // delivery routes; no DSH conversation or original message is edited.
    for(const [key,c] of Object.entries(this.phone.state.channels)){
      c.kind||='group';c.id||=key;c.rootSessionId=rootSessionId;c.sessionId=peerSession(this.scope,c.kind,c.id);c.owner=c.kind==='private'&&c.id===String(ownerId);
    }
    this.phone.save();this.directoryReady=false;return this.scope;
  }
  directory(groups,friends){
    this.groups=new Set(groups.map(g=>String(g.group_id)));this.friends=new Set(friends.map(f=>String(f.user_id)));this.directoryReady=true;
    if(!this.scope?.enabled)return;
    for(const g of groups)this.ensure('group',String(g.group_id),g.group_name);
    for(const f of friends)if(String(f.user_id)!==this.scope.accountId)this.ensure('private',String(f.user_id),f.remark||f.nickname);
  }
  allowed(kind,id){return !!this.scope?.enabled&&this.directoryReady&&(kind==='group'?this.groups.has(String(id)):this.friends.has(String(id)));}
  ensure(kind,id,label){
    if(!this.allowed(kind,id))return null;
    const sessionId=peerSession(this.scope,kind,id),r=this.phone.ensureChannel(kind,id,sessionId,{owner:kind==='private'&&id===this.scope.ownerId,label});
    if(r.conflict)throw Error('QQ频道绑定冲突');
    const c=this.phone.state.channels[r.key];if(c.rootSessionId!==this.scope.rootSessionId){c.rootSessionId=this.scope.rootSessionId;this.phone.save();}return r.key;
  }
  event(m,selfId){
    if(!this.scope?.enabled||this.scope.paused||String(selfId)!==this.scope.accountId||String(m.self_id)!==this.scope.accountId)return false;
    if(m.post_type==='notice'&&m.notice_type==='group_upload'&&m.file?.id){
      // A group file can arrive as a notice rather than a normal message.
      const id=String(m.group_id);if(!this.allowed('group',id))return false;
      m={...m,post_type:'message',message_type:'group',message_id:'upload:'+m.file.id,message:[{type:'file',data:{file_id:m.file.id,name:m.file.name,size:m.file.size}}]};
    }
    if(!['message','message_sent'].includes(m.post_type))return false;
    const kind=m.message_type==='group'?'group':m.message_type==='private'?'private':null;if(!kind)return false;
    const id=String(kind==='group'?m.group_id:m.user_id);if(!this.allowed(kind,id))return false;
    const msg=normalizeMessage(m,selfId,kind,this.scope.ownerId);if(msg.at<this.scope.since||!msg.id||msg.self)return false;
    const key=this.ensure(kind,id);const c=this.phone.state.channels[key];
    // A newly received event is already a new message, not a history baseline.
    c.primed=true;this.phone.ingest(key,[msg],kind);return true;
  }
}
