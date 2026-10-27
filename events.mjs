import {readFileSync} from 'node:fs';

export class QqEvents {
  constructor({onebotConfig,onEvent,onConnect=()=>{},Socket=globalThis.WebSocket,now=Date.now,eventServerName='dsh-chat-phone-events',eventUrl=null}){
    Object.assign(this,{onebotConfig,onEvent,onConnect,Socket,now,eventServerName,eventUrl});this.socket=null;this.state='disconnected';this.nextAttempt=0;this.lastEvent=0;this.openedAt=0;this.closed=false;this.failures=0;
  }
  endpoint(){
    const c=JSON.parse(readFileSync(this.onebotConfig,'utf8'));
    const s=(c.network?.websocketServers||c.websocketServers||[]).find(s=>s.enable&&s.name===this.eventServerName);
    if(!s||!['127.0.0.1','localhost','::1','[::1]'].includes(s.host)||!s.token)throw Error('实时消息接口未配置');
    const host=String(s.host).includes(':')&&!String(s.host).startsWith('[')?`[${s.host}]`:String(s.host);
    const u=new URL(this.eventUrl||`ws://${host}:${Number(s.port)}/`);
    if(!['ws:','wss:'].includes(u.protocol)||!['127.0.0.1','localhost','::1','[::1]'].includes(u.hostname)||Number(u.port)!==Number(s.port))throw Error('实时消息仅允许本机已认证接口');
    u.searchParams.set('access_token',s.token);
    return u.toString();
  }
  tick(){
    if(this.closed)return;
    if(this.socket){if(this.now()-Math.max(this.lastEvent,this.openedAt)>90000)this.socket.close();return;}
    if(this.now()<this.nextAttempt)return;
    let socket;
    try{socket=new this.Socket(this.endpoint());}catch{this.failed();return;}
    this.socket=socket;this.state='connecting';this.openedAt=this.now();
    socket.addEventListener('open',()=>{if(this.socket!==socket)return;this.state='connected';this.failures=0;this.openedAt=this.now();this.onConnect();});
    socket.addEventListener('message',e=>{
      if(this.socket!==socket)return;
      try{if(String(e.data).length>2*1024*1024)return;const m=JSON.parse(String(e.data));this.lastEvent=this.now();this.onEvent(m);}catch{this.state='event-error';}
    });
    socket.addEventListener('error',()=>{socket.close();});
    socket.addEventListener('close',()=>{if(this.socket===socket){this.socket=null;this.failed();}});
  }
  failed(){this.state='disconnected';this.failures++;this.nextAttempt=this.now()+Math.min(30000,1000*2**Math.min(5,this.failures));}
  status(){return {state:this.state,lastEvent:this.lastEvent,nextAttempt:this.nextAttempt};}
  close(){this.closed=true;const socket=this.socket;this.socket=null;socket?.close();this.state='closed';}
}
