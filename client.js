window.__ModuleLoader__.load({id:'dsh-chat-phone',factory(require){
  const React=require('react');const {createElement:h,useState,useEffect,useRef}=React;
  const ID='dsh-chat-phone',KIND='chat-phone';
  const css=`.dcp{height:100%;box-sizing:border-box;overflow:auto;padding:16px;display:flex;flex-direction:column;gap:12px;background:var(--dsw-alias-bg-base,#f7f8fa);color:var(--dsw-alias-label-primary,#20232b);font:13px/1.6 system-ui,sans-serif}.dcp h3,.dcp p{margin:0}.dcp section{padding:12px;border:1px solid #81909544;border-radius:12px;display:grid;gap:8px}.dcp input,.dcp button,.dcp select,.dcp textarea{font:inherit;color:inherit;border:1px solid #81909566;border-radius:8px;padding:8px;background:var(--dsw-alias-bg-layer-1,#fff);min-width:0;box-sizing:border-box}.dcp button{cursor:pointer;min-height:36px}.dcp button:disabled{opacity:.45}.dcp select,.dcp textarea{width:100%}.dcp textarea{resize:vertical;min-height:68px}.dcp-row{display:flex;gap:6px;flex-wrap:wrap}.dcp small{opacity:.72}.dcp-message{padding:8px 10px;background:var(--dsw-alias-bg-layer-1,#fff);border-radius:8px;white-space:pre-wrap;overflow-wrap:anywhere}.dcp-messages{display:grid;gap:8px;max-height:50vh;overflow:auto}.dcp-error{background:#b4433415;color:#c75640;padding:8px;border-radius:8px;overflow-wrap:anywhere}.dcp-qr{background:white;border-radius:8px;padding:12px;display:block;width:min(230px,100%);height:auto}.dcp-primary{background:#247d69!important;color:white!important}.dcp-guide{padding:14px;width:100%;text-align:left;background:transparent;color:inherit;border:1px solid #81909544;border-radius:10px;cursor:pointer}.dcp-empty{padding:24px 8px;text-align:center;opacity:.7}`;
  function Icon(){return h('span',{'aria-hidden':true},'▣');}
  function Guide({useTabInfo}){const {tab}=useTabInfo();return h('button',{className:'dcp-guide',onClick:()=>tab.actions.openTab(KIND,{replaceTab:true})},'▣ 聊天手机 · QQ 收件箱与原会话回复');}
  function Body({rpc}){
    const [state,setState]=useState(null),[sessions,setSessions]=useState([]),[selected,setSelected]=useState(''),[channelKey,setChannelKey]=useState(''),[messages,setMessages]=useState([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[text,setText]=useState(''),[qr,setQr]=useState(null),[owner,setOwner]=useState('');
    const alive=useRef(true),sending=useRef(null),inflight=useRef(false),active=useRef('');
    const channel=state?.channels?.find(c=>(c.key||c.group)===channelKey),scope=state?.scope;
    const args=c=>({kind:c.kind||'group',id:c.id||c.group,group:c.kind==='private'?undefined:c.id||c.group});
    async function call(method,args={}){const r=await rpc(method,args);if(!r.ok)throw Error(r.error?.message||'连接失败');return r.value;}
    async function refresh(){
      if(inflight.current)return;inflight.current=true;
      try{const v=await call('status');if(!alive.current)return;setState(v);
        const list=v.channels||[];let current=list.find(c=>(c.key||c.group)===active.current)||list.find(c=>c.owner)||list[0];
        if(current){const key=current.key||current.group;active.current=key;setChannelKey(key);const r=await call('read',{...args(current),limit:40});if(alive.current&&active.current===key)setMessages(r.messages);}
        else setMessages([]);
      }catch(e){if(alive.current)setError(e.message);}finally{inflight.current=false;}
    }
    useEffect(()=>{alive.current=true;void refresh();call('sessions').then(v=>{if(alive.current)setSessions(v);}).catch(e=>{if(alive.current)setError(e.message);});const timer=setInterval(refresh,5000);return()=>{alive.current=false;clearInterval(timer);};},[]);
    async function run(method,args={}){setBusy(true);setError('');try{const result=await call(method,args);if(method==='qr')setQr(result);if(method==='reconcile'&&!result.resolved)setError(result.summary);await refresh();return result;}catch(e){setError(e.message);return null;}finally{setBusy(false);}}
    async function send(){if(!text.trim()||!channel)return;sending.current||={...args(channel),text,requestId:crypto.randomUUID()};const r=await run('send',sending.current);if(r?.sent){sending.current=null;setText('');}}
    const button=(label,action,disabled=false,primary=false)=>h('button',{type:'button',disabled:busy||disabled,onClick:action,className:primary?'dcp-primary':''},label);
    return h('div',{className:'dcp'},
      h('header',null,h('h3',null,'▣ 聊天手机'),h('small',null,'QQ 私聊与群聊 · 独立记录 · 后台收件')),
      error&&h('div',{role:'alert',className:'dcp-error'},error),
      h('section',null,h('strong',null,state?.login?.label||'正在连接…'),h('small',null,state?.login?.issue||'关闭侧栏后后台仍继续收件'),
        h('small',null,'实时收件：'+({connected:'已连接',connecting:'连接中',disconnected:'等待连接',closed:'已关闭','event-error':'消息处理异常'}[state?.events?.state]||'检查中')),
        h('small',null,'自动重登已关闭；断线仅检查状态。人工快速登录至少间隔10分钟，每小时最多3次。'),
        h('div',{className:'dcp-row'},button('快速重登',()=>run('recover')),button('扫码登录',()=>run('qr')),button('刷新',refresh)),
        h('details',null,h('summary',null,'掉线排查与恢复'),
          h('p',null,state?.login?.state==='network-unavailable'?'手机当前没有可用网络。先连接 Wi-Fi 或开启移动数据，并确认 NapCat 的 VPN 路由可访问 QQ；断网时不要重启或清登录数据。':
            state?.login?.state==='api-unavailable'?'QQ 登录仍有效，但 OneBot 接口未就绪。检查 NapCat 的 OneBot 配置和接口状态；此时反复扫码通常无效。':
            state?.login?.state==='reconnecting'?'账号仍有登录态，正在等待原连接恢复。不要扫码、快速重登或重启登录服务；先检查手机和热点网络。':
            state?.login?.state==='confirmation'?'QQ 正在等待确认。请在官方 QQ 手机上确认登录；确认前不要重启登录服务或刷新二维码。':
            state?.login?.state==='qr-required'?'正在等待扫码，不叠加快速登录。二维码过期后再点击扫码登录刷新，刷新至少间隔60秒。':
            state?.login?.state==='logged-out'?'确认网络恢复后，可手动尝试一次快速登录；失败后检查官方 QQ 安全提示，再决定是否扫码。':
            ['service-unavailable','login-service-unavailable'].includes(state?.login?.state)?'先确认手机网络和 VPN 路由，再考虑重启登录服务。重启有 10 分钟冷却，且不能在扫码或确认过程中进行。':
            state?.login?.state==='online'&&state?.events?.state!=='connected'?'QQ 已登录；目前异常在实时消息接口。先刷新状态并检查 OneBot WebSocket，通常不需要扫码。':'登录反复中断时，记录登录状态和错误阶段；检查息屏网络、VPN 路由、后台限制及 QQ 官方安全提示。不要清除 NapCat 数据或反复重装。'),
          h('p',null,'快速恢复不会删除账号数据。若被挤下线、要求风控验证或账号受限，需在官方 QQ 处理；插件无法绕过平台验证。'),
          button('重启登录服务',()=>run('recover',{restart:true}))),
        qr?.image&&h('img',{className:'dcp-qr',src:qr.image,alt:'NapCat 实时登录二维码'}),qr&&!qr.image&&h('p',null,qr.status?.state==='online'?'QQ 已在线，无需扫码。':'二维码尚未生成，稍后点击扫码登录。')),
      h('section',null,h('strong',null,scope?.enabled?'全 QQ 已启用':'回复范围'),
        scope?.enabled&&h(React.Fragment,null,h('p',null,`机主联系人：${scope.ownerId}（仅私聊拥有机主权限）`),h('small',null,`原会话：${sessions.find(s=>s.id===scope.rootSessionId)?.title||scope.rootSessionId} · ${(state.channels||[]).filter(c=>c.kind==='group').length} 个群 · ${(state.channels||[]).filter(c=>c.kind==='private').length} 位好友`),button(scope.paused?'恢复全部自动回复':'暂停全部自动回复',()=>run('scope-pause',{paused:!scope.paused})),h('small',null,'机主私聊连接原会话；其他群和好友各自保留会话，不共享原私人聊天记录。')),
        h('details',null,h('summary',null,scope?.enabled?'更改机主与原会话':'配置机主与原会话'),
          h('label',null,'机主联系人 QQ 号',h('input',{inputMode:'numeric',value:owner,placeholder:scope?.ownerId||'填写QQ号',onChange:e=>setOwner(e.target.value)})),
          h('select',{'aria-label':'选择原DSH会话',value:selected,onChange:e=>setSelected(e.target.value)},h('option',{value:''},'选择原 DSH 会话…'),sessions.map(s=>h('option',{key:s.id,value:s.id},s.title+(sessions.filter(x=>x.title===s.title).length>1?` · ${s.updatedAt?new Date(s.updatedAt).toLocaleDateString():s.id.slice(-8)} · ${s.id.slice(-6)}`:'')))),
          button('启用所有群和好友私聊',()=>run('scope',{ownerId:owner||scope?.ownerId,rootSessionId:selected||scope?.rootSessionId,allGroups:true,friendPrivate:true}),!(selected||scope?.rootSessionId)||!(owner||scope?.ownerId),true),
          h('small',null,'只接收已加入群与好友的新消息，不自动加好友、入群或补答旧记录。'))),
      state?.issue&&h('div',{className:'dcp-error'},state.issue),
      (state?.jobs||[]).length>0&&h('section',null,h('strong',null,'处理队列'),state.jobs.map(j=>h('div',{key:j.id},`${j.kind==='private'?'私聊':'群'} ${j.idValue||j.group} · ${j.count} 条 · ${{pending:'待处理',waking:'正在唤醒',woken:'模型处理中',stalled:'处理失败',uncertain:'发送结果未知',sending:'发送中'}[j.phase]||j.phase}`,j.phase==='uncertain'&&button('核对发送结果',()=>run('reconcile',{batchId:j.id}))))),
      h('section',null,h('strong',null,'聊天列表'),
        h('select',{'aria-label':'选择QQ聊天',value:channelKey,disabled:!!sending.current,onChange:e=>{active.current=e.target.value;setChannelKey(e.target.value);setMessages([]);void refresh();}},(state?.channels||[]).map(c=>h('option',{key:c.key||c.group,value:c.key||c.group},`${c.owner?'机主 · ':''}${c.kind==='private'?'私聊':'群'} · ${c.label||c.id||c.group}${c.enabled?'':' · 已暂停'}`))),
        channel&&button(channel.enabled?'暂停此聊天':'恢复此聊天',()=>run('pause',{...args(channel),paused:channel.enabled})),
        h('div',{className:'dcp-messages'},messages.length?messages.map(m=>h('article',{key:m.id,className:'dcp-message'},h('small',null,`${m.self?'我':m.sender} · ${new Date(m.at).toLocaleTimeString()}`),h('div',null,m.text),...(m.attachments||[]).map(a=>h('small',{key:a.ref,style:{display:'block'}},`${{image:'图片',forward:'合并转发',file:'文件'}[a.type]||a.type} · ${a.name} · ref ${a.ref}`)))):h('div',{className:'dcp-empty'},'等待新消息；首次只建立历史基线')),
        h('textarea',{'aria-label':'发送到当前QQ聊天',placeholder:'发送到当前选中的聊天',value:text,maxLength:3000,disabled:!!sending.current,onChange:e=>setText(e.target.value)}),button(sending.current?'检查 / 重试同一条':'发送',send,!channel?.enabled||!!scope?.paused||!text.trim()),h('small',null,'群消息停顿6秒后合并；普通回复间隔15秒。无关聊天可不回，@优先合并后回应。')),
      h('small',null,'持续在线需要 DSH、NapCat、网络和模型 API 可用。图片支持视觉模型读取；合并转发可展开；文件支持接收、文本预览与上传（文件20MB、图片8MB）。语音与视频暂未解析。版本 0.4.1'));
  }
  function apply(ctx){
    ctx.effect(()=>{const s=document.createElement('style');s.dataset.plugin=ID;s.textContent=css;document.head.appendChild(s);return()=>s.remove();},'chat-phone.style');
    ctx.effect(()=>ctx.sidebarRightTabs.register({id:ID,kind:KIND,multiple:false,title:()=> '聊天手机',guide:[{id:'chat-phone',order:26,title:()=> '聊天手机',description:()=> 'QQ收件与原会话回复',icon:Icon}]}),'chat-phone.tab');
    const rpc=(method,payload,signal)=>ctx.connection.rpc.call('/dsh-chat-phone',method,payload,signal);
    ctx.effect(()=>ctx.slots.inject('sidebar.right.tab.guide.entry',()=>ctx.slots.register({name:'sidebar.right.tab.guide.entry',key:ID},Guide)),'chat-phone.guide');
    ctx.effect(()=>ctx.slots.inject('sidebar.right.pane.tab',()=>ctx.slots.register({name:'sidebar.right.pane.tab',key:ID,inject:()=>({rpc})},Body)),'chat-phone.body');
    ctx.effect(()=>ctx.slots.inject('sidebar.right.pane.tab.title',()=>ctx.slots.register({name:'sidebar.right.pane.tab.title',key:ID},()=>h('span',null,'▣ 聊天手机'))),'chat-phone.title');
  }
  return {inject:['slots','sidebarRightTabs','connection'],apply};
}});
