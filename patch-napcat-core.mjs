// Changes local recovery policy only. No account identity or credentials are modified.
export function patchNapcatCore(source){
  if(source.includes('DSH_CONSERVATIVE_LOGIN_20261022'))return source;
  let s=source;
  const replace=(before,after)=>{if(s.split(before).length!==2)throw Error('NapCat core version mismatch: '+before.slice(0,65));s=s.replace(before,after);};
  const begin=s.indexOf('function pAe({'),end=s.indexOf('\nclass dAe ',begin);
  if(begin<0||end<0)throw Error('Missing recovery coordinator');
  s=s.slice(0,begin)+`// DSH_CONSERVATIVE_LOGIN_20261022: observe native reconnection; never restart on account events.
function pAe({isOnline, onOffline, onRecovered}) {
  let timer;
  return (reason, soft) => {
    clearInterval(timer);
    onOffline(reason, soft);
    if (!soft) return;
    timer = setInterval(() => {
      if (isOnline()) { clearInterval(timer); onRecovered(); }
    }, 30000);
    timer.unref?.();
  };
}
`+s.slice(end);
  replace('onOffline: (i) => {\n        pe.setQQLoginStatus(!1)', 'onOffline: (i, soft) => {\n        pe.setQQLoginStatus(!!soft)');
  replace('c.onLoginDisConnected = () => {\n    o.isLogined = !1', 'c.onLoginDisConnected = () => {\n    if (pe.getOneBotContext()?.core) { e.logWarn("[Core] [Login] 登录服务连接中断，保留现有QQ会话等待网络恢复"); return; }\n    o.isLogined = !1');
  replace('if (!o.isLogined) {\n        pe.setQQLoginPhase("generating_qrcode");', 'if (!o.isLogined && !pe.getOneBotContext()?.core) {\n        pe.setQQLoginPhase("generating_qrcode");');
  replace('u === 1 && l === 3 && (pe.setQQLoginError("二维码已过期，请刷新"), t.getQRCodePicture())', 'u === 1 && l === 3 && (pe.setQQLoginError("二维码已过期，请手动刷新；自动取码已停止"), pe.setQQLoginPhase("qrcode_expired"))');
  return s;
}
