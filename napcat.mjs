import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import qrcode from './qrcode.mjs';

export function classify(login, onebot, status) {
  if(login?.isOffline || /^(reconnecting|connecting)$/.test(login?.loginPhase||'') || (login?.isLogin && status?.online===false)) return {state:'reconnecting',label:'QQ 连接暂时中断，保留登录等待恢复'};
  if(login?.isLogin && onebot && status?.online!==false) return {state:'online',label:'QQ 在线'};
  if(login?.isLogin) return {state:'api-unavailable',label:'QQ 已登录，OneBot 接口未就绪'};
  if(!login) return {state:'service-unavailable',label:'登录服务无响应'};
  if(login.qrLoginAccepted || /confirm|scan/i.test(login.loginPhase||'')) return {state:'confirmation',label:'请在手机 QQ 确认登录'};
  if(login.qrcodeurl) return {state:'qr-required',label:'等待扫码；可先尝试快速登录'};
  return {state:'logged-out',label:'QQ 未登录，可尝试快速登录'};
}
export class NapCat {
  constructor({home, onebotConfig, webuiConfig, onebotUrl='http://127.0.0.1:3000', webuiUrl='http://127.0.0.1:6099', fetchImpl=fetch, now=Date.now, restart, loginServiceFault=()=>false, networkAvailable=()=>null}) {
    Object.assign(this,{home,onebotConfig,webuiConfig,onebotUrl,webuiUrl,fetchImpl,now,restart,loginServiceFault,networkAvailable});
    this.credential=null;this.busy=false;this.failures=0;this.lastProbe=0;this.health={state:'checking',label:'正在检查'};
    this.file=home+'/recovery.json';
    try{this.recovery=JSON.parse(readFileSync(this.file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;this.recovery={attempts:0,nextAttempt:0,lastRestart:0};}
    // Both Android spaces use the same NapCat. Share login limits across engines.
    this.guardFile=onebotConfig?dirname(onebotConfig)+'/dsh-login-guard.json':home+'/login-guard.json';
  }
  guard(){try{return JSON.parse(readFileSync(this.guardFile,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;return {};}}
  saveGuard(g){mkdirSync(dirname(this.guardFile),{recursive:true,mode:0o700});writeFileSync(this.guardFile,JSON.stringify(g),{mode:0o600});}
  save(){mkdirSync(dirname(this.file),{recursive:true,mode:0o700});writeFileSync(this.file+'.tmp',JSON.stringify(this.recovery),{mode:0o600});renameSync(this.file+'.tmp',this.file);}
  token() {
    const c=JSON.parse(readFileSync(this.onebotConfig,'utf8'));
    const endpoint=new URL(this.onebotUrl||'http://127.0.0.1:3000');
    if(endpoint.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(endpoint.hostname)||endpoint.username||endpoint.password)throw Error('OneBot 仅允许本机 HTTP 地址');
    const port=Number(endpoint.port||80);
    const server=c.network?.httpServers?.find(x=>x.enable && Number(x.port)===port) || c.httpServers?.find(x=>x.enable && Number(x.port)===port);
    if(!server?.token)throw Error('未找到与 OneBot 地址端口匹配的认证配置');
    return server.token;
  }
  async onebot(action,args={}) {
    if(!/^[a-z_]+$/.test(action))throw Error('Invalid action');
    const endpoint=new URL(this.onebotUrl);
    if(endpoint.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(endpoint.hostname)||endpoint.username||endpoint.password)throw Error('OneBot 仅允许本机 HTTP 地址');
    const url=this.onebotUrl.replace(/\/$/,'')+'/'+action,authorization='Bearer '+this.token();
    let r;
    try{r=await this.fetchImpl(url,{method:'POST',headers:{'content-type':'application/json',authorization},body:JSON.stringify(args),signal:AbortSignal.timeout(12000)});}catch{throw Error('OneBot 连接失败');}
    let b;try{b=await r.json();}catch{throw Error('OneBot 返回无效响应');}
    if(!r.ok || b.status!=='ok' || b.retcode!==0) {const e=Error('OneBot 请求被拒绝');e.definite=true;throw e;}
    return b.data;
  }
  async web(path,args={},retry=true) {
    if(!this.webuiConfig)throw Error('未配置 NapCat WebUI；此安装只支持 OneBot 收发，不支持插件内登录恢复');
    if(!this.credential){
      const {token}=JSON.parse(readFileSync(this.webuiConfig,'utf8'));
      const r=await this.fetchImpl((this.webuiUrl||'http://127.0.0.1:6099').replace(/\/$/,'')+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({hash:createHash('sha256').update(token+'.napcat').digest('hex')}),signal:AbortSignal.timeout(10000)});
      const b=await r.json();if(b.code!==0 || !b.data?.Credential)throw Error('NapCat 管理认证失败');this.credential=b.data.Credential;
    }
    const r=await this.fetchImpl((this.webuiUrl||'http://127.0.0.1:6099').replace(/\/$/,'')+'/api/'+path,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+this.credential},body:JSON.stringify(args),signal:AbortSignal.timeout(12000)});
    const b=await r.json();
    if((r.status===401 || b.code===401 || /unauth|credential/i.test(b.message||'')) && retry){this.credential=null;return this.web(path,args,false);}
    if(!r.ok || b.code!==0)throw Error('NapCat 登录请求未成功');return b.data;
  }
  async probe() {
    let login=null,info=null;
    const results=await Promise.allSettled([this.webuiConfig===null?Promise.resolve(null):this.web('QQLogin/CheckLoginStatus'),this.onebot('get_login_info'),this.onebot('get_status')]);
    if(results[0].status==='fulfilled')login=results[0].value;
    if(results[1].status==='fulfilled')info=results[1].value;
    this.login=login;this.selfId=info?String(info.user_id):this.selfId;
    const status=results[2].status==='fulfilled'?results[2].value:null;
    this.health={...(this.webuiConfig===null?status?.online===true&&info?{state:'online',label:'QQ 在线（OneBot）'}:{state:'api-unavailable',label:'OneBot 未就绪'}:classify(login,!!info&&status?.online===true,status)),phase:login?.loginPhase||null,at:this.now(),nextAttempt:this.recovery.nextAttempt,attempts:this.recovery.attempts};
    if(this.health.state==='logged-out' && login?.loginPhase==='offline' && this.loginServiceFault()){
      this.health={...this.health,state:'login-service-unavailable',label:'NapCat 登录连接已断开'};
      this.faultSince ||= this.now();
    }else this.faultSince=0;
    if(this.health.state!=='online' && this.networkAvailable()===false){
      this.health={...this.health,state:'network-unavailable',label:'手机网络未连接，等待恢复'};
      this.faultSince=0;
    }
    if(login)this.failures=0;else this.failures++;
    if(this.health.state==='online'){this.recovery.attempts=0;this.recovery.nextAttempt=0;this.recovery.lastIssue=null;this.save();}
    this.lastProbe=this.now();return this.health;
  }
  async recover({manual=false,qr=false,restart=false}={}) {
    if(this.busy)return {...this.health,recovering:true};
    if(!manual && this.now()<this.recovery.nextAttempt)return this.health;
    this.busy=true;
    try{
      await this.probe();
      if(this.health.state==='online')return this.health;
      if(!manual){this.recovery.lastIssue='自动重登及登录服务自动重启已关闭；只检查状态，等待人工处理';return this.health;}
      if(this.health.state==='network-unavailable'){
        this.recovery.lastIssue='请连接 Wi-Fi 或打开移动数据；断网期间不重启QQ、不清登录数据';return this.health;
      }
      const history=(this.recovery.restartHistory||[]).filter(t=>this.now()-t<86400000);
      if(restart){
        if(this.now()-this.recovery.lastRestart<600000)throw Error('登录服务重启有10分钟冷却，请等待当前恢复');
        if(['qr-required','confirmation','reconnecting','api-unavailable'].includes(this.health.state))throw Error('当前登录仍有效、等待扫码或正在恢复连接，请勿重启登录服务');
        this.recovery.lastRestart=this.now();this.recovery.restartHistory=[...history,this.now()];this.save();await this.restart();this.credential=null;
        this.health={state:'restarting',label:'登录服务正在重启，稍后自动检查'};return this.health;
      }
      if(this.health.state==='api-unavailable') {this.recovery.lastIssue='QQ已登录但OneBot异常，请检查接口配置；不要反复扫码';return this.health;}
      if(['confirmation','reconnecting'].includes(this.health.state))return this.health;
      if(!this.login){this.recovery.lastIssue='登录服务无响应；看门狗会处理进程故障，持续异常可点重启登录服务';return this.health;}
      if(qr){
        const guard=this.guard();
        if(guard.lastQrAt&&this.now()-guard.lastQrAt<60000){this.recovery.lastIssue='二维码刷新有60秒冷却，请先扫描现有码';return this.health;}
        const previous=this.login.qrcodeurl;
        guard.lastQrAt=this.now();this.saveGuard(guard);
        await this.web('QQLogin/RefreshQRcode');
        for(let i=0;i<16;i++){
          await this.probe();
          if(this.health.state==='online'||this.health.state==='confirmation'||this.login?.qrcodeurl!==previous)break;
          await new Promise(resolve=>setTimeout(resolve,250));
        }
        return this.health;
      }
      if(this.health.state==='qr-required'){this.recovery.lastIssue='正在等待扫码，不再叠加快速登录请求';return this.health;}
      const guard=this.guard(),attempts=(guard.attempts||[]).filter(t=>this.now()-t<3600000);
      if((guard.lastAttempt&&this.now()-guard.lastAttempt<600000)||attempts.length>=3){this.recovery.lastIssue='快速登录已限流：至少间隔10分钟，每小时最多3次';return this.health;}
      if(/风控|冻结|封禁|验证|kicked|踢|顶|受限|captcha|risk/i.test(this.login.loginError||'')){this.recovery.lastIssue='需要在官方QQ处理验证或限制，停止重登';return this.health;}
      // Never guess between multiple saved QQ accounts.
      const list=await this.web('QQLogin/GetQuickLoginListNew');
      const quick=(Array.isArray(list)?list:[]).filter(x=>x.isQuickLogin===true);
      const account=this.selfId?quick.find(x=>String(x.uin)===this.selfId):(quick.length===1?quick[0]:null);
      if(!account){this.recovery.lastIssue=quick.length>1?'有多个保存账号，请在 NapCat 管理页选择正确账号':'快速登录不可用，请打开扫码登录';return this.health;}
      guard.lastAttempt=this.now();guard.attempts=[...attempts,this.now()];this.saveGuard(guard);
      await this.web('QQLogin/SetQuickLogin',{uin:String(account.uin)});
      this.recovery.lastIssue='已请求快速登录，等待手机确认或自动恢复';await this.probe();return this.health;
    }catch(e){this.recovery.lastIssue=String(e.message).startsWith('登录服务重启')||String(e.message).startsWith('当前正在')?e.message:'快速恢复未成功，请检查网络或打开扫码登录';return {...this.health,issue:this.recovery.lastIssue};}
    finally{
      if(this.health.state==='online'){this.recovery.attempts=0;this.recovery.nextAttempt=0;}
      else{this.recovery.attempts=Math.min(10,this.recovery.attempts+1);this.recovery.nextAttempt=this.now()+Math.min(1800000,60000*2**Math.min(5,this.recovery.attempts-1));}
      this.save();this.busy=false;
    }
  }
  async tick(){
    if(this.busy)return;
    await this.probe();
  }
  status(){return {...this.health,recovering:this.busy,issue:this.recovery.lastIssue||null,nextAttempt:0,autoLogin:false};}
  async qr(){
    await this.recover({manual:true,qr:true});const url=this.health.state==='online'?null:this.login?.qrcodeurl||null;
    let image=null;if(url){const code=qrcode(0,'M');code.addData(url);code.make();image=code.createDataURL(5,12);}
    return {status:this.status(),image};
  }
}
