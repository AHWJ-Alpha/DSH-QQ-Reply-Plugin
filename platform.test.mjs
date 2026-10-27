import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {findOnebotConfig} from './index.js';
import {QqEvents} from './events.mjs';
import {NapCat} from './napcat.mjs';

function configFile(value) {
  const dir=mkdtempSync(join(tmpdir(),'dsh-qq-plugin-'));
  const path=join(dir,'onebot.json');writeFileSync(path,JSON.stringify(value));return path;
}

test('authenticated event endpoint is local and its credentials stay in the config file',()=>{
  const onebotConfig=configFile({network:{websocketServers:[{enable:true,name:'dsh-chat-phone-events',host:'127.0.0.1',port:3301,token:'synthetic-ws-token'}]}});
  const events=new QqEvents({onebotConfig});
  const url=new URL(events.endpoint());
  assert.equal(url.origin,'ws://127.0.0.1:3301');
  assert.equal(url.searchParams.get('access_token'),'synthetic-ws-token');
  const unsafe=configFile({network:{websocketServers:[{enable:true,name:'dsh-chat-phone-events',host:'0.0.0.0',port:3301,token:'synthetic'}]}});
  assert.throws(()=>new QqEvents({onebotConfig:unsafe}).endpoint(),/未配置/);
});

test('event endpoint keeps a configured loopback hostname',()=>{
  const onebotConfig=configFile({network:{websocketServers:[{enable:true,name:'dsh-chat-phone-events',host:'localhost',port:3302,token:'synthetic-localhost-token'}]}});
  const events=new QqEvents({onebotConfig});
  assert.equal(new URL(events.endpoint()).origin,'ws://localhost:3302');
  const ipv6Config=configFile({network:{websocketServers:[{enable:true,name:'dsh-chat-phone-events',host:'::1',port:3303,token:'synthetic-ipv6-token'}]}});
  assert.equal(new URL(new QqEvents({onebotConfig:ipv6Config}).endpoint()).origin,'ws://[::1]:3303');
});

test('OneBot uses the configured loopback port and refuses public endpoints',async()=>{
  const onebotConfig=configFile({network:{httpServers:[{enable:true,port:3304,token:'synthetic-http-token'}]}});
  const home=mkdtempSync(join(tmpdir(),'dsh-qq-home-'));
  let request;
  const nap=new NapCat({home,onebotConfig,onebotUrl:'http://127.0.0.1:3304',fetchImpl:async(url,options)=>{
    request={url,options};return {ok:true,json:async()=>({status:'ok',retcode:0,data:{online:true}})};
  }});
  assert.deepEqual(await nap.onebot('get_status'),{online:true});
  assert.equal(request.url,'http://127.0.0.1:3304/get_status');
  assert.equal(request.options.headers.authorization,'Bearer synthetic-http-token');
  const unsafe=new NapCat({home,onebotConfig,onebotUrl:'http://example.com:3304'});
  await assert.rejects(unsafe.onebot('get_status'),/本机 HTTP/);
});

test('NapCat config discovery follows the configured HTTP port',()=>{
  const dir=mkdtempSync(join(tmpdir(),'dsh-napcat-config-'));
  const write=(name,port)=>writeFileSync(join(dir,name),JSON.stringify({network:{httpServers:[{enable:true,port,token:`token-${port}`}]}}));
  write('onebot11_default.json',3000);write('onebot11_custom.json',3304);
  assert.match(findOnebotConfig(dir,3304),/onebot11_custom\.json$/);
  assert.match(findOnebotConfig(dir,3000),/onebot11_default\.json$/);
  assert.equal(findOnebotConfig(dir,80),null);
});
