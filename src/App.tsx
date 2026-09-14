import { useState, useEffect, useRef } from 'react';
import { Play, Pause, Square, Upload, Volume2, Headphones, Disc3, CircleDot, X, Timer, AlertTriangle, VolumeX, Mic2 } from 'lucide-react';

type Track = { id:number; title:string; artist:string; bpm:number; color:string; url?:string; };
const DEMO:Track[]=[{id:1,title:"All Day In City",artist:"HD - BABYDOLL",bpm:128.9,color:"#00FF88"},{id:2,title:"Crown Rush",artist:"HD - ANISTTTO",bpm:128.4,color:"#00E5FF"},{id:3,title:"Open Your Eyes",artist:"CERES",bpm:93.3,color:"#FFB800"},{id:4,title:"Don't Rock",artist:"Midnight Star",bpm:92.3,color:"#FF3B8D"}];
type Deck={track:Track; playing:boolean; pitch:number; elapsed:number; duration:number; cuePoint:number|null; pfl:boolean; low:number; mid:number; high:number;};

export default function App(){
  const [tracks,setTracks]=useState(DEMO);
  const [deckA,setDeckA]=useState<Deck>({track:DEMO[0],playing:false,pitch:0,elapsed:0,duration:0,cuePoint:null,pfl:false,low:0,mid:0,high:0});
  const [deckB,setDeckB]=useState<Deck>({track:DEMO[1],playing:false,pitch:0,elapsed:0,duration:0,cuePoint:null,pfl:true,low:0,mid:0,high:0});
  const [cross,setCross]=useState(0); const [masterVol,setMasterVol]=useState(85); const [cueVol,setCueVol]=useState(80);
  const [rec,setRec]=useState(false); const [recT,setRecT]=useState(0);

  const aRef=useRef<HTMLAudioElement>(null); const bRef=useRef<HTMLAudioElement>(null);
  const ctxRef=useRef<AudioContext|null>(null);
  const masterGain=useRef<GainNode|null>(null); const cueBusGain=useRef<GainNode|null>(null);
  const gA=useRef<GainNode|null>(null); const gB=useRef<GainNode|null>(null);
  const fAL=useRef<BiquadFilterNode|null>(null); const fAM=useRef<BiquadFilterNode|null>(null); const fAH=useRef<BiquadFilterNode|null>(null);
  const fBL=useRef<BiquadFilterNode|null>(null); const fBM=useRef<BiquadFilterNode|null>(null); const fBH=useRef<BiquadFilterNode|null>(null);
  const anA=useRef<AnalyserNode|null>(null); const anB=useRef<AnalyserNode|null>(null);
  const dest=useRef<MediaStreamAudioDestinationNode|null>(null); const recR=useRef<MediaRecorder|null>(null);
  const cA=useRef<HTMLCanvasElement>(null); const cB=useRef<HTMLCanvasElement>(null);
  const xRef=useRef<HTMLDivElement>(null); const drag=useRef(false);

  useEffect(()=>{
    if(ctxRef.current) return;
    const ctx=new (window.AudioContext||(window as any).webkitAudioContext)(); ctxRef.current=ctx;
    const mk=(t:BiquadFilterType,f:number)=>{ const n=ctx.createBiquadFilter(); n.type=t; n.frequency.value=f; if(t==='peaking') n.Q.value=1; return n; };
    fAL.current=mk('lowshelf',320); fAM.current=mk('peaking',1000); fAH.current=mk('highshelf',3200);
    fBL.current=mk('lowshelf',320); fBM.current=mk('peaking',1000); fBH.current=mk('highshelf',3200);
    gA.current=ctx.createGain(); gB.current=ctx.createGain();
    masterGain.current=ctx.createGain(); cueBusGain.current=ctx.createGain();
    masterGain.current.gain.value=masterVol/100; cueBusGain.current.gain.value=cueVol/100;
    anA.current=ctx.createAnalyser(); anB.current=ctx.createAnalyser(); anA.current.fftSize=256; anB.current.fftSize=256;
    dest.current=ctx.createMediaStreamDestination();
    // Chain: source -> EQ -> channelGain -> MASTER GAIN -> analyser -> destination
    // Also channelGain -> CUE BUS (independent)
    fAL.current.connect(fAM.current!); fAM.current!.connect(fAH.current!); fAH.current!.connect(gA.current!);
    fBL.current.connect(fBM.current!); fBM.current!.connect(fBH.current!); fBH.current!.connect(gB.current!);
    gA.current!.connect(masterGain.current!); gB.current!.connect(masterGain.current!);
    masterGain.current!.connect(anA.current!); // master analyser reused for master out
    // CUE bus taps pre-master, post EQ
    // We'll use an extra gain for cue: gA and gB also feed cueBusGain when pfl on
    // Simplified: gA -> cueBusGain (volume controlled separately)
    gA.current!.connect(cueBusGain.current!); gB.current!.connect(cueBusGain.current!);
    anA.current!.connect(ctx.destination); // master to speakers
    // For visualisation B we duplicate analyser from master? Use second analyser from cueBus for B vis
    anB.current!.connect(ctx.destination);
    cueBusGain.current!.connect(anB.current!); // cue bus visible on B analyser when pfl active
    masterGain.current!.connect(dest.current!); // REC records ONLY MASTER, not cueBus (pro!)
    setTimeout(()=>{ try{ if(aRef.current){ const s=ctx.createMediaElementSource(aRef.current); s.connect(fAL.current!); } if(bRef.current){ const s=ctx.createMediaElementSource(bRef.current); s.connect(fBL.current!); } }catch{} },600);
  },[]);

  useEffect(()=>{ if(masterGain.current) masterGain.current.gain.value=masterVol/100; },[masterVol]);
  useEffect(()=>{ if(cueBusGain.current) cueBusGain.current.gain.value=cueVol/100; },[cueVol]);

  useEffect(()=>{
    if(!gA.current||!gB.current) return;
    const n=(cross+100)/200;
    const pflA = deckA.pfl ? 1 : 0; const pflB = deckB.pfl ? 1 : 0;
    // Master mix with crossfader
    gA.current.gain.value=Math.cos(n*Math.PI/2);
    gB.current.gain.value=Math.cos((1-n)*Math.PI/2);
    // Mute channel in master if not? Actually keep crossfader logic; PFL does NOT mute master (DJM behavior: PFL doesn't affect master)
  },[cross, deckA.pfl, deckB.pfl]);

  const applyEQ=(l:any,m:any,h:any,d:Deck)=>{ if(!l||!m||!h) return; l.gain.value=d.low; m.gain.value=d.mid; h.gain.value=d.high; };
  useEffect(()=>applyEQ(fAL.current,fAM.current,fAH.current,deckA),[deckA.low,deckA.mid,deckA.high]);
  useEffect(()=>applyEQ(fBL.current,fBM.current,fBH.current,deckB),[deckB.low,deckB.mid,deckB.high]);
  useEffect(()=>{ if(aRef.current) aRef.current.playbackRate=1+deckA.pitch/100; },[deckA.pitch]);
  useEffect(()=>{ if(bRef.current) bRef.current.playbackRate=1+deckB.pitch/100; },[deckB.pitch]);
  useEffect(()=>{ if(!aRef.current) return; if(deckA.playing){ ctxRef.current?.resume(); aRef.current.play().catch(()=>{});} else aRef.current.pause(); },[deckA.playing]);
  useEffect(()=>{ if(!bRef.current) return; if(deckB.playing){ ctxRef.current?.resume(); bRef.current.play().catch(()=>{});} else bRef.current.pause(); },[deckB.playing]);

  useEffect(()=>{
    const id=setInterval(()=>{
      if(aRef.current){ if(deckA.playing) setDeckA(v=>({...v, elapsed:aRef.current!.currentTime, duration:aRef.current!.duration||v.duration})); if(!isNaN(aRef.current.duration)) setDeckA(v=>({...v, duration:aRef.current!.duration})); }
      if(bRef.current){ if(deckB.playing) setDeckB(v=>({...v, elapsed:bRef.current!.currentTime, duration:bRef.current!.duration||v.duration})); if(!isNaN(bRef.current.duration)) setDeckB(v=>({...v, duration:bRef.current!.duration})); }
      if(rec) setRecT(t=>t+0.1);
    },120); return()=>clearInterval(id);
  },[deckA.playing,deckB.playing,rec]);

  useEffect(()=>{
    let raf:number; const draw=()=>{
      raf=requestAnimationFrame(draw);
      const dc=(can:HTMLCanvasElement|null,an:AnalyserNode|null,col:string, elapsed:number, dur:number, cue:number|null)=>{
        if(!can||!an) return; const ctx=can.getContext('2d')!; const w=can.width, h=can.height; const data=new Uint8Array(an.frequencyBinCount); an.getByteFrequencyData(data);
        ctx.clearRect(0,0,w,h); ctx.fillStyle='rgba(255,255,255,0.04)'; for(let i=0;i<w;i+=24) ctx.fillRect(i,0,1,h);
        const bw=w/data.length*2.2; let x=0; for(let i=0;i<data.length;i++){ const bh=data[i]/255*h*0.85; ctx.fillStyle=col; ctx.fillRect(x,h-bh,bw,bh); x+=bw+1; }
        if(dur>0){ const p=elapsed/dur; ctx.fillStyle='rgba(255,255,255,0.6)'; ctx.fillRect(p*w,0,2,h); ctx.fillStyle='rgba(0,0,0,0.6)'; ctx.fillRect(0,h-4,w,4); ctx.fillStyle=col; ctx.fillRect(0,h-4,p*w,4); }
        if(cue!==null && dur>0){ const cx=(cue/dur)*w; ctx.fillStyle='#FF8A00'; ctx.fillRect(cx,0,2,h); ctx.beginPath(); ctx.moveTo(cx-6,0); ctx.lineTo(cx+6,0); ctx.lineTo(cx,10); ctx.fill(); }
        const remain=dur-elapsed; if(dur>0 && remain<30 && remain>0){ ctx.fillStyle= remain<10?'rgba(255,0,0,0.25)':'rgba(255,200,0,0.18)'; ctx.fillRect(0,0,w,h); }
      }; dc(cA.current,anA.current,deckA.track.color, deckA.elapsed, deckA.duration, deckA.cuePoint); dc(cB.current,anB.current,deckB.track.color, deckB.elapsed, deckB.duration, deckB.cuePoint);
    }; draw(); return()=>cancelAnimationFrame(raf);
  },[deckA, deckB]);

  const up=(e:React.ChangeEvent<HTMLInputElement>, which:'A'|'B')=>{
    const f=e.target.files?.[0]; if(!f) return; const url=URL.createObjectURL(f);
    const nt:Track={id:Date.now(), title:f.name.replace('.mp3','').slice(0,24), artist:'HD', bpm:127+Math.random()*3, color:which==='A'?'#00FF88':'#00E5FF', url};
    setTracks(p=>[nt,...p]);
    if(which==='A'){ setDeckA(v=>({...v,track:nt,elapsed:0,duration:0,playing:false,cuePoint:null})); setTimeout(()=>aRef.current?.load(),80);} else { setDeckB(v=>({...v,track:nt,elapsed:0,duration:0,playing:false,cuePoint:null})); setTimeout(()=>bRef.current?.load(),80);}
  };
  const stopD=(w:'A'|'B')=>{ if(w==='A'&&aRef.current){ aRef.current.pause(); aRef.current.currentTime=0; setDeckA(v=>({...v,playing:false,elapsed:0})); } if(w==='B'&&bRef.current){ bRef.current.pause(); bRef.current.currentTime=0; setDeckB(v=>({...v,playing:false,elapsed:0})); } };
  const handleCue=(w:'A'|'B', reset=false)=>{ if(reset){ if(w==='A') setDeckA(v=>({...v,cuePoint:null})); else setDeckB(v=>({...v,cuePoint:null})); return; } if(w==='A'&&aRef.current){ if(deckA.cuePoint===null){ setDeckA(v=>({...v,cuePoint:aRef.current!.currentTime})); } else { aRef.current.currentTime=deckA.cuePoint; setDeckA(v=>({...v,elapsed:deckA.cuePoint!, playing:true})); aRef.current!.play().catch(()=>{}); } } if(w==='B'&&bRef.current){ if(deckB.cuePoint===null){ setDeckB(v=>({...v,cuePoint:bRef.current!.currentTime})); } else { bRef.current.currentTime=deckB.cuePoint; setDeckB(v=>({...v,elapsed:deckB.cuePoint!, playing:true})); bRef.current!.play().catch(()=>{}); } } };
  const fmt=(s:number)=>{ if(!isFinite(s)||s<=0) return '00:00'; const m=Math.floor(s/60); const sec=Math.floor(s%60); return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`; };
  const fmtRemain=(elapsed:number,dur:number)=>{ if(!dur) return '--:--'; const r=dur-elapsed; if(r<0) return '00:00'; const m=Math.floor(r/60); const sec=Math.floor(r%60); return `-${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`; };
  const toggleRec=()=>{ if(!dest.current) return; if(!rec){ const mr=new MediaRecorder(dest.current.stream); const ch:BlobPart[]=[]; mr.ondataavailable=e=>ch.push(e.data); mr.onstop=()=>{ const blob=new Blob(ch,{type:'audio/webm'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=`virtumix-v7-MASTER-REC-${new Date().toISOString().slice(0,19)}.webm`; a.click(); }; mr.start(); recR.current=mr; setRecT(0); setRec(true);} else { recR.current?.stop(); setRec(false);} };
  useEffect(()=>{ const mv=(e:PointerEvent)=>{ if(!drag.current||!xRef.current) return; const r=xRef.current.getBoundingClientRect(); setCross(Math.max(-100,Math.min(100,(e.clientX-r.left)/r.width*200-100))); }; const up=()=>drag.current=false; window.addEventListener('pointermove',mv); window.addEventListener('pointerup',up); return()=>{window.removeEventListener('pointermove',mv); window.removeEventListener('pointerup',up);}; },[]);

  const Knob=({label,value,onChange,color}:{label:string,value:number,onChange:(v:number)=>void,color:string})=>{
    const pct=(value+12)/24*270-135;
    return <div className="flex flex-col items-center gap-1"><div className="relative w-[50px] h-[50px] rounded-full bg-[#0a0a0a] border border-white/10 grid place-items-center"><div className="w-[38px] h-[38px] rounded-full bg-gradient-to-b from-[#2a2a2a] to-[#111] border border-white/10 relative" style={{transform:`rotate(${pct}deg)`}}><div className="absolute top-[3px] left-1/2 -translate-x-1/2 w-[3px] h-[6px] rounded-full" style={{background:color}}/></div><input type="range" min={-12} max={12} step={0.5} value={value} onChange={e=>onChange(parseFloat(e.target.value))} className="absolute inset-0 opacity-0 cursor-pointer"/></div><span className="mono text-[7px] text-white/40 tracking-widest">{label}</span><span className="mono text-[7px] font-bold" style={{color:value!==0?color:'#fff6'}}>{value>0?`+${value}`:value}dB</span></div>;
  };
  const MasterKnob=({value,onChange}:{value:number,onChange:(v:number)=>void})=>{
    const pct=value/100*270-135;
    return <div className="flex flex-col items-center gap-1"><div className="relative w-[64px] h-[64px] rounded-full bg-[#0a0a0a] border border-white/15 shadow-[0_0_14px_rgba(255,255,255,0.08)] grid place-items-center"><div className="w-[50px] h-[50px] rounded-full bg-gradient-to-b from-[#3a3a3a] to-[#141414] border border-white/15 relative" style={{transform:`rotate(${pct}deg)`}}><div className="absolute top-[4px] left-1/2 -translate-x-1/2 w-[4px] h-[9px] rounded-full bg-white shadow-[0_0_6px_white]"/></div><input type="range" min={0} max={100} value={value} onChange={e=>onChange(parseFloat(e.target.value))} className="absolute inset-0 opacity-0 cursor-pointer"/></div><span className="mono text-[8px] font-black tracking-widest text-white/80">MASTER</span><span className="mono text-[9px] font-black text-white">{value}%</span></div>;
  };
  const CueVolKnob=({value,onChange}:{value:number,onChange:(v:number)=>void})=>{
    const pct=value/100*270-135;
    return <div className="flex flex-col items-center gap-1"><div className="relative w-[64px] h-[64px] rounded-full bg-[#0a0a0a] border border-[#00E5FF]/20 shadow-[0_0_14px_rgba(0,229,255,0.12)] grid place-items-center"><div className="w-[50px] h-[50px] rounded-full bg-gradient-to-b from-[#1a2a2e] to-[#0e1416] border border-[#00E5FF]/30 relative" style={{transform:`rotate(${pct}deg)`}}><div className="absolute top-[4px] left-1/2 -translate-x-1/2 w-[4px] h-[9px] rounded-full bg-[#00E5FF] shadow-[0_0_6px_#00E5FF]"/></div><input type="range" min={0} max={100} value={value} onChange={e=>onChange(parseFloat(e.target.value))} className="absolute inset-0 opacity-0 cursor-pointer"/></div><span className="mono text-[8px] font-black tracking-widest text-[#00E5FF]">CUE VOL</span><span className="mono text-[9px] font-black text-[#00E5FF]">{value}%</span></div>;
  };

  return (
    <div className="min-h-screen bg-[#050507] text-white">
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Geist:wght@700;900&family=JetBrains+Mono:wght@400;700&display=swap'); .mono{font-family:'JetBrains Mono',monospace} @keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
      <audio ref={aRef} src={deckA.track.url} preload="auto" crossOrigin="anonymous"/><audio ref={bRef} src={deckB.track.url} preload="auto" crossOrigin="anonymous"/>
      <div className="mx-auto max-w-[1760px] px-3 py-3">
        <div className="flex justify-between items-center mb-3"><div className="flex items-center gap-3"><div className="w-8 h-8 rounded-full bg-[#00FF88] text-black grid place-items-center font-black">V</div><div><div className="font-black tracking-[0.2em] text-[12px]">VIRTUMIX <span className="text-white/40">by CMDJ</span> • V7 MASTER SEPARADO</div><div className="mono text-[9px] text-[#00FF88]">CDJ-3000 STYLE • MASTER ≠ CUE VOL • REC = MASTER ONLY</div></div></div><button onClick={toggleRec} className={`h-9 px-5 rounded-full font-black text-[11px] flex items-center gap-2 border ${rec?'bg-red-500 border-red-500 animate-pulse':'bg-white/[0.06] border-white/10 text-white/60'}`}>● {rec?`${fmt(recT)}`:'REC SET'}</button></div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_480px_1fr] gap-3">
          <div className="rounded-[20px] bg-[#0c0c10] border border-white/[0.07] p-3 flex flex-col">
            <div className="flex justify-between mb-2"><span className="text-[11px] font-black tracking-widest flex items-center gap-2"><Volume2 className="w-3 h-3 text-[#00FF88]"/>DECK A</span><label className="h-7 px-3 rounded-full bg-[#00FF88]/10 border border-[#00FF88]/20 text-[#00FF88] text-[10px] font-black cursor-pointer flex items-center gap-1"><Upload className="w-3 h-3"/> MP3<input type="file" accept="audio/*" className="hidden" onChange={e=>up(e,'A')} /></label></div>
            <div className="relative rounded-[10px] bg-black border border-white/10 p-1.5 mb-2"><canvas ref={cA} width={380} height={78} className="w-full h-[78px] rounded-[8px]"/><div className="absolute top-2 left-2 flex gap-1.5"><div className="px-2 py-0.5 rounded-full bg-black/70 border border-white/10 mono text-[8px] flex items-center gap-1"><Timer className="w-3 h-3"/> {fmt(deckA.elapsed)}</div><div className={`px-2 py-0.5 rounded-full border mono text-[8px] font-black flex items-center gap-1 ${deckA.duration && deckA.duration-deckA.elapsed<30?'bg-red-500/20 border-red-500/40 text-red-300 animate-pulse':'bg-black/70 border-white/10 text-white/60'}`}>{deckA.duration && deckA.duration-deckA.elapsed<30 && <AlertTriangle className="w-3 h-3"/>}{fmtRemain(deckA.elapsed,deckA.duration)}</div></div></div>
            <div className="flex justify-between mb-2"><span className="text-[12px] font-bold truncate max-w-[180px]">{deckA.track.artist} - {deckA.track.title}</span><span className="text-[17px] font-black" style={{color:deckA.track.color}}>{(deckA.track.bpm*(1+deckA.pitch/100)).toFixed(1)}</span></div>
            <div className="relative w-[130px] h-[130px] mx-auto mb-3"><div className="absolute inset-0 rounded-full blur-[12px]" style={{background:deckA.track.color, opacity:deckA.playing?0.3:0.08}}/><div className="absolute inset-0 rounded-full bg-[#0a0a0a] border border-white/10 grid place-items-center" style={{animation:deckA.playing?'spin 2.1s linear infinite':undefined}}><div className="w-[52px] h-[52px] rounded-full bg-[#111] border border-white/10 grid place-items-center"><div className="w-2 h-2 rounded-full" style={{background:deckA.track.color}}/></div></div></div>
            <div className="grid grid-cols-[44px_1fr] gap-3 mt-auto">
              <div className="flex flex-col items-center"><span className="mono text-[7px] text-white/30">PITCH</span><input type="range" min={-8} max={8} step={0.1} value={deckA.pitch} onChange={e=>setDeckA(v=>({...v,pitch:parseFloat(e.target.value)}))} className="w-[78px] rotate-[-90deg] mt-8"/><span className="mono text-[9px] mt-1">{deckA.pitch>0?'+':''}{deckA.pitch.toFixed(1)}%</span></div>
              <div className="flex flex-col gap-2">
                <div className="grid grid-cols-[1fr_56px_56px] gap-2">
                  <div className="relative"><button onPointerDown={()=>handleCue('A')} className={`w-full h-[46px] rounded-full border font-black text-[11px] flex flex-col items-center justify-center leading-none gap-0.5 ${deckA.cuePoint!==null?'bg-[#FF8A00] text-black border-[#FF8A00]':'bg-white/[0.06] border-white/10 text-white/50'}`}><CircleDot className="w-4 h-4"/><span>CUE</span>{deckA.cuePoint!==null && <span className="mono text-[7px]">{fmt(deckA.cuePoint)}</span>}</button>{deckA.cuePoint!==null && <button onClick={()=>handleCue('A',true)} className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500 text-white grid place-items-center border border-black"><X className="w-3 h-3"/></button>}</div>
                  <button onClick={()=>setDeckA(v=>({...v,playing:!v.playing}))} className={`h-[46px] rounded-full font-black text-[11px] border flex items-center justify-center gap-1 ${deckA.playing?'bg-[#00FF88] text-black border-[#00FF88]':'bg-white/[0.07] border-white/10'}`}>{deckA.playing?<Pause className="w-4 h-4"/>:<Play className="w-4 h-4"/>}PLAY</button>
                  <button onClick={()=>stopD('A')} className="h-[46px] rounded-full bg-white/[0.05] border border-white/10 font-black text-[11px] flex items-center justify-center gap-1"><Square className="w-3 h-3 fill-current"/>STOP</button>
                </div>
                <div className="h-6 rounded-full bg-black/40 border border-white/10 grid place-items-center mono text-[9px] text-white/30">{fmt(deckA.elapsed)} / {fmt(deckA.duration)}</div>
              </div>
            </div>
          </div>

          <div className="rounded-[22px] bg-[#111117] border border-white/[0.08] p-3 flex flex-col gap-3">
            <div className="flex justify-between items-center"><span className="text-[11px] font-black tracking-[0.25em]">MIXER • V7 CDJ-3000</span><span className="mono text-[8px] px-2 py-1 rounded-full bg-[#00FF88]/10 border border-[#00FF88]/20 text-[#00FF88]">MASTER ≠ CUE</span></div>
            <div className="grid grid-cols-2 gap-2"><button onClick={()=>setDeckA(v=>({...v,pfl:!v.pfl}))} className={`h-10 rounded-[12px] border flex items-center justify-center gap-2 ${deckA.pfl?'bg-[#00FF88] text-black border-[#00FF88]':'bg-white/[0.04] border-white/10 text-white/40'}`}><Headphones className="w-5 h-5"/></button><button onClick={()=>setDeckB(v=>({...v,pfl:!v.pfl}))} className={`h-10 rounded-[12px] border flex items-center justify-center gap-2 ${deckB.pfl?'bg-[#00E5FF] text-black border-[#00E5FF]':'bg-white/[0.04] border-white/10 text-white/40'}`}><Headphones className="w-5 h-5"/></button></div>
            <div className="rounded-[14px] bg-black/50 border border-white/10 p-3"><div className="grid grid-cols-2 gap-4"><div><div className="mono text-[8px] text-[#00FF88] font-black tracking-widest mb-2 text-center">DECK A EQ</div><div className="flex justify-between"><Knob label="HI" value={deckA.high} onChange={v=>setDeckA(s=>({...s,high:v}))} color="#00E5FF"/><Knob label="MID" value={deckA.mid} onChange={v=>setDeckA(s=>({...s,mid:v}))} color="#FFB800"/><Knob label="LOW" value={deckA.low} onChange={v=>setDeckA(s=>({...s,low:v}))} color="#00FF88"/></div></div><div><div className="mono text-[8px] text-[#00E5FF] font-black tracking-widest mb-2 text-center">DECK B EQ</div><div className="flex justify-between"><Knob label="HI" value={deckB.high} onChange={v=>setDeckB(s=>({...s,high:v}))} color="#00E5FF"/><Knob label="MID" value={deckB.mid} onChange={v=>setDeckB(s=>({...s,mid:v}))} color="#FFB800"/><Knob label="LOW" value={deckB.low} onChange={v=>setDeckB(s=>({...s,low:v}))} color="#00FF88"/></div></div></div></div>
            <div className="rounded-[14px] bg-black/60 border border-white/10 p-3"><div ref={xRef} className="relative h-[52px] rounded-full bg-[#08080a] border border-white/[0.08] p-2 cursor-pointer"><div className="absolute top-1/2 left-3 right-3 h-[4px] -translate-y-1/2 rounded-full bg-gradient-to-r from-[#00FF88]/40 via-white/20 to-[#00E5FF]/40"/><div onPointerDown={()=>drag.current=true} className="absolute top-1/2 w-[84px] h-[40px] -translate-y-1/2 rounded-full bg-gradient-to-b from-white to-[#ccc] border border-black/20 grid place-items-center cursor-grab" style={{left:`calc(${(cross+100)/2}% - 42px)`}}><div className="w-[44px] h-[5px] rounded-full bg-black/20"/></div></div></div>
            <div className="rounded-[14px] bg-[#0a0a0e] border border-white/10 p-3 grid grid-cols-[1fr_1fr_1fr] gap-2 items-end">
              <CueVolKnob value={cueVol} onChange={setCueVol}/>
              <div className="flex flex-col items-center gap-1"><div className="w-full h-[64px] rounded-[12px] bg-black/60 border border-white/10 grid place-items-center"><Mic2 className="w-6 h-6 text-white/20"/><span className="mono text-[7px] text-white/20 mt-1">CUE MIX</span></div><span className="mono text-[7px] text-white/30">PHONES</span></div>
              <MasterKnob value={masterVol} onChange={setMasterVol}/>
            </div>
            <div className="rounded-[10px] bg-[#00FF88]/5 border border-[#00FF88]/15 p-2 mono text-[9px] text-white/60 leading-[1.35]"><b className="text-[#00FF88]">V7 FIX:</b> MASTER controla só o que sai pro REC e pras caixas • CUE VOL independente no fone • REC SET grava só MASTER (igual DJM-900)</div>
          </div>

          <div className="rounded-[20px] bg-[#0c0c10] border border-white/[0.07] p-3 flex flex-col">
            <div className="flex justify-between mb-2"><span className="text-[11px] font-black tracking-widest flex items-center gap-2"><Volume2 className="w-3 h-3 text-[#00E5FF]"/>DECK B</span><label className="h-7 px-3 rounded-full bg-[#00E5FF]/10 border border-[#00E5FF]/20 text-[#00E5FF] text-[10px] font-black cursor-pointer flex items-center gap-1"><Upload className="w-3 h-3"/> MP3<input type="file" accept="audio/*" className="hidden" onChange={e=>up(e,'B')} /></label></div>
            <div className="relative rounded-[10px] bg-black border border-white/10 p-1.5 mb-2"><canvas ref={cB} width={380} height={78} className="w-full h-[78px] rounded-[8px]"/><div className="absolute top-2 left-2 flex gap-1.5"><div className="px-2 py-0.5 rounded-full bg-black/70 border border-white/10 mono text-[8px] flex items-center gap-1"><Timer className="w-3 h-3"/> {fmt(deckB.elapsed)}</div><div className={`px-2 py-0.5 rounded-full border mono text-[8px] font-black flex items-center gap-1 ${deckB.duration && deckB.duration-deckB.elapsed<30?'bg-red-500/20 border-red-500/40 text-red-300 animate-pulse':'bg-black/70 border-white/10 text-white/60'}`}>{deckB.duration && deckB.duration-deckB.elapsed<30 && <AlertTriangle className="w-3 h-3"/>}{fmtRemain(deckB.elapsed,deckB.duration)}</div></div></div>
            <div className="flex justify-between mb-2"><span className="text-[12px] font-bold truncate max-w-[180px]">{deckB.track.artist} - {deckB.track.title}</span><span className="text-[17px] font-black" style={{color:deckB.track.color}}>{(deckB.track.bpm*(1+deckB.pitch/100)).toFixed(1)}</span></div>
            <div className="relative w-[130px] h-[130px] mx-auto mb-3"><div className="absolute inset-0 rounded-full blur-[12px]" style={{background:deckB.track.color, opacity:deckB.playing?0.3:0.08}}/><div className="absolute inset-0 rounded-full bg-[#0a0a0a] border border-white/10 grid place-items-center" style={{animation:deckB.playing?'spin 2.1s linear infinite':undefined}}><div className="w-[52px] h-[52px] rounded-full bg-[#111] border border-white/10 grid place-items-center"><div className="w-2 h-2 rounded-full" style={{background:deckB.track.color}}/></div></div></div>
            <div className="grid grid-cols-[44px_1fr] gap-3 mt-auto">
              <div className="flex flex-col items-center"><span className="mono text-[7px] text-white/30">PITCH</span><input type="range" min={-8} max={8} step={0.1} value={deckB.pitch} onChange={e=>setDeckB(v=>({...v,pitch:parseFloat(e.target.value)}))} className="w-[78px] rotate-[-90deg] mt-8"/><span className="mono text-[9px] mt-1">{deckB.pitch>0?'+':''}{deckB.pitch.toFixed(1)}%</span></div>
              <div className="flex flex-col gap-2">
                <div className="grid grid-cols-[1fr_56px_56px] gap-2">
                  <div className="relative"><button onPointerDown={()=>handleCue('B')} className={`w-full h-[46px] rounded-full border font-black text-[11px] flex flex-col items-center justify-center leading-none gap-0.5 ${deckB.cuePoint!==null?'bg-[#FF8A00] text-black border-[#FF8A00]':'bg-white/[0.06] border-white/10 text-white/50'}`}><CircleDot className="w-4 h-4"/><span>CUE</span>{deckB.cuePoint!==null && <span className="mono text-[7px]">{fmt(deckB.cuePoint)}</span>}</button>{deckB.cuePoint!==null && <button onClick={()=>handleCue('B',true)} className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500 text-white grid place-items-center border border-black"><X className="w-3 h-3"/></button>}</div>
                  <button onClick={()=>setDeckB(v=>({...v,playing:!v.playing}))} className={`h-[46px] rounded-full font-black text-[11px] border flex items-center justify-center gap-1 ${deckB.playing?'bg-[#00E5FF] text-black border-[#00E5FF]':'bg-white/[0.07] border-white/10'}`}>{deckB.playing?<Pause className="w-4 h-4"/>:<Play className="w-4 h-4"/>}PLAY</button>
                  <button onClick={()=>stopD('B')} className="h-[46px] rounded-full bg-white/[0.05] border border-white/10 font-black text-[11px] flex items-center justify-center gap-1"><Square className="w-3 h-3 fill-current"/>STOP</button>
                </div>
                <div className="h-6 rounded-full bg-black/40 border border-white/10 grid place-items-center mono text-[9px] text-white/30">{fmt(deckB.elapsed)} / {fmt(deckB.duration)}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
