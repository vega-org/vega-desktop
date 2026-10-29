import {prepareMediaSource,releaseMediaSource} from '../../platform/mediaDelivery';
import {platformFetch} from '../../platform/network';
import {isTauriRuntime} from '../../platform/host';
import {LibmediaEngine} from '@vega/libmedia-engine';
import type {MediaTrack} from '@vega/libmedia-engine/core/media';
import type {PlaybackState,VideoQuality} from '@vega/libmedia-engine/core/playback-state';
import type {PlayerEngine,PlayerEngineOptions,PlayerEngineState,TrackInfo} from './PlayerEngine';
import {getSubtitleStyleConfig} from './subUtils';
import './libmedia-subtitles.css';

/** Desktop owns controls and networking; the shared engine owns all playback. */
export class LibmediaPlayerAdapter implements PlayerEngine {
 private engine=new LibmediaEngine();
 private container=document.createElement('div');
 private listeners=new Set<(state:PlayerEngineState)=>void>();
 private generation=0;
 private disposed=false;
 private delivered?:Awaited<ReturnType<typeof prepareMediaSource>>;
 private subtitles:NonNullable<PlayerEngineOptions['subtitles']>=[];
 private subtitleIds=new Map<string,number>();
 private externalTracks:TrackInfo[]=[];
 private subtitleQueue:Promise<void>=Promise.resolve();
 private qualities:VideoQuality[]=[];
 private qualityId:number|null=null;
 private audioNeedsGesture=false;
 private paused=true;
 private styleObserver:ResizeObserver|null=null;
 source='';
 headers:Record<string,string>={};
 state:PlayerEngineState={isInitialized:true,isPaused:true,currentTime:0,duration:0,volume:100,speed:1,isBuffering:false,cacheDuration:0,tracks:[],audioTracks:[],subtitleTracks:[],videoTracks:[],chapters:[],videoHeight:0,error:null,audioDelay:0,subtitleDelay:0};
 constructor(private anchor:HTMLVideoElement){
  this.container.className='player-video-element libmedia-surface';
  this.container.style.position='relative';
  this.container.style.width='100%';
  this.container.style.height='100%';
  this.anchor.hidden=true;
  this.anchor.before(this.container);
  this.engine.attach(this.container);
  this.updateSubtitleSettings();
  if(typeof ResizeObserver!=='undefined'){
   this.styleObserver=new ResizeObserver(()=>this.updateSubtitleSettings());
   this.styleObserver.observe(this.container);
  }
  this.engine.setEventListeners({onStateChange:state=>this.receive(state),onError:error=>{
   console.error('[Libmedia] Playback failure', {
    category:error.category, message:error.message, details:error.rawDetails,
    recoverable:error.recoverable, timestamp:error.timestamp,
    diagnostics:this.engine.getDiagnostics(),
   });
   this.update({error:error.message,isBuffering:false});
  }});
 }
 subscribe(listener:(state:PlayerEngineState)=>void){this.listeners.add(listener);listener(this.state);return()=>{this.listeners.delete(listener);};}
 private update(state:Partial<PlayerEngineState>){if(this.disposed)return;this.state={...this.state,...state};for(const listener of this.listeners)listener(this.state);}
 private track(track:MediaTrack):TrackInfo{return {id:track.id,type:track.type==='subtitle'?'sub':track.type,title:track.title||track.label,lang:track.language||'',codec:track.codec||'',selected:track.selected,external:[...this.subtitleIds.values()].includes(track.id),demuxW:track.width,demuxH:track.height};}
 private receive(state:Partial<PlaybackState>){
  const next:Partial<PlayerEngineState>={};
  if(state.status){next.isBuffering=['loading','seeking','buffering'].includes(state.status);if(['playing','paused','ended','idle'].includes(state.status))this.paused=state.status!=='playing';}
  if(state.audioNeedsUserGesture!==undefined)this.audioNeedsGesture=state.audioNeedsUserGesture;
  // Reuse desktop's Play action to unlock audio; no receiver dialog/UI.
  if(state.status||state.audioNeedsUserGesture!==undefined)next.isPaused=this.paused||this.audioNeedsGesture;
  if(state.currentTime!==undefined)next.currentTime=state.currentTime;
  if(state.duration!==undefined)next.duration=state.duration;
  if(state.volume!==undefined)next.volume=state.volume*100;
  if(state.playbackRate!==undefined)next.speed=state.playbackRate;
  if(state.subtitleDelay!==undefined)next.subtitleDelay=state.subtitleDelay*1000;
  if(state.error!==undefined)next.error=state.error?.message||null;
  if(state.audioTracks)next.audioTracks=state.audioTracks.map(track=>this.track(track));
  if(state.subtitleTracks)next.subtitleTracks=[...state.subtitleTracks.map(track=>this.track(track)),...this.externalTracks.filter(track=>!this.subtitleIds.has(this.subtitles[-1000-track.id]?.url||this.subtitles[-1000-track.id]?.uri||''))];
  if(state.videoTracks){next.videoTracks=state.videoTracks.map(track=>this.track(track));next.videoHeight=state.videoTracks.find(track=>track.selected)?.height||0;}
  if(state.qualities)this.qualities=state.qualities;
  if(state.selectedQualityId!==undefined)this.qualityId=state.selectedQualityId;
  if(this.qualities.length>1){
   next.videoTracks=this.qualities.map(quality=>({id:quality.id,type:'video',title:quality.label,lang:'',codec:quality.codec||'',selected:quality.id===this.qualityId,external:false,demuxW:quality.width,demuxH:quality.height}));
   next.videoHeight=next.videoTracks.find(track=>track.selected)?.demuxH||next.videoHeight;
  }
  if(next.audioTracks||next.subtitleTracks||next.videoTracks)next.tracks=[...(next.videoTracks||this.state.videoTracks),...(next.audioTracks||this.state.audioTracks),...(next.subtitleTracks||this.state.subtitleTracks)];
  this.update(next);
 }
 async load(source:string,options:PlayerEngineOptions={}){
  const generation=++this.generation;this.source=source;this.headers=options.headers||{};
  const previous=this.delivered;this.delivered=undefined;
  await releaseMediaSource(previous);
  if(generation!==this.generation||this.disposed)return;
  this.qualities=[];this.qualityId=null;
  this.audioNeedsGesture=false;this.paused=true;
  this.subtitleIds.clear();this.subtitles=options.subtitles||[];this.externalTracks=[];
  this.update({error:null,isBuffering:true,currentTime:0,duration:0,tracks:[],audioTracks:[],subtitleTracks:[],videoTracks:[]});
  const hint=options.streamType?.toLowerCase();
  const format=/hls|m3u8|mpegurl/.test(hint||'')?'hls':hint?.includes('matroska')?'mkv':hint?.includes('mp4')?'mp4':hint?.includes('webm')?'webm':hint;
  const delivered=await prepareMediaSource({id:String(generation),source,format,startPosition:options.startTime,headers:this.headers});
  if(generation!==this.generation||this.disposed){await releaseMediaSource(delivered);return;}
  this.delivered=delivered;
  try{await this.engine.load(delivered);}catch(error){await releaseMediaSource(delivered);if(this.delivered===delivered)this.delivered=undefined;throw error;}
  if(generation!==this.generation||this.disposed)return;
  if(options.speed)this.setSpeed(options.speed);
  if(options.audioIndex!==undefined){const track=this.state.audioTracks[options.audioIndex];if(track)await this.selectTrack('aid',track.id);}
  if(options.subtitleIndex==='off')await this.selectTrack('sid','no');
  else if(options.subtitleIndex!==undefined){const track=this.state.subtitleTracks[options.subtitleIndex];if(track)await this.selectTrack('sid',track.id);}
  // List external metadata immediately; download only when selected.
  this.setExternalSubtitles(this.subtitles);
  if(generation===this.generation&&options.autoPlay===false)await this.engine.pause();
 }
 async play(){await this.engine.resumeAudio();await this.engine.play();}
 pause(){void this.engine.pause().catch(error=>this.update({error:String(error)}));}
 seek(time:number){return this.engine.seek(time);}
 setVolume(volume:number){this.engine.setVolume(Math.max(0,Math.min(100,volume))/100);}
 setSpeed(speed:number){this.engine.setPlaybackRate(speed);}
 async selectTrack(type:'aid'|'sid'|'vid',id:number|'no'|'auto'){
  if(type==='sid'&&typeof id==='number'&&id<=-1000){
   const sub=this.subtitles[-1000-id];if(!sub)return;
   const generation=this.generation;
   this.subtitleQueue=this.subtitleQueue.catch(()=>{}).then(async()=>{
    const engineId=await this.registerSubtitle(sub,generation);
    if(engineId!==undefined&&generation===this.generation){await this.engine.selectSubtitleTrack(engineId);await this.engine.setSubtitleEnabled(true);}
   });await this.subtitleQueue;return;
  }
  if(type==='sid'){if(id==='no')await this.engine.setSubtitleEnabled(false);else{const track=id==='auto'?this.state.subtitleTracks[0]?.id:id;if(track!==undefined){await this.engine.selectSubtitleTrack(track);await this.engine.setSubtitleEnabled(true);}}}
  else if(type==='aid'){const track=typeof id==='number'?id:this.state.audioTracks[0]?.id;if(track!==undefined)await this.engine.selectAudioTrack(track);}
  else if(this.qualities.length>1&&typeof id==='number')await this.engine.selectQuality(id);
  else if(!this.state.videoTracks.some(track=>track.selected&&track.id===id))throw new Error('Video track switching is unavailable for this source');
 }
 setProperty(property:string,value:unknown){if(property==='panscan')this.engine.setAspectFit(Boolean(value));}
 updateSubtitleSettings(){
  if(this.disposed)return;
  const config=getSubtitleStyleConfig();
  // Desktop ASS styles use a 1080-line reference canvas. Keep text size and
  // padding consistent with that scale as the player resizes.
  const scale=(this.container.clientHeight||window.innerHeight||1080)/1080;
  const size=Math.max(0,config.shadowSize)*scale;
  const shadowColor=config.shadowColor;
  let shadow='none';
  if(size>0&&shadowColor!=='transparent'&&shadowColor!=='none'&&config.shadowStyle!=='none'){
   if(config.shadowStyle==='glow')shadow=`0 0 ${size*1.6}px ${shadowColor}, 0 0 ${size*3.2}px ${shadowColor}`;
   else if(config.shadowStyle==='raised')shadow=`-${size*.6}px -${size*.6}px 0 rgba(255,255,255,.45), ${size}px ${size}px 0 ${shadowColor}`;
   else if(config.shadowStyle==='depressed')shadow=`${size}px ${size}px 0 rgba(255,255,255,.35), -${size*.6}px -${size*.6}px 0 ${shadowColor}`;
   else shadow=`${size*.7}px ${size*.84}px 0 ${shadowColor}`;
  }
  const style=this.container.style;
  for(const [key,value] of Object.entries({
   'font-family':`${JSON.stringify(config.fontFamily)}, Arial, sans-serif`,
   'font-size':`${config.fontSize*scale}px`,
   'font-weight':String(config.fontWeight),
   'color':config.textColor,
   'outline':`${Math.max(0,config.outlineSize)*scale}px ${config.outlineColor}`,
   'shadow':shadow,
   'padding':`${config.bottomPadding*scale}px`,
  }))style.setProperty(`--vega-sub-${key}`,value);
 }
 setSubtitleDelay(delayMs:number){this.engine.setSubtitleDelay(delayMs/1000);this.update({subtitleDelay:delayMs});}
 async addSubtitleFile(path:string,title?:string){
  const generation=this.generation;
  const response=await this.fetchSubtitle(path);
  if(generation!==this.generation||this.disposed)return;
  const source=/\.(srt|vtt|ass|ssa|ttml)(?:[?#]|$)/i.exec(path)?.[1]||/\.(srt|vtt|ass|ssa|ttml)$/i.exec(title||'')?.[1];
  // libmedia detects external subtitle formats by URL extension.
  if(!response.ok)throw new Error(`Subtitle request failed (${response.status})`);
  const text=await response.blob();
  if(generation!==this.generation||this.disposed)return;
  await this.engine.loadExternalSubtitle({source:new File([text],`subtitle.${source||'srt'}`),title});
 }
 setExternalSubtitles(subs:NonNullable<PlayerEngineOptions['subtitles']>){
  this.subtitles=subs;
  this.externalTracks=subs.map((sub,index):TrackInfo=>({id:-1000-index,type:'sub',title:sub.title||sub.language||`Subtitle ${index+1}`,lang:sub.language||'',codec:'',selected:false,external:true}));
  this.receive({subtitleTracks:this.engine.getSubtitleTracks()});
 }
 private async registerSubtitle(sub:NonNullable<PlayerEngineOptions['subtitles']>[number],generation:number){
  const source=sub.url||sub.uri;if(!source)return;
  if(this.subtitleIds.has(source))return this.subtitleIds.get(source);
  const response=await this.fetchSubtitle(source);
  if(generation!==this.generation||this.disposed)return;
  if(!response.ok)throw new Error(`Subtitle request failed (${response.status})`);
  const body=await response.blob();if(generation!==this.generation||this.disposed)return;
  const extension=/\.(srt|vtt|ass|ssa|ttml)(?:[?#]|$)/i.exec(source)?.[1]||'srt';
  const id=await this.engine.loadExternalSubtitle({source:new File([body],`subtitle.${extension}`),lang:sub.language,title:sub.title});
  if(generation!==this.generation||this.disposed)return;
  this.subtitleIds.set(source,id);
  this.receive({subtitleTracks:this.engine.getSubtitleTracks()});
  return id;
 }
 private async fetchSubtitle(source:string){
  // Subtitles are bounded text requests, so host HTTP can deliver them directly.
  if(!isTauriRuntime()&&/^https?:/i.test(source))return platformFetch(source,{headers:this.headers});
  const delivered=await prepareMediaSource({id:`subtitle-${this.generation}`,source,headers:this.headers});
  try{
   const response=typeof delivered.source==='string'?await platformFetch(delivered.source,{headers:delivered.headers}):new Response(delivered.source);
   // Consume the small subtitle before revoking its delivery lease.
   const body=await response.blob();return new Response(body,{status:response.status,statusText:response.statusText,headers:response.headers});
  }finally{await releaseMediaSource(delivered);}
 }
 destroy(){this.disposed=true;++this.generation;this.styleObserver?.disconnect();this.listeners.clear();const delivered=this.delivered;this.delivered=undefined;void this.engine.destroy().finally(()=>{this.container.remove();void releaseMediaSource(delivered).catch(()=>{});});this.anchor.hidden=false;}
}
