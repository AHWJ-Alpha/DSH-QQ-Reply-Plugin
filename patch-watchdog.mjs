export function patchWatchdog(source){
 if(source.includes('DSH_LOGIN_WATCHDOG_022'))return source;
 let s=source;const replace=(a,b)=>{if(s.split(a).length!==2)throw Error('watchdog version mismatch');s=s.replace(a,b);};
 replace('# Keeps Xvfb', '# DSH_LOGIN_WATCHDOG_022: account login is checked by authenticated DSH probes.\n# Keeps Xvfb');
 replace('  [ "$login" = "in" ] && outSince=0', '  # Preserve outSince until recovery duration has been calculated.');
 replace('if [ "$login" = "out" ] && { [ "$loginState" != "out" ] || [ $(( $(date +%s) - lastAlertAt )) -ge 1800 ]; }; then', 'if [ "$login" = "out" ] && [ "$loginState" != "out" ]; then');
 const lines=s.split('\n');
 for(let i=0;i<lines.length;i++){
  if(lines[i].trimStart().startsWith('alert "QQ 掉登录了'))lines[i]='    alert "QQ消息接口未就绪（已持续 ${dur} 分钟）。端口探针不能确认账号掉登录；请查看DSH聊天手机的真实状态，勿反复扫码。"';
  if(lines[i].includes('alert "QQ 已重新登录'))lines[i]='    [ "$loginState" = "out" ] && alert "QQ消息接口恢复（中断 $(( outSince > 0 ? ($(date +%s) - outSince) / 60 : 0 )) 分钟）。登录状态以DSH认证探针为准。"';
 }
 s=lines.join('\n');
 replace('    loginState=in', '    loginState=in; outSince=0');
 replace('if [ "$n" -eq 0 ] || [ "$webui" = false ] || [ "$webuiAlive" = false ]; then', 'if [ "$n" -eq 0 ] && [ "$webuiAlive" = false ]; then');
 replace('if [ "$fail" -ge 2 ]; then', 'if [ "$fail" -ge 4 ]; then');
 return s;
}
