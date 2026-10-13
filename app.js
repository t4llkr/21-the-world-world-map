'use strict';
/* ================================================================
   dream map — исследователь связей локаций нелинейного сновидения
   Парсер чистый (без DOM): текст карты -> граф {nodes, edgeList, adj, radj}
   ================================================================ */

const NAME_RE = /^[A-Za-z][A-Za-z0-9_'().\-]*$/;
const BAD_TOKENS = new Set(['freedom','san','level','yes','no','and','the','or','hello','abyss','surface','lucid','gestalt']);
const PARAMS = ['abyss','surface','lucid','gestalt','SAN'];
const PARAM_COLORS = {abyss:'#a06ee0',surface:'#58b368',lucid:'#4a90d9',gestalt:'#d9a441',SAN:'#d9584f'};
const VERSION_COLORS = {v1:'#3d5a80',v2:'#7a5195',v3:'#bc5090',v4:'#ef5675','':'#4a4f5a'};

function stripAnnot(s){
  return s.replace(/\[[^\]]*\]/g,'')
          .replace(/\(\s*v\d+\s*\)/gi,'')
          .replace(/\((?![A-Za-z]+\))[^)]*\)/g,'')
          .replace(/\s+\(/g,'(')
          .trim();
}

/* Извлечь имя целевой локации из "сырого" текста справа от дефиса.
   Возвращает string, массив string (развилка через /) или null. */
function extractTarget(raw){
  const s = stripAnnot(raw);
  const slash = s.split('/').map(p=>p.trim()).filter(p=>NAME_RE.test(p));
  if (slash.length > 1) return slash;
  const parts = s.split(',').map(p=>p.trim());
  for (let i=parts.length-1;i>=0;i--) if (NAME_RE.test(parts[i])) return parts[i];
  const toks = (s.match(/[A-Za-z][A-Za-z0-9_'().\-]*/g)||[])
    .filter(t => !BAD_TOKENS.has(t.toLowerCase()) && !/^v\d+$/i.test(t))
    .filter(t => (t.match(/\(/g)||[]).length === (t.match(/\)/g)||[]).length);
  if (toks.length === 1) return toks[0];
  return null;
}

/* "abyss +1 gestalt +2 SAN +1" -> {abyss:1, gestalt:2, SAN:1} */
function extractEffects(s){
  const eff = {};
  if (!s) return eff;
  const re = /(abyss|surface|lucid|gestalt|SAN)\s*([+-]?\d+)/g;
  let m; while ((m = re.exec(s))) eff[m[1]] = (eff[m[1]]||0) + (+m[2]);
  return eff;
}

/* Условия в тексте триггера: "abyss > 4", "abyss 7-15", "lucid<=10" */
function extractConds(trigger){
  const conds = []; let m;
  let re = /(abyss|surface|lucid|gestalt)\s*(>=|<=|>|<)\s*(\d+)/g;
  while ((m = re.exec(trigger))) conds.push({p:m[1], op:m[2], v:+m[3]});
  re = /(abyss|surface|lucid|gestalt)\s+(\d+)\s*-\s*(\d+)/g;
  while ((m = re.exec(trigger))) conds.push({p:m[1], min:+m[2], max:+m[3]});
  return conds;
}

function parseMap(text){
  const nodes = new Map(), edgeMap = new Map(), skipped = [];
  let cur = null, sub = '', section = 'v1', stop = false;

  const ALIASES = {"s'eeser":"s'eseer"};
  const ensure = (name, desc, ver) => {
    let clean = stripAnnot(name).replace(/\s+\(/,'(');
    clean = ALIASES[clean.toLowerCase()] || clean;
    const id = clean.toLowerCase();
    let n = nodes.get(id);
    if (!n){ n = {id, name:clean, desc:'', version:'', x:0, y:0, vx:0, vy:0, imgState:0, imgEl:null, imgSrc:''}; nodes.set(id, n); }
    if (desc) n.desc = desc;
    if (ver) n.version = ver;
    return n;
  };
  const addEdge = (fromId, toName, label, effects, conds) => {
    const to = ensure(toName, '', section);
    const key = fromId + '>' + to.id;
    let e = edgeMap.get(key);
    if (!e){ e = {from:fromId, to:to.id, triggers:[]}; edgeMap.set(key, e); }
    e.triggers.push({label, effects, conds});
  };

  for (const rawLine of text.split(/\r?\n/)){
    if (stop) break;
    const line = rawLine.replace(/\s+$/,'');
    const t = line.trim();
    if (!t) continue;
    if (t.startsWith('***')){ stop = true; continue; }      // мета-инфа после *** не парсится

    let m;
    if ((m = t.match(/^(v\d+)\s*:$/i))){ section = m[1].toLowerCase(); continue; }

    // заголовок локации: "name [описание]:"
    if ((m = t.match(/^([A-Za-z][A-Za-z0-9_'().\-]*(?:\s*\([A-Za-z]+\))?)\s*(?:\[([^\]]*)\])?\s*:$/))){
      if (/^level$/i.test(m[1])){ cur = null; continue; }   // служебная строка из шапки файла
      const _hn = m[1].replace(/\s+\(/,'(').toLowerCase();
      if (['abyss','surface','lucid','gestalt'].includes(_hn)){ sub = m[1]; continue; } // условный подблок
      const node = ensure(m[1], m[2]||'', section);
      cur = node; sub = '';
      continue;
    }
    // цепочка: "baby [детей] -> baby2 [детей 2] -> room    abyss +1 SAN +1"
    if ((m = t.match(/^([A-Za-z][A-Za-z0-9_'().\-]*)\s*(?:\[[^\]]*\])?\s*->\s*(.+)$/)) && !t.includes(' - ')){
      const chain = [m[1]];
      let eff = {};
      const parts = m[2].split('->');
      parts.forEach((p,i) => {
        const pm = p.match(/^(.*?)(?:\s{2,}(.*))?$/);
        if (i === parts.length-1) eff = extractEffects(pm[2]||'');
        chain.push(stripAnnot(pm[1]));
      });
      for (let i=0;i+1<chain.length;i++)
        if (NAME_RE.test(chain[i+1])) addEdge(chain[i].toLowerCase(), chain[i+1], '→', eff, []);
      continue;
    }
    // дверь без названия триггера: "room  -", "Droom (v2)  -"
    if (cur && (m = line.match(/^\s*([A-Za-z][A-Za-z0-9_'().\-]*(?:\s*\([A-Za-z0-9]+\))?)\s+-\s*$/))){
      addEdge(cur.id, m[1], 'дверь', {}, []);
      continue;
    }
    // переход: "триггер - цель    abyss +1 gestalt +2"
    if (cur && (m = line.match(/^\s*(.+?)\s+-\s+(.+?)(?:\s{2,}(.+))?$/))){
      let label = m[1].trim();
      if (sub) label = sub + ' › ' + label;
      if (/\[\?+\]/.test(m[2])){ skipped.push(t); continue; }  // сомнительная связь [?] — в карту не идёт
      const effects = extractEffects(m[3]||'');
      const conds   = extractConds(m[1]);
      const tgt = extractTarget(m[2]);
      if (!tgt){ skipped.push(t); continue; }
      for (const tn of (Array.isArray(tgt) ? tgt : [tgt])) addEdge(cur.id, tn, label, effects, conds);
      continue;
    }
    // подзаголовок зоны ("левое крыло:", "спавн с шляпником:") — префикс для триггеров
    if (cur && !t.includes(' - ') && t.endsWith(':') && !/^[A-Za-z]/.test(t)){ sub = t.replace(/:$/,''); continue; }
    sub = '';
  }

  const edgeList = [...edgeMap.values()];
  const adj = new Map(), radj = new Map();
  for (const e of edgeList){
    if (!adj.has(e.from)) adj.set(e.from, []);
    adj.get(e.from).push(e);
    if (!radj.has(e.to)) radj.set(e.to, []);
    radj.get(e.to).push(e);
  }
  return {nodes, edgeList, adj, radj, skipped, nodeArr:[...nodes.values()]};
}

/* ==================== UI (DOM) ==================== */

function init(){
  const $ = id => document.getElementById(id);
  const canvas = $('canvas'), ctx = canvas.getContext('2d');
  const side = $('side');
  let DPR=1, CW=0, CH=0;
  function resize(){
    DPR = Math.min(window.devicePixelRatio||1, 2);
    CW = canvas.clientWidth; CH = canvas.clientHeight;
    canvas.width = CW*DPR; canvas.height = CH*DPR;
  }
  window.addEventListener('resize', resize); resize();

  const view = {x:0, y:0, scale:1};          // 2D: центр в мировых координатах; 3D: смещение в px
  let G = null;
  let selected=null, hoverNode=null, hoverEdge=null, hoverLink=null, openEdge=null;
  let dragNode=null, pan=null, rotating=null, dollying=null, moved=false;
  let pathEdges=new Set(), pathNodes=new Set(), pathSteps=null;
  let walk=null;
  const mouse={x:0,y:0};
  // раскладки / сортировка / 3D
  let layout='cone', sort='default', mode3d=false;
  const rot={x:0.5, y:0.6};                  // углы орбитальной камеры
  let camDist=1200;                        // дистанция камеры (ПКМ — долли)
  let dirty=true, physAsleep=false, stillFrames=0; // рендер по требованию / сон физики
  function wake(){ dirty=true; physAsleep=false; stillFrames=0; }
  let lastP=null;                          // кэш проекций последнего кадра (для пикинга)
  let maxDepth=0, rootId='room';
  const toWorld=(sx,sy)=>[(sx-CW/2+view.x)/view.scale,(sy-CH/2+view.y)/view.scale];

  /* ---------- скриншоты нод: screenshots/<id>.png|jpg|jpeg|webp ---------- */
  const IMG_EXTS=['png','jpg','jpeg','webp'];
  function tryLoadImg(node){
    if (node.imgState) return;
    node.imgState = 1;
    let i = 0;
    const next = () => {
      if (i >= IMG_EXTS.length){ node.imgState = 3; return; }
      const im = new Image();
      im.onload  = () => { node.imgState=2; node.imgEl=im; node.imgSrc='screenshots/'+encodeURIComponent(node.id)+'.'+IMG_EXTS[i]; wake(); };
      im.onerror = () => { i++; next(); };
      im.src = 'screenshots/'+encodeURIComponent(node.id)+'.'+IMG_EXTS[i];
    };
    next();
  }

  /* ---------- физика (только раскладка force) ---------- */
  function physics(){
    if (!G) return;
    const ns = G.nodeArr;
    for (let i=0;i<ns.length;i++){ const A=ns[i];
      for (let j=i+1;j<ns.length;j++){ const B=ns[j];
        let dx=B.x-A.x, dy=B.y-A.y;
        let d2=dx*dx+dy*dy; if (d2<1) d2=1;
        if (d2>200000) continue;
        const d=Math.sqrt(d2), f=Math.min(3200/d2, 4);
        dx/=d; dy/=d;
        A.vx-=dx*f; A.vy-=dy*f; B.vx+=dx*f; B.vy+=dy*f;
      }
    }
    for (const e of G.edgeList){
      const A=G.nodes.get(e.from), B=G.nodes.get(e.to);
      let dx=B.x-A.x, dy=B.y-A.y;
      const d=Math.sqrt(dx*dx+dy*dy)||1, f=(d-95)*0.03;
      dx/=d; dy/=d;
      A.vx+=dx*f; A.vy+=dy*f; B.vx-=dx*f; B.vy-=dy*f;
    }
    for (const N of ns){
      N.vx -= N.x*0.002; N.vy -= N.y*0.002;
      N.vx *= 0.82; N.vy *= 0.82;
      if (N!==dragNode){ N.x+=N.vx; N.y+=N.vy; }
    }
  }

  /* ---------- 3D-проекция ---------- */
  // мировые координаты ноды для 3D-объёма раскладки
  function world3d(n){
    const d = n.depth>=0 ? n.depth : maxDepth+2;
    let X,Y,Z;
    if (layout==='radial'){ X=n.x; Y=-d*105; Z=n.y; }             // радиальный конус
    else if (layout==='cone'){ X=n.rx||0; Y=-d*105; Z=n.rz||0; } // конусное дерево
    else { X=n.x; Y=n.y; Z=(n.depth>=0 ? n.depth*60 : -220); }    // force: слои по глубине
    return [X,Y,Z];
  }
  function proj(n){
    if (!mode3d)
      return {x:n.x*view.scale+CW/2-view.x, y:n.y*view.scale+CH/2-view.y, s:1};
    const [X,Y,Z]=world3d(n);
    const cy=Math.cos(rot.y), sy=Math.sin(rot.y);
    const cx=Math.cos(rot.x), sx=Math.sin(rot.x);
    const x1=X*cy - Z*sy;
    const z1=X*sy + Z*cy;
    const y1=Y*cx - z1*sx;
    const z2=Y*sx + z1*cx;
    // перспектива с клампом: ноды у камеры не улетали в бесконечность
    const f=Math.max(0.05, Math.min(camDist/(camDist+z2), 3.5));
    return {x:CW/2+view.x+x1*f*view.scale, y:CH/2+view.y+y1*f*view.scale, s:f};
  }

  function fit(){
    if (!G || !G.nodeArr.length) return;
    // фит по основной массе дерева: ноды-одиночки вне достижимости от корня
    // (слабая связь / авто-переходы) смещают картинку и при фите игнорируются
    const mass=G.nodeArr.filter(n=>n.depth>=0);
    const list=mass.length?mass:G.nodeArr;
    let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;
    for (const n of list){
      const X=mode3d?world3d(n)[0]:n.x, Y=mode3d?world3d(n)[1]:n.y;
      x0=Math.min(x0,X); y0=Math.min(y0,Y); x1=Math.max(x1,X); y1=Math.max(y1,Y);
    }
    const bw=(x1-x0)||1, bh=(y1-y0)||1;
    view.scale = Math.max(0.08, Math.min((CW-60)/bw, (CH-60)/bh, 2.5));
    // пан такой, чтобы центр bbox оказался в центре канваса
    if (mode3d){ view.x=-((x0+x1)/2)*view.scale; view.y=-((y0+y1)/2)*view.scale; }
    else       { view.x=((x0+x1)/2)*view.scale;  view.y=((y0+y1)/2)*view.scale; }
    wake();
  }
  function centerOn(id){
    const n=G.nodes.get(id); if (!n) return;
    const p=proj(n);
    if (mode3d){ view.x -= p.x-CW/2; view.y -= p.y-CH/2; } // 3D: пан прибавляется к экрану
    else       { view.x += p.x-CW/2; view.y += p.y-CH/2; }
    wake();
  }

  /* ---------- раскладки: глубины от корня + сортировки ---------- */
  const degN = id => ((G.adj.get(id)||[]).length + (G.radj.get(id)||[]).length);
  const effN = id => (G.adj.get(id)||[]).reduce((s,e)=>s+e.triggers.reduce((t,tr)=>
    t+Object.values(tr.effects).reduce((a,b)=>a+Math.abs(b),0),0),0);

  function makeComparator(orderIdx){
    switch(sort){
      case 'name':    return (a,b)=>a.name.localeCompare(b.name);
      case 'version': return (a,b)=>((a.version||'v9').localeCompare(b.version||'v9'))||a.name.localeCompare(b.name);
      case 'degree':  return (a,b)=>(degN(b.id)-degN(a.id))||a.name.localeCompare(b.name);
      case 'effects': return (a,b)=>(effN(b.id)-effN(a.id))||a.name.localeCompare(b.name);
      default:        return (a,b)=>orderIdx.get(a.id)-orderIdx.get(b.id); // порядок файла
    }
  }

  function computeLayout(){
    const orderIdx=new Map(); G.nodeArr.forEach((n,i)=>orderIdx.set(n.id,i));
    const cmp=makeComparator(orderIdx);
    // корень: room; если в будущей версии карты его нет — самая связная нода
    rootId = G.nodes.has('room') ? 'room'
      : G.nodeArr.slice().sort((a,b)=>degN(b.id)-degN(a.id))[0].id;
    for (const n of G.nodeArr){ n.depth=-1; n.kids=[]; }
    maxDepth=0;
    const q=[rootId]; G.nodes.get(rootId).depth=0;
    while (q.length){
      const u=q.shift(), nu=G.nodes.get(u);
      for (const e of (G.adj.get(u)||[])){
        const v=G.nodes.get(e.to);
        if (v.depth<0){ v.depth=nu.depth+1; v.parent=u; nu.kids.push(v.id);
          maxDepth=Math.max(maxDepth,v.depth); q.push(e.to); }
      }
    }
    // сортировка соседей (поддеревьев) выбранным способом
    (function sortRec(id){ const n=G.nodes.get(id);
      n.kids.sort((a,b)=>cmp(G.nodes.get(a),G.nodes.get(b)));
      n.kids.forEach(sortRec); })(rootId);
    // углы по ярусам для радиальной раскладки
    const byLayer=new Map();
    for (const n of G.nodeArr) if (n.depth>=0){
      if (!byLayer.has(n.depth)) byLayer.set(n.depth,[]);
      byLayer.get(n.depth).push(n);
    }
    for (const arr of byLayer.values()){
      arr.sort(cmp);
      arr.forEach((n,i)=>{ n.ang=-Math.PI/2 + (i/arr.length)*Math.PI*2; });
    }
    return cmp;
  }

  function applyLayout(){
    if (!G) return;
    const cmp=computeLayout();
    const iso=G.nodeArr.filter(n=>n.depth<0);
    if (layout==='force'){
      for (const n of G.nodeArr){ n.vx=n.vy=0; }
      fit(); return;
    }
    if (layout==='cone'){
      // конусное 3D-дерево: дети ноды — на кольце под ней;
      // сектор кольца пропорционален размеру поддерева -> объём по трём осям
      const size=new Map(), ringR=new Map(), rad=new Map();
      const sz=id=>{ if(size.has(id))return size.get(id);
        const n=G.nodes.get(id); let v=1; for(const k of n.kids)v+=sz(k);
        size.set(id,v); return v; };
      const calc=id=>{ const n=G.nodes.get(id);
        if(!n.kids.length){ rad.set(id,14); ringR.set(id,0); return 14; }
        let sum=0; for(const k of n.kids) sum+=calc(k);
        const R=Math.max(26, 0.42*sum); ringR.set(id,R);
        const r=R+Math.max(...n.kids.map(k=>rad.get(k)));
        rad.set(id,r); return r; };
      const root=G.nodes.get(rootId);
      if (root){
        sz(rootId); calc(rootId);
        root.rx=0; root.rz=0; root.baseAng=-Math.PI/2;
        (function place(id){
          const n=G.nodes.get(id);
          if(!n.kids.length) return;
          const total=n.kids.reduce((v,k)=>v+size.get(k),0);
          const R=ringR.get(id);
          let a=n.baseAng!==undefined ? n.baseAng : -Math.PI/2;
          for(const k of n.kids){
            const kn=G.nodes.get(k);
            const sector=Math.PI*2*size.get(k)/total;
            const ang=a+sector/2;
            kn.rx=n.rx+Math.cos(ang)*R;
            kn.rz=n.rz+Math.sin(ang)*R;
            kn.baseAng=ang;
            a+=sector;
            place(k);
          }})(rootId);
        for(const n of G.nodeArr) if(n.depth>=0){ n.x=n.rx; n.y=-n.depth*130; }
      }
      const ri=(maxDepth+2)*160+80;
      iso.forEach((n,i)=>{ const a=i/iso.length*Math.PI*2;
        n.rx=Math.cos(a)*ri; n.rz=Math.sin(a)*ri; n.x=n.rx; n.y=-(maxDepth+2)*130; });
      fit(); return;
    }
    if (layout==='radial'){
      for (const n of G.nodeArr) if (n.depth>=0){
        const r=n.depth*135+140;
        n.x=Math.cos(n.ang)*r; n.y=Math.sin(n.ang)*r;
      }
      const ri=(maxDepth+2)*135+140;
      iso.forEach((n,i)=>{ const a=i/iso.length*Math.PI*2;
        n.x=Math.cos(a)*ri; n.y=Math.sin(a)*ri; });
    }
    fit();
  }

  /* ---------- построение графа ---------- */
  function build(text){
    G = parseMap(text);
    $('graphStats').textContent = 'локаций: '+G.nodes.size+' · переходов: '+G.edgeList.length +
      (G.skipped.length ? ' · строк без цели: '+G.skipped.length : '');
    const n = G.nodeArr.length; let k=0;
    for (const node of G.nodeArr){
      const a = Math.PI*2*k/n;
      node.x = Math.cos(a)*n*7; node.y = Math.sin(a)*n*7;
      node.vx = node.vy = 0; node.depth=-1;
      node.imgState=0; node.imgEl=null; node.imgSrc='';
      tryLoadImg(node); k++;
    }
    selected=null; hoverNode=null; hoverEdge=null;
    pathEdges=new Set(); pathNodes=new Set(); pathSteps=null; walk=null;
    if (layout==='force'){ for (let s=0;s<450;s++) physics(); fit(); }
    else applyLayout();
    renderSide(); wake();   // fillSelects вызывается внутри renderSide, после создания селектов
  }

  function fillSelects(){
    const opts = G.nodeArr.slice().sort((a,b)=>a.name.localeCompare(b.name))
      .map(n=>'<option value="'+n.id+'">'+n.name+'</option>').join('');
    $('pathFrom').innerHTML = opts;
    $('pathTo').innerHTML = opts;
    $('pathFrom').value = G.nodes.has(rootId) ? rootId : G.nodeArr[0].id;
  }

  /* ---------- пикинг (по экранным координатам) ---------- */
  function pickNode(sx,sy){
    if (!G) return null;
    let best=null, bd=1e9;
    for (const n of G.nodeArr){
      const p=(lastP&&lastP.get(n.id))||proj(n);
      const d=Math.hypot(p.x-sx,p.y-sy), r=Math.max(9,15*p.s);
      if (d<r && d<bd){ bd=d; best=n; }
    }
    return best;
  }
  function pickEdge(sx,sy){
    if (!G) return null;
    let best=null, bd=6;
    for (const e of G.edgeList){
      const pa=(lastP&&lastP.get(e.from))||proj(G.nodes.get(e.from)),
            pb=(lastP&&lastP.get(e.to))||proj(G.nodes.get(e.to));
      const dx=pb.x-pa.x, dy=pb.y-pa.y, l2=dx*dx+dy*dy||1;
      let t=((sx-pa.x)*dx+(sy-pa.y)*dy)/l2; t=Math.max(0,Math.min(1,t));
      const d=Math.hypot(sx-(pa.x+dx*t), sy-(pa.y+dy*t));
      if (d<bd){ bd=d; best=e; }
    }
    return best;
  }

  /* ---------- отрисовка ---------- */
  function draw(){
    ctx.setTransform(DPR,0,0,DPR,0,0);
    ctx.clearRect(0,0,CW,CH);
    if (!G) return;

    // кэш проекций на кадр
    lastP=new Map();
    for (const n of G.nodeArr) lastP.set(n.id, proj(n));
    const isSpec=e=>pathEdges.has(e)||(walk&&(walk.done.has(e.from+'>'+e.to)||walk.current===e.from))||hoverEdge===e||(hoverLink&&e.from===hoverLink.f&&e.to===hoverLink.t)||openEdge===e;

    // рёбра: основная масса — одним path, стрелки — одной заливкой; выделенные — поштучно
    ctx.strokeStyle='rgba(255,255,255,0.13)';
    ctx.lineWidth=1;
    if (mode3d) ctx.globalAlpha=0.75;
    ctx.beginPath();
    for (const e of G.edgeList){
      if (isSpec(e)) continue;
      const pa=lastP.get(e.from), pb=lastP.get(e.to);
      ctx.moveTo(pa.x,pa.y); ctx.lineTo(pb.x,pb.y);
    }
    ctx.stroke();
    ctx.fillStyle='rgba(255,255,255,0.25)';
    ctx.beginPath();
    for (const e of G.edgeList){
      if (isSpec(e)) continue;
      const pa=lastP.get(e.from), pb=lastP.get(e.to);
      const dx=pb.x-pa.x, dy=pb.y-pa.y, d=Math.hypot(dx,dy);
      if (d<=22) continue;
      const px=pa.x+dx*0.8, py=pa.y+dy*0.8, ux=dx/d, uy=dy/d, sz=6;
      ctx.moveTo(px+ux*sz, py+uy*sz);
      ctx.lineTo(px-uy*sz*0.45, py+ux*sz*0.45);
      ctx.lineTo(px+uy*sz*0.45, py-ux*sz*0.45);
      ctx.closePath();
    }
    ctx.fill();
    ctx.globalAlpha=1;
    for (const e of G.edgeList){
      if (!isSpec(e)) continue;
      const pa=lastP.get(e.from), pb=lastP.get(e.to);
      const inPath=pathEdges.has(e), walked=walk&&walk.done.has(e.from+'>'+e.to),
            avail=walk&&walk.current===e.from;
      const linkH=hoverLink&&e.from===hoverLink.f&&e.to===hoverLink.t;
      const openH=openEdge===e;
      const avg=(pa.s+pb.s)/2;
      ctx.beginPath(); ctx.moveTo(pa.x,pa.y); ctx.lineTo(pb.x,pb.y);
      ctx.strokeStyle = openH ? '#c792ea' : linkH ? '#7ec8e3' : inPath ? '#ffb347' : walked ? '#58b368' : avail ? '#4a90d9' : 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 2.2*avg;
      ctx.stroke();
      const dx=pb.x-pa.x, dy=pb.y-pa.y, d=Math.hypot(dx,dy);
      if (d>22){
        const px=pa.x+dx*0.8, py=pa.y+dy*0.8, ux=dx/(d||1), uy=dy/(d||1), sz=6*avg;
        ctx.beginPath();
        ctx.moveTo(px+ux*sz, py+uy*sz);
        ctx.lineTo(px-uy*sz*0.45, py+ux*sz*0.45);
        ctx.lineTo(px+uy*sz*0.45, py-ux*sz*0.45);
        ctx.closePath();
        ctx.fillStyle = openH ? '#c792ea' : linkH ? '#7ec8e3' : inPath ? '#ffb347' : walked ? '#58b368' : avail ? '#4a90d9' : 'rgba(255,255,255,0.55)';
        ctx.fill();
      }
    }

    // ноды: заливка батчами по цвету версии, затем картинки и кольца
    for (const ver of Object.keys(VERSION_COLORS)){
      ctx.beginPath();
      for (const n of G.nodeArr){
        if ((n.version||'')!==ver) continue;
        const p=lastP.get(n.id), r=Math.max(2.5,13*p.s);
        if (p.x<-70||p.x>CW+70||p.y<-70||p.y>CH+70) continue;
        ctx.moveTo(p.x+r,p.y); ctx.arc(p.x,p.y,r,0,7);
      }
      ctx.fillStyle=VERSION_COLORS[ver];
      if (mode3d) ctx.globalAlpha=0.9;
      ctx.fill();
      ctx.globalAlpha=1;
    }
    for (const n of G.nodeArr){
      const p=lastP.get(n.id);
      if (p.x<-70||p.x>CW+70||p.y<-70||p.y>CH+70) continue;
      const r=Math.max(2.5, 13*p.s);
      const isSel=n.id===selected, isCur=walk&&walk.current===n.id, isHov=n===hoverNode;
      if (n.imgState===2 && n.imgEl && r>5){
        ctx.save(); ctx.beginPath(); ctx.arc(p.x,p.y,r,0,7); ctx.clip();
        const im=n.imgEl, sc=(2*r)/Math.min(im.width,im.height);
        ctx.drawImage(im, p.x-im.width*sc/2, p.y-im.height*sc/2, im.width*sc, im.height*sc);
        ctx.restore();
        ctx.beginPath(); ctx.arc(p.x,p.y,r,0,7);
        ctx.strokeStyle='rgba(0,0,0,0.55)'; ctx.lineWidth=1; ctx.stroke();
      }
      if (pathNodes.has(n.id)){ ctx.beginPath(); ctx.arc(p.x,p.y,r+3.5*p.s,0,7); ctx.strokeStyle='#ffb347'; ctx.lineWidth=2.4; ctx.stroke(); }
      if (isSel){ ctx.beginPath(); ctx.arc(p.x,p.y,r+3.5*p.s,0,7); ctx.strokeStyle='#fff'; ctx.lineWidth=2; ctx.stroke(); }
      if (isHov && !isSel){ ctx.beginPath(); ctx.arc(p.x,p.y,r+3*p.s,0,7); ctx.strokeStyle='rgba(255,255,255,0.7)'; ctx.lineWidth=1.6; ctx.stroke(); }
      if (isCur){
        const t=performance.now()/400;
        ctx.beginPath(); ctx.arc(p.x,p.y,r+6*p.s+Math.sin(t)*1.6,0,7);
        ctx.strokeStyle='#58e07a'; ctx.lineWidth=2.6; ctx.stroke();
      }
      if (n.id===rootId){
        ctx.beginPath(); ctx.arc(p.x,p.y,r+7*p.s,0,7);
        ctx.setLineDash([4,4]); ctx.strokeStyle='rgba(255,255,255,0.5)'; ctx.lineWidth=1.2; ctx.stroke(); ctx.setLineDash([]);
      }
    }

    // подписи
    ctx.font='10px system-ui'; ctx.textAlign='center';
    const showLabels=$('labelChk').checked;
    for (const n of G.nodeArr){
      const p=lastP.get(n.id);
      if (p.x<-60||p.x>CW+60||p.y<-60||p.y>CH+60) continue;
      const isSel=n.id===selected, isCur=walk&&walk.current===n.id, isHov=n===hoverNode;
      const special=isSel||isHov||isCur||pathNodes.has(n.id)||n.id===rootId;
      if ((showLabels||special) && (view.scale>0.25||special)){
        if (mode3d && !(p.s>0.5||isSel||isCur||pathNodes.has(n.id))) continue;
        ctx.fillStyle=(isSel||isCur)?'#fff':'rgba(255,255,255,0.55)';
        ctx.fillText(n.name, p.x, p.y+22*p.s+4);
      }
    }

    // тултип рёбра
    if (hoverEdge && !dragNode && !pan && !rotating){
      const e=hoverEdge, A=G.nodes.get(e.from), B=G.nodes.get(e.to);
      const lines=[A.name+' → '+B.name];
      e.triggers.slice(0,6).forEach(t=>lines.push('· '+t.label));
      if (e.triggers.length>6) lines.push('…');
      ctx.font='11px system-ui'; ctx.textAlign='left';
      const w=Math.max(...lines.map(s=>ctx.measureText(s).width))+16;
      const h=lines.length*15+10;
      let bx=mouse.x+14, by=mouse.y+14;
      if (bx+w>CW) bx=mouse.x-w-14;
      if (by+h>CH) by=mouse.y-h-14;
      ctx.fillStyle='rgba(16,19,26,0.95)';
      ctx.strokeStyle='#2c3242';
      ctx.beginPath(); ctx.roundRect(bx,by,w,h,6); ctx.fill(); ctx.stroke();
      lines.forEach((s,i)=>{
        ctx.fillStyle=i===0?'#9db4ff':'#c6cddb';
        ctx.fillText(s, bx+8, by+17+i*15);
      });
    }
  }

  function loop(){
    if (G && layout==='force' && $('physChk').checked && !physAsleep && !dragNode){
      physics();
      let e=0;
      for (const n of G.nodeArr) e+=Math.abs(n.vx)+Math.abs(n.vy);
      if (e < Math.max(1, G.nodeArr.length*0.02)){ if (++stillFrames>50) physAsleep=true; }
      else stillFrames=0;
      dirty=true;
    }
    if (dirty){ draw(); dirty=false; }
    requestAnimationFrame(loop);
  }

  /* ---------- логика: путь / проход ---------- */
  function shortestPath(a,b){
    const prev=new Map([[a,null]]), q=[a];
    while (q.length){
      const u=q.shift();
      if (u===b) break;
      for (const e of (G.adj.get(u)||[])){
        if (!prev.has(e.to)){ prev.set(e.to,{from:u,edge:e}); q.push(e.to); }
      }
    }
    if (!prev.has(b)) return null;
    const steps=[]; let cur=b;
    while (cur!==a){ const r=prev.get(cur); steps.unshift({to:cur, edge:r.edge}); cur=r.from; }
    return steps;
  }
  function doPath(){
    const a=$('pathFrom').value, b=$('pathTo').value;
    pathEdges=new Set(); pathNodes=new Set(); pathSteps=null;
    if (a && b && a!==b){
      const steps=shortestPath(a,b);
      if (steps){
        pathSteps=steps; pathNodes.add(a);
        steps.forEach(s=>{ pathEdges.add(s.edge); pathNodes.add(s.to); });
      }
    }
    renderSide();
  }

  const condsMet=(conds,stats)=>conds.every(c=>{
    const v=stats[c.p]||0;
    if (c.min!==undefined) return v>=c.min && v<=c.max;
    switch(c.op){ case '>':return v>c.v; case '<':return v<c.v; case '>=':return v>=c.v; case '<=':return v<=c.v; }
    return true;
  });
  const chip=(k,v)=>'<span class="chip" style="background:'+(PARAM_COLORS[k]||'#666')+'">'+k+' '+(v>0?'+':'')+v+'</span>';
  const effChips=eff=>Object.entries(eff).map(([k,v])=>chip(k,v)).join(' ');
  const condBadge=(c,stats)=>{
    const txt=c.min!==undefined?c.p+' '+c.min+'–'+c.max:c.p+c.op+c.v;
    if (!stats) return '<span class="chip cond">'+txt+'</span>';
    return '<span class="chip '+(condsMet([c],stats)?'ok':'bad')+'">'+txt+'</span>';
  };

  function startWalk(){
    if (!selected) return;
    walk={current:selected, stats:{}, history:[], done:new Set(), strict:$('strictChk').checked};
    centerOn(selected);
    renderSide();
  }
  function walkMove(ekey,tidx){
    if (!walk) return;
    const e=(G.adj.get(walk.current)||[]).find(x=>x.from+'>'+x.to===ekey);
    if (!e) return;
    const tr=e.triggers[tidx];
    walk.history.push({ekey,tidx,from:walk.current,stats:{...walk.stats}});
    for (const k in tr.effects) walk.stats[k]=(walk.stats[k]||0)+tr.effects[k];
    walk.done.add(ekey);
    walk.current=e.to; selected=e.to;
    centerOn(e.to);
    renderSide();
  }
  function walkUndo(){
    if (!walk || !walk.history.length) return;
    const h=walk.history.pop();
    walk.stats=h.stats; walk.current=h.from; selected=h.from;
    walk.done.delete(h.ekey);
    renderSide();
  }

  /* ---------- панели ---------- */
  function trigRow(e,t,i){
    const B=G.nodes.get(e.to);
    const conds=t.conds.map(c=>condBadge(c, walk?walk.stats:null)).join(' ');
    const dis=walk&&walk.strict&&!condsMet(t.conds,walk.stats);
    const eff=effChips(t.effects);
    return '<li data-lf="'+e.from+'" data-lt="'+e.to+'"><button class="wbtn" data-act="walk" data-e="'+e.from+'&gt;'+e.to+'" data-t="'+i+'"'+(dis?' disabled':'')+'>'+
      '<span class="tdir">'+t.label+' →</span> <span class="tlink">'+B.name+'</span> '+conds+' '+eff+'</button></li>';
  }

  function renderSide(){
    if (!G) return;
    // --- панель локации
    const np=$('nodePanel');
    if (!selected || !G.nodes.has(selected)){
      np.innerHTML='<span class="hint">кликните по ноде на графе</span>';
    } else {
      const n=G.nodes.get(selected);
      const outs=(G.adj.get(n.id)||[]), ins=(G.radj.get(n.id)||[]);
      let h='<div class="npName">'+n.name+'<span class="badge">'+(n.version||'—')+'</span></div>';
      if (n.desc) h+='<div class="npDesc">'+n.desc+'</div>';
      if (n.imgState===2) h+='<img class="npShot" src="'+n.imgSrc+'" alt="'+n.name+'">';
      h+='<div class="tdir">глубина от '+G.nodes.get(rootId).name+': '+(n.depth>=0?n.depth:'нет пути (авто-переход)')+
         ' · исходящих: '+outs.reduce((s,e)=>s+e.triggers.length,0)+' · входящих: '+ins.reduce((s,e)=>s+e.triggers.length,0)+'</div>';
      const MAX=35; let cnt=0;
      h+='<ul class="tlist">';
      for (const e of outs){ for (let i=0;i<e.triggers.length;i++){
        if (cnt++>=MAX){ h+='<li class="hint">… ещё '+(outs.reduce((s,e)=>s+e.triggers.length,0)-MAX)+'</li>'; break; }
        const t=e.triggers[i], B=G.nodes.get(e.to);
        h+='<li data-lf="'+n.id+'" data-lt="'+B.id+'"><span class="tdir">'+t.label+' →</span> <span class="tlink" data-act="sel" data-id="'+B.id+'">'+B.name+'</span> '+
           t.conds.map(c=>condBadge(c,null)).join(' ')+' '+effChips(t.effects)+'</li>';
      }}
      h+='</ul>';
      np.innerHTML=h;
    }
    // --- панель пути
    const pp=$('pathPanel');
    const prevF=pp.dataset.f, prevT=pp.dataset.t;
    pp.innerHTML='<div class="pRow"><select id="pathFrom"></select><span class="tdir">→</span><select id="pathTo"></select></div>';
    fillSelects();
    if (prevF && G.nodes.has(prevF)) $('pathFrom').value=prevF;
    if (prevT && G.nodes.has(prevT)) $('pathTo').value=prevT;
    $('pathFrom').onchange=()=>{pp.dataset.f=$('pathFrom').value;};
    $('pathTo').onchange=()=>{pp.dataset.t=$('pathTo').value;};
    let b='<div class="pRow"><button class="minibtn" data-act="path">Найти (BFS)</button>'+
          '<button class="minibtn" data-act="useSel" data-which="from">от выбранной</button>'+
          '<button class="minibtn" data-act="useSel" data-which="to">к выбранной</button>'+
          (pathSteps?'<button class="minibtn" data-act="clearPath">сброс</button>':'')+'</div>';
    if (pathSteps){
      b+='<div class="hint">шагов: '+pathSteps.length+'</div><div class="steps">';
      let cur=$('pathFrom').value, i=1;
      for (const s of pathSteps){
        const A=G.nodes.get(cur), B=G.nodes.get(s.to);
        const tr=s.edge.triggers.slice().sort((x,y)=>x.conds.length-y.conds.length)[0];
        b+='<div data-lf="'+cur+'" data-lt="'+B.id+'">'+(i++)+'. '+A.name+' → <span class="tlink" data-act="sel" data-id="'+B.id+'">'+B.name+'</span> <span class="tdir">('+tr.label+')</span></div>';
        cur=s.to;
      }
      b+='</div>';
    }
    pp.insertAdjacentHTML('beforeend', b);
    // --- панель прохода
    const wp=$('walkPanel');
    if (!walk){
      wp.innerHTML='<label class="chk" style="margin-bottom:6px"><input type="checkbox" id="strictChk"> строгий режим (блокировать переходы с невыполненными условиями)</label>'+
        '<button class="wbtn" data-act="walkStart"'+(selected?'':' disabled')+'>Начать проход от «'+(selected?G.nodes.get(selected).name:'—')+'»</button>'+
        '<div class="hint" style="margin-top:6px">в проходе учитываются значения abyss / surface / lucid / gestalt / SAN рядом с переходами</div>';
    } else {
      const n=G.nodes.get(walk.current);
      let w='<div class="npName">'+n.name+'</div><div class="statsRow">'+
        PARAMS.map(p=>'<span class="chip" style="background:'+PARAM_COLORS[p]+'">'+p+' '+(walk.stats[p]||0)+'</span>').join(' ')+'</div>';
      const outs=G.adj.get(walk.current)||[];
      const total=outs.reduce((s,e)=>s+e.triggers.length,0);
      w+='<div class="tdir" style="margin-bottom:2px">доступно триггеров: '+total+'</div><ul class="tlist">';
      for (const e of outs) for (let i=0;i<e.triggers.length;i++) w+=trigRow(e,e.triggers[i],i);
      w+='</ul><div class="pRow" style="margin-top:8px">'+
        '<button class="minibtn" data-act="walkUndo"'+(walk.history.length?'':' disabled')+'>↩ откат</button>'+
        '<button class="minibtn" data-act="walkEnd">завершить</button></div>';
      wp.innerHTML=w;
    }
    // --- легенда
    $('legendPanel').innerHTML=
      '<div class="pRow">версии: '+Object.entries(VERSION_COLORS).filter(([k])=>k).map(([k,v])=>'<span class="chip" style="background:'+v+'">'+k+'</span>').join(' ')+'</div>'+
      '<div class="pRow">'+PARAMS.map(p=>'<span class="chip" style="background:'+PARAM_COLORS[p]+'">'+p+'</span>').join(' ')+'</div>'+
      '<div class="hint">пунктир — корень ('+G.nodes.get(rootId).name+').<br>'+
      'раскладки: конус / радиальная / force.<br>'+
      '3D: ЛКМ — орбита, СКМ — пан, ПКМ — долли, колесо — зум.<br>'+
      '«вписать» — сброс ракурса камеры + фит (в 3D), просто фит (в 2D).<br>'+
      'ховер по локации в списках — скриншот.</div>';
  }

  /* ---------- события ---------- */
  side.addEventListener('click', ev=>{
    const el=ev.target.closest('[data-act]'); if (!el) return;
    const act=el.dataset.act;
    if (act==='sel'){ selected=el.dataset.id; renderSide(); }
    else if (act==='path'){ doPath(); }
    else if (act==='useSel'){ if (!selected) return; if (el.dataset.which==='from') $('pathFrom').value=selected; else $('pathTo').value=selected; }
    else if (act==='clearPath'){ pathEdges=new Set(); pathNodes=new Set(); pathSteps=null; renderSide(); }
    else if (act==='walkStart'){ startWalk(); }
    else if (act==='walk'){ walkMove(el.dataset.e.replace('&gt;','>'), +el.dataset.t); }
    else if (act==='walkUndo'){ walkUndo(); }
    else if (act==='walkEnd'){ walk=null; renderSide(); }
  });

  $('search').addEventListener('input', ()=>{
    const q=$('search').value.trim().toLowerCase();
    const box=$('searchResults');
    if (!q || !G){ box.innerHTML=''; return; }
    const hits=G.nodeArr.filter(n=>n.id.includes(q)||(n.desc&&n.desc.toLowerCase().includes(q))).slice(0,12);
    box.innerHTML=hits.map(n=>'<button class="sres" data-id="'+n.id+'">'+n.name+(n.desc?'<small>'+n.desc+'</small>':'')+'</button>').join('')||'<span class="hint">не найдено</span>';
  });
  $('searchResults').addEventListener('click', ev=>{
    const b=ev.target.closest('.sres'); if (!b) return;
    selected=b.dataset.id; centerOn(selected); renderSide();
  });

  // ховер-скриншоты: показ только если картинка существует
  const shotTip=$('shotTip');
  const hideTip=()=>{ shotTip.style.display='none'; };
  side.addEventListener('mouseover', ev=>{
    let id=null, wb=null;
    const el=ev.target.closest('[data-id]');
    if (el) id=el.dataset.id;
    else {
      wb=ev.target.closest('[data-e]');           // кнопки прохода: цель из "from>to"
      if (wb) id=wb.dataset.e.replace('&gt;','>').split('>')[1];
    }
    // подсветка на карте стрелки строки: срабатывает от любой точки строки (data-lf/data-lt)
    let link=null;
    const lr=ev.target.closest('[data-lt]');
    if (lr) link={f:lr.dataset.lf, t:lr.dataset.lt};
    const lks=link?link.f+'>'+link.t:'', old=hoverLink?hoverLink.f+'>'+hoverLink.t:'';
    if (lks!==old){ hoverLink=link; wake(); }
    const n=(id && G) ? G.nodes.get(id) : null;
    if (n && n.imgState===2 && n.imgSrc){
      shotTip.innerHTML='<img src="'+n.imgSrc+'" alt="">';
      shotTip.style.display='block';
    } else hideTip();
  });
  side.addEventListener('mousemove', ev=>{
    if (shotTip.style.display!=='block') return;
    let x=ev.clientX+16, y=ev.clientY+16;
    if (x+262>window.innerWidth)  x=ev.clientX-262;
    if (y+210>window.innerHeight) y=Math.max(8, ev.clientY-210);
    shotTip.style.left=x+'px'; shotTip.style.top=y+'px';
  });
  side.addEventListener('mouseout', ev=>{
    if (hoverLink){ hoverLink=null; wake(); }
    if (!ev.relatedTarget || !side.contains(ev.relatedTarget)) hideTip();
  });

  // панель по клику на стрелку: обе локации-ссылки + триггеры с эффектами
  const edgePanel=$('edgePanel');
  const closeEdgePanel=()=>{ edgePanel.style.display='none'; openEdge=null; wake(); };
  function openEdgePanel(e, cx, cy){
    const A=G.nodes.get(e.from), B=G.nodes.get(e.to);
    let h='<div class="epHead"><span class="tlink" data-id="'+A.id+'">'+A.name+'</span>'+
          '<span class="tdir">→</span><span class="tlink" data-id="'+B.id+'">'+B.name+'</span>'+
          '<button class="epX" title="закрыть">✕</button></div><ul class="tlist">';
    for (const t of e.triggers)
      h+='<li><span class="tdir">'+t.label+'</span> '+t.conds.map(c=>condBadge(c,null)).join(' ')+' '+effChips(t.effects)+'</li>';
    edgePanel.innerHTML=h+'</ul>';
    edgePanel.style.display='block';
    openEdge=e;
    wake();
    const ph=edgePanel.offsetHeight||180;
    let x=cx+14, y=cy+14;
    if (x+314>window.innerWidth) x=cx-314;
    if (y+ph+16>window.innerHeight) y=Math.max(8, cy-ph-14);
    edgePanel.style.left=Math.max(8,x)+'px'; edgePanel.style.top=Math.max(8,y)+'px';
  }
  edgePanel.addEventListener('click', ev=>{
    if (ev.target.closest('.epX')){ closeEdgePanel(); return; }
    const l=ev.target.closest('[data-id]');
    if (l){ selected=l.dataset.id; centerOn(selected); renderSide(); closeEdgePanel(); }
  });
  window.addEventListener('keydown', ev=>{ if (ev.key==='Escape') closeEdgePanel(); });

  // раскладки / сортировка / 3D
  $('layoutSel').addEventListener('change', e=>{ layout=e.target.value; applyLayout(); });
  $('sortSel').addEventListener('change', e=>{ sort=e.target.value; applyLayout(); });
  $('mode3dChk').addEventListener('change', e=>{ mode3d=e.target.checked; fit(); });

  canvas.addEventListener('contextmenu', ev=>ev.preventDefault());
  canvas.addEventListener('mousedown', ev=>{
    const r=canvas.getBoundingClientRect(), sx=ev.clientX-r.left, sy=ev.clientY-r.top;
    moved=false;
    wake();
    closeEdgePanel();
    if (mode3d){
      if (ev.button===0) rotating={sx,sy,rx:rot.x,ry:rot.y};          // ЛКМ — орбита
      else if (ev.button===1){ pan={sx,sy,vx:view.x,vy:view.y}; ev.preventDefault(); } // СКМ — пан
      else if (ev.button===2) dollying={sy, d:camDist};              // ПКМ — долли
      canvas.style.cursor='grabbing';
      return;
    }
    if (ev.button===2) return;
    const n=pickNode(sx,sy);
    if (n){ dragNode=n; }
    else { pan={sx,sy,vx:view.x,vy:view.y}; canvas.style.cursor='grabbing'; }
  });
  window.addEventListener('mousemove', ev=>{
    const r=canvas.getBoundingClientRect(), sx=ev.clientX-r.left, sy=ev.clientY-r.top;
    mouse.x=sx; mouse.y=sy;
    dirty=true;
    if (rotating && mode3d){
      rot.y = rotating.ry + (sx-rotating.sx)*0.006;
      rot.x = Math.max(-1.4, Math.min(1.4, rotating.rx + (sy-rotating.sy)*0.006));
      moved=true;
    } else if (dollying && mode3d){
      camDist = Math.max(250, Math.min(4000, dollying.d + (sy-dollying.sy)*3));
      moved=true;
    } else if (dragNode && !mode3d){
      const [wx,wy]=toWorld(sx,sy);
      dragNode.x=wx; dragNode.y=wy; dragNode.vx=dragNode.vy=0; moved=true;
    } else if (pan){
      if (mode3d){ view.x=pan.vx+(sx-pan.sx); view.y=pan.vy+(sy-pan.sy); } // 3D: view прибавляется к экрану
      else       { view.x=pan.vx-(sx-pan.sx); view.y=pan.vy-(sy-pan.sy); } // 2D: «захват мира»
      moved=true;
    } else {
      if (ev.target===canvas){           // пикать только над канвасом: панели/сайдбар не подсвечивают стрелки под собой
        hoverNode=pickNode(sx,sy);
        hoverEdge=hoverNode?null:pickEdge(sx,sy);
      } else { hoverNode=null; hoverEdge=null; }
      canvas.style.cursor=hoverNode?'pointer':'grab';
    }
  });
  window.addEventListener('mouseup', ev=>{
    const r=canvas.getBoundingClientRect(), sx=ev.clientX-r.left, sy=ev.clientY-r.top;
    wake();
    const onCanvas=ev.target===canvas;   // клики по панелям/сайдбару не должны пикать карту под ними
    if (mode3d){
      if (onCanvas && ev.button===0 && !moved){        // клик: нода → выбор, стрелка → панель
        const n=pickNode(sx,sy);
        if (n){ selected=n.id; renderSide(); }
        else { const e=pickEdge(sx,sy); if (e) openEdgePanel(e, ev.clientX, ev.clientY); }
      }
      rotating=null; dollying=null; pan=null;
      canvas.style.cursor='grab';
      return;
    }
    if (onCanvas && ev.button===0 && !moved){
      const n=pickNode(sx,sy);
      if (n){ selected=n.id; renderSide(); }
      else { const e=pickEdge(sx,sy); if (e) openEdgePanel(e, ev.clientX, ev.clientY); }
    }
    dragNode=null; pan=null; canvas.style.cursor='grab';
  });
  canvas.addEventListener('wheel', ev=>{
    ev.preventDefault();
    if (mode3d){
      view.scale=Math.max(0.05, Math.min(4, view.scale*(ev.deltaY<0?1.15:1/1.15)));
      wake();
      return;
    }
    const r=canvas.getBoundingClientRect(), sx=ev.clientX-r.left, sy=ev.clientY-r.top;
    const [wx,wy]=toWorld(sx,sy);
    view.scale=Math.max(0.08,Math.min(4,view.scale*(ev.deltaY<0?1.15:1/1.15)));
    view.x=wx*view.scale+CW/2-sx;
    view.y=wy*view.scale+CH/2-sy;
    wake();
  },{passive:false});

  $('fitBtn').onclick=()=>{ rot.x=0.5; rot.y=0.6; camDist=1200; fit(); };  // «вписать» = сброс ракурса + фит
  canvas.addEventListener('dblclick', fit);

  // старт: карта читается напрямую из data/map.txt (нужен статический сервер).
  // Через file:// браузер запрещает чтение файлов — показываем инструкцию.
  fetch('data/map.txt')
    .then(r=>{ if(!r.ok) throw new Error('HTTP '+r.status); return r.text(); })
    .then(build)
    .catch(err=>{
      const url=new URL('data/map.txt', location.href).href;
      const msg=(err && err.message) ? err.message : String(err);
      let hint='';
      if (location.protocol==='file:')
        hint='Страница открыта как файл (file://) — браузеры запрещают странице чтение локальных файлов. Запустите статический сервер: <code style="background:#1b1f27;padding:2px 6px;border-radius:4px">python3 -m http.server 8000</code> и откройте http://localhost:8000';
      else if (/HTTP 404/.test(msg))
        hint='Сервер ответил 404 — он отдаёт не ту папку. Сервер нужно запускать из корня приложения (там, где лежит index.html), и открывать страницу по тому же адресу.';
      else if (/Failed to fetch|NetworkError|загрузки|Load/i.test(msg))
        hint='Сеть недоступна: страница, возможно, всё же открыта как файл, либо блокировщик/антивирус режет запрос к '+location.host+'.';
      else
        hint='Ошибка при разборе карты — пришлите текст ошибки разработчику.';
      const d=document.createElement('div');
      d.style.cssText='position:fixed;inset:0;z-index:100;display:flex;align-items:center;justify-content:center;background:#0d0f13;color:#dfe3ea;font:14px system-ui';
      d.innerHTML='<div style="max-width:560px;line-height:1.7;padding:24px">'+
        '<h2 style="margin:0 0 12px">Карта не загрузилась</h2>'+
        '<div style="background:#161a21;border:1px solid #2c3242;border-radius:8px;padding:10px;margin-bottom:12px;font-size:12px">'+
        '<div>запрошено: <code>'+url+'</code></div>'+
        '<div>ошибка: <code>'+msg+'</code></div></div>'+
        hint+'</div>';
      document.body.appendChild(d);
    });

  /* ---------- фон: WebGL-liquid (fbm + domain warping) поверх CSS-фолбэка ----------
     Рендерится в отдельный канвас 0.35x разрешения (апскейл CSS), 30 fps,
     на покадровую отрисовку дерева не влияет (dirty-флаг не трогаем). */
  (function bgInit(){
    const bgCanvas=$('bgGl'), bgDiv=$('bg'), bgChk=$('bgChk');
    let gl=null, prog=null, uT=null, uR=null, uM=null, bgW=0, bgH=0, bgLast=0;
    const BG_SCALE=0.35, BG_FPS=30;
    try{
      gl=bgCanvas.getContext('webgl',{alpha:false,antialias:false,depth:false,stencil:false});
    }catch(e){ gl=null; }
    if (gl){
      const V='attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
      const F=[
        'precision mediump float;',
        'uniform float t;uniform vec2 r;uniform vec2 m;',
        'float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}',
        'float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);',
        '  return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y);}',
        'float fbm(vec2 p){float v=0.0;float a=0.5;',
        '  for(int i=0;i<5;i++){v+=a*noise(p);p=p*2.03+vec2(1.7,9.2);a*=0.5;}return v;}',
        'void main(){',
        '  vec2 uv=(gl_FragCoord.xy-0.5*r)/r.y;',
        '  float T=t*0.06;',
        '  vec2 q=vec2(fbm(uv+T),fbm(uv+vec2(5.2,1.3)-T));',
        '  vec2 w=vec2(fbm(uv+3.0*q+vec2(1.7,9.2)+0.15*T),fbm(uv+3.0*q+vec2(8.3,2.8)-0.12*T));',
        '  float f=fbm(uv+3.0*w);',
        '  vec3 c1=vec3(0.05,0.07,0.13);',
        '  vec3 c2=vec3(0.10,0.16,0.30);',
        '  vec3 c3=vec3(0.23,0.12,0.33);',
        '  vec3 c4=vec3(0.05,0.20,0.22);',
        '  vec3 col=mix(c1,c2,clamp(f*f*2.6,0.0,1.0));',
        '  col=mix(col,c3,clamp(length(q)*0.7,0.0,1.0));',
        '  col=mix(col,c4,clamp(w.x*0.5,0.0,1.0)*0.6);',
        '  float d=distance(uv,(m-0.5)*vec2(r.x/r.y,1.0)*1.6);',
        '  col+=vec3(0.04,0.06,0.10)*exp(-d*d*4.0);',
        '  gl_FragColor=vec4(col,1.0);',
        '}'
      ].join('\n');
      const sh=(type,src)=>{const x=gl.createShader(type);gl.shaderSource(x,src);gl.compileShader(x);
        if(!gl.getShaderParameter(x,gl.COMPILE_STATUS)) throw gl.getShaderInfoLog(x); return x;};
      try{
        prog=gl.createProgram();
        gl.attachShader(prog,sh(gl.VERTEX_SHADER,V));
        gl.attachShader(prog,sh(gl.FRAGMENT_SHADER,F));
        gl.linkProgram(prog);
        if(!gl.getProgramParameter(prog,gl.LINK_STATUS)) throw gl.getProgramInfoLog(prog);
      }catch(e){ prog=null; gl=null; }
    }
    if (!gl){ bgCanvas.style.display='none'; return; }  // WebGL нет — живёт CSS-слой
    gl.useProgram(prog);
    const buf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,buf);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
    const loc=gl.getAttribLocation(prog,'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc,2,gl.FLOAT,false,0,0);
    uT=gl.getUniformLocation(prog,'t');
    uR=gl.getUniformLocation(prog,'r');
    uM=gl.getUniformLocation(prog,'m');
    bgDiv.style.display='none';                        // WebGL жив — CSS-градиент не нужен
    bgCanvas.style.display='block';
    const bgResize=()=>{
      const w=Math.max(2,Math.round(canvas.clientWidth*BG_SCALE));
      const h=Math.max(2,Math.round(canvas.clientHeight*BG_SCALE));
      if(w!==bgW||h!==bgH){ bgW=w; bgH=h; bgCanvas.width=w; bgCanvas.height=h; gl.viewport(0,0,w,h); }
    };
    window.addEventListener('resize',bgResize);
    let bgMouse=[0.5,0.5];
    window.addEventListener('mousemove',ev=>{ bgMouse=[ev.clientX/window.innerWidth,1-ev.clientY/window.innerHeight]; });
    function bgFrame(now){
      requestAnimationFrame(bgFrame);                  // цепочка жива всегда; пауза — пропуском кадров
      if(!bgChk.checked||document.hidden) return;
      if(now-bgLast<1000/BG_FPS) return;
      bgLast=now;
      bgResize();
      gl.uniform1f(uT,now/1000);
      gl.uniform2f(uR,bgW,bgH);
      gl.uniform2f(uM,bgMouse[0],bgMouse[1]);
      gl.drawArrays(gl.TRIANGLES,0,3);
    }
    requestAnimationFrame(bgFrame);
  })();

  loop();
}

if (typeof document!=='undefined'){
  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded', init);
  else init();
}
