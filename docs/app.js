let C, CSV, SRC_JP, SRC_DEVICES, HIGHLIGHTS, REAL_DATA, SRC_FURIGANA,
    SRC_DEVICE_LABELS, HIGHLIGHT_LABELS, HIGHLIGHT_DEVICE_KEYS;

fetch('./data/poems.json', {cache:'no-cache'})
  .then(r => r.json())
  .then(data => {
    ({C, CSV, SRC_JP, SRC_DEVICES, HIGHLIGHTS, REAL_DATA, SRC_FURIGANA,
      SRC_DEVICE_LABELS = {}, HIGHLIGHT_LABELS = {}, HIGHLIGHT_DEVICE_KEYS = {}} = data);
    init();
  })
  .catch(err => {
    document.getElementById('grid').innerHTML =
      '<p style="padding:2rem;color:#b23a12;">Failed to load data/poems.json — ' + err + '</p>';
  });

function init(){


const DCOLORS=[C.kakekotoba,C.makurakotoba,C.kigo];

const TRANS_LBLS=['D','M','N','P'];
const TRANS_NAMES={D:'F.V. Dickins 1866',M:'MacCauley 1899',N:'Noguchi 1907',P:'Porter 1909'};

function mkPlaceholder(n){
  const row=CSV[String(n)]||{};
  const bars=['O',...TRANS_LBLS].map(lbl=>{
    const isO=lbl==='O';
    const nLines=isO?5:((row[lbl]&&row[lbl].length)||1);
    const segs=Array.from({length:nLines},()=>({type:'unanalyzed'}));
    return{lbl,segs,nLines};
  });
  return{n,bars,real:false};
}

const BAR_ORDER=['O','D','M','N','P'];
const POEMS=Array.from({length:100},(_,i)=>{
  const n=i+1;
  const poem=REAL_DATA[n]||mkPlaceholder(n);
  poem.bars.sort((a,b)=>BAR_ORDER.indexOf(a.lbl)-BAR_ORDER.indexOf(b.lbl));
  return poem;
});

const DIM=82;
const SVG_W_BARS=82;
const BAR_X=[0, 23, 40, 57, 74];   // O=0, D=23, N=40, M=57, P=74
const BAR_W=[8, 8, 8, 8, 8];

function f(v){return Math.round(v*10)/10;}

function jpDeviceFracs(n) {
  const jpRaw = SRC_JP[String(n)] || '';
  if (!jpRaw) return {};
  const jp = jpRaw.replace(/\n/g,'');
  const total = jp.length;
  const devs = SRC_DEVICES[String(n)] || {};
  const byColor = {};
  Object.entries(devs)
    .filter(([w]) => w !== 'none' && jp.includes(w))
    .sort(([a],[b]) => jp.indexOf(a) - jp.indexOf(b))
    .forEach(([word, color]) => {
      const pos = jp.indexOf(word);
      const span = {start: pos/total, end: (pos+word.length)/total, word};
      (byColor[color] = byColor[color]||[]).push(span);
    });
  return byColor;
}

function gridDeviceColor(dc){
  return dc;
}

let viewMode = 'device';

function glyph(poem, withTips){
  const maxLines=Math.max(...poem.bars.map(b=>b.nLines));
  const jpFracs = (viewMode==='device' && poem.real) ? jpDeviceFracs(poem.n) : {};
  const parts=[];
  poem.bars.forEach((bar,bi)=>{
    const x=BAR_X[bi], bw=BAR_W[bi];
    const bh=f((bar.nLines/maxLines)*DIM);
    const sh=bh/bar.nLines;
    const rx=bw/2;
    const cid=`c${poem.n}_${bi}`;
    parts.push(`<defs><clipPath id="${cid}"><rect x="${x}" y="0" width="${bw}" height="${bh}" rx="${rx}"/></clipPath></defs>`);
    parts.push(`<g clip-path="url(#${cid})">`);
    let y=0;
    bar.segs.forEach(seg=>{
      const fc=seg.type==='kami'?C.kami:seg.type==='shimo'?C.shimo:seg.type==='imagined'?C.imagined:C.unanalyzed;
      parts.push(`<rect x="${x}" y="${f(y)}" width="${bw}" height="${f(sh+.5)}" fill="${fc}"/>`);
      y+=sh;
    });
    if(viewMode==='device' && bi===0 && poem.real && Object.keys(jpFracs).length>0){
      const devLabels = withTips ? (SRC_DEVICE_LABELS[String(poem.n)]||{}) : null;
      Object.entries(jpFracs).forEach(([dc,spans])=>{
        spans.forEach(({start,end,word})=>{
          const label = devLabels && word ? devLabels[word] : null;
          const tipAttr = label ? ` data-tip="${escHtml(label)}"` : '';
          parts.push(`<rect x="${x}" y="${f(start*bh)}" width="${bw}" height="${f((end-start)*bh)}" fill="${gridDeviceColor(dc)}"${tipAttr}/>`);
        });
      });
    } else if(viewMode==='device'){
      let sy=0;
      bar.segs.forEach(seg=>{
        const devs = seg.devs || (seg.dev!=null ? [{color:seg.dev,start:0,end:1}] : []);
        devs.forEach(({color,start,end})=>{
          const dc=typeof color==='string'&&color[0]==='#'?color:DCOLORS[color];
          const y0=sy+start*sh, y1=sy+end*sh;
          parts.push(`<rect x="${x}" y="${f(y0)}" width="${bw}" height="${f(Math.max(y1-y0,1.2))}" fill="${gridDeviceColor(dc)}"/>`);
        });
        sy+=sh;
      });
    }
    parts.push('</g>');
  });
  const HDR = withTips ? 10 : 0;
  if(withTips){
    poem.bars.forEach((bar,bi)=>{
      const cx=f(BAR_X[bi]+BAR_W[bi]/2);
      parts.push(`<text x="${cx}" y="-2" text-anchor="middle" font-family="Inter,system-ui,sans-serif" font-size="6.5" font-weight="600" fill="#555">${escHtml(bar.lbl)}</text>`);
    });
  }
  return `<svg width="100%" height="100%" viewBox="0 ${withTips?`-${HDR}`:0} ${SVG_W_BARS} ${DIM+HDR}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">${parts.join('')}</svg>`;
}

const AUTHOR_BAR_W=24;
function glyphOneBar(poem, bi){
  const bar=poem.bars[bi];
  const jpFracs=(viewMode==='device' && poem.real && bi===0) ? jpDeviceFracs(poem.n) : {};
  const W=AUTHOR_BAR_W, bh=DIM, sh=bh/bar.nLines, rx=2;
  const cid=`ab${poem.n}_${bi}`;
  const parts=[];
  parts.push(`<defs><clipPath id="${cid}"><rect x="0" y="0" width="${W}" height="${bh}" rx="${rx}"/></clipPath></defs>`);
  parts.push(`<g clip-path="url(#${cid})">`);
  let y=0;
  bar.segs.forEach(seg=>{
    const fc=seg.type==='kami'?C.kami:seg.type==='shimo'?C.shimo:seg.type==='imagined'?C.imagined:C.unanalyzed;
    parts.push(`<rect x="0" y="${f(y)}" width="${W}" height="${f(sh+.5)}" fill="${fc}"/>`);
    y+=sh;
  });
  if(viewMode==='device' && bi===0 && poem.real && Object.keys(jpFracs).length>0){
    Object.entries(jpFracs).forEach(([dc,spans])=>{
      spans.forEach(({start,end})=>{
        parts.push(`<rect x="0" y="${f(start*bh)}" width="${W}" height="${f((end-start)*bh)}" fill="${gridDeviceColor(dc)}"/>`);
      });
    });
  } else if(viewMode==='device'){
    let sy=0;
    bar.segs.forEach(seg=>{
      const devs=seg.devs || (seg.dev!=null ? [{color:seg.dev,start:0,end:1}] : []);
      devs.forEach(({color,start,end})=>{
        const dc=typeof color==='string'&&color[0]==='#'?color:DCOLORS[color];
        const y0=sy+start*sh, y1=sy+end*sh;
        parts.push(`<rect x="0" y="${f(y0)}" width="${W}" height="${f(Math.max(y1-y0,1.2))}" fill="${gridDeviceColor(dc)}"/>`);
      });
      sy+=sh;
    });
  }
  parts.push('</g>');
  return `<svg width="100%" height="100%" viewBox="0 0 ${W} ${DIM}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">${parts.join('')}</svg>`;
}

const AUTHOR_SLOTS=[
  {key:'O', label:'原文 Source'},
  {key:'D', label:'F.V. Dickins 1866'},
  {key:'M', label:'MacCauley 1899'},
  {key:'N', label:'Noguchi 1907'},
  {key:'P', label:'Porter 1909'},
];
let authorGridsBuilt=false;
function buildAuthorGrids(){
  const container=document.getElementById('authorGrids');
  container.innerHTML='';
  const row=document.createElement('div');
  row.className='author-panels-row';
  AUTHOR_SLOTS.forEach(slot=>{
    const panel=document.createElement('div');
    panel.className='author-panel';
    const label=document.createElement('div');
    label.className='author-panel-label';
    label.textContent=slot.label;
    panel.appendChild(label);
    const mg=document.createElement('div');
    mg.className='author-mini-grid';
    POEMS.forEach(poem=>{
      const bi=poem.bars.findIndex(b=>b.lbl===slot.key);
      const cell=document.createElement('div');
      cell.className='author-cell';
      cell.tabIndex=0;
      cell.dataset.n=poem.n;
      cell.dataset.slot=slot.key;
      cell.title=`Poem ${poem.n}`;
      cell.setAttribute('aria-label',`Poem ${poem.n}, ${slot.label}`);
      if(bi!==-1) cell.innerHTML=glyphOneBar(poem, bi);
      cell.addEventListener('click', ()=>openModal(poem.n));
      cell.addEventListener('keydown', e=>{if(e.key==='Enter'||e.key===' ')openModal(poem.n);});
      cell.addEventListener('mouseenter', ()=>updateAuthorHighlight(poem.n));
      cell.addEventListener('mouseleave', ()=>updateAuthorHighlight(0));
      mg.appendChild(cell);
    });
    panel.appendChild(mg);
    row.appendChild(panel);
  });
  container.appendChild(row);
  const leg=document.createElement('div');
  leg.className='author-legend'+(viewMode==='structure'?' structure-only':'');
  leg.id='authorLegend';
  leg.innerHTML=`<div class="author-poem-info" id="authorPoemInfo"></div>
    <strong>Legend</strong>
    <div class="legend-row"><div class="legend-swatch" style="background:#2E9E6B"></div>Kami-no-ku</div>
    <div class="legend-row"><div class="legend-swatch" style="background:#E5503A"></div>Shimo-no-ku</div>
    <div class="legend-row"><div class="legend-swatch" style="background:#6F63C9"></div>Imagined ku</div>
    <div class="legend-row legend-device"><div class="legend-swatch" style="background:#F28FC0"></div>Kakekotoba</div>
    <div class="legend-row legend-device"><div class="legend-swatch" style="background:#7EBBEE"></div>Makurakotoba</div>
    <div class="legend-row legend-device"><div class="legend-swatch" style="background:#B4DE65"></div>Kigo</div>`;
  container.appendChild(leg);
  authorGridsBuilt=true;
}
function updateAuthorHighlight(n){
  const container=document.getElementById('authorGrids');
  document.querySelectorAll('.author-cell').forEach(c=>c.classList.toggle('author-hl',+c.dataset.n===n));
  if(n) container.setAttribute('data-hl',n);
  else container.removeAttribute('data-hl');
  const info=document.getElementById('authorPoemInfo');
  if(!info) return;
  if(n){
    const poet=(CSV[String(n)]||{}).poet||'';
    info.textContent=`Poem ${n}${poet?': '+poet:''}`;
  } else {
    info.textContent='';
  }
}
function refreshAuthorGrids(){
  if(!authorGridsBuilt) return;
  document.querySelectorAll('.author-cell').forEach(cell=>{
    const poem=POEMS[+cell.dataset.n-1];
    const bi=poem.bars.findIndex(b=>b.lbl===cell.dataset.slot);
    cell.innerHTML = bi!==-1 ? glyphOneBar(poem, bi) : '';
  });
}

const TOTAL_W=30, TOTAL_H=600;
function computeTotalAggregates(slotKey){
  const sc={kami:0,shimo:0,imagined:0,unanalyzed:0};
  const dc={};
  POEMS.forEach(poem=>{
    const bar=poem.bars.find(b=>b.lbl===slotKey);
    if(!bar) return;
    if(slotKey==='O' && poem.real){
      const jpFracs=jpDeviceFracs(poem.n);
      const nLines=bar.nLines;
      bar.segs.forEach((seg,si)=>{
        sc[seg.type||'unanalyzed']++;
        const ls=si/nLines, le=(si+1)/nLines;
        Object.entries(jpFracs).forEach(([col,spans])=>{
          if(spans.some(({start,end})=>start<le&&end>ls))
            dc[col]=(dc[col]||0)+1;
        });
      });
    } else {
      bar.segs.forEach(seg=>{
        sc[seg.type||'unanalyzed']++;
        const devs=seg.devs||(seg.dev!=null?[{color:seg.dev}]:[]);
        devs.forEach(({color})=>{
          const col=typeof color==='string'&&color[0]==='#'?color:DCOLORS[color];
          dc[col]=(dc[col]||0)+1;
        });
      });
    }
  });
  return {sc,dc};
}
function totalSegOrder(sc,dc){
  const all=[
    {fill:C.kakekotoba,  label:'Kakekotoba',   count:dc[C.kakekotoba]||0, kind:'device'},
    {fill:C.makurakotoba,label:'Makurakotoba',  count:dc[C.makurakotoba]||0, kind:'device'},
    {fill:C.kigo,        label:'Kigo',          count:dc[C.kigo]||0, kind:'device'},
    {fill:C.kami,        label:'Kami-no-ku',      count:sc.kami, kind:'struct'},
    {fill:C.shimo,       label:'Shimo-no-ku',     count:sc.shimo, kind:'struct'},
    {fill:C.imagined,    label:'Imagined ku',   count:sc.imagined, kind:'struct'},
    {fill:C.unanalyzed,  label:'Unanalyzed',    count:sc.unanalyzed, kind:'struct'},
  ];
  return all.filter(s=>s.count>0 && (viewMode==='structure'?s.kind==='struct':s.kind==='device'));
}
function glyphTotalBar(slotKey){
  const {sc,dc}=computeTotalAggregates(slotKey);
  const segs=totalSegOrder(sc,dc);
  const grand=segs.reduce((a,s)=>a+s.count,0);
  if(!grand) return '';
  const W=TOTAL_W, H=TOTAL_H;
  const parts=[];
  let y=0;
  segs.forEach(({fill,label,count},i)=>{
    const h=(count/grand)*H;
    parts.push(`<g class="total-seg-group" data-label="${label}" data-count="${count}">`);
    parts.push(`<rect x="0" y="${f(y)}" width="${W}" height="${f(h)}" fill="${fill}"/>`);
    if(i<segs.length-1)
      parts.push(`<line x1="0" y1="${f(y+h)}" x2="${W}" y2="${f(y+h)}" stroke="rgba(255,255,255,0.45)" stroke-width="1"/>`);
    parts.push(`<rect x="0" y="${f(y)}" width="${W}" height="${f(h)}" fill="transparent" pointer-events="all"/>`);
    parts.push('</g>');
    y+=h;
  });
  return `<svg width="100%" height="100%" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">${parts.join('')}</svg>`;
}
let totalViewBuilt=false;
function buildTotalView(){
  const container=document.getElementById('totalGrids');
  container.innerHTML='';
  const row=document.createElement('div');
  row.className='total-panels-row';
  const lineCounts=AUTHOR_SLOTS.map(slot=>{
    const {sc}=computeTotalAggregates(slot.key);
    return sc.kami+sc.shimo+sc.imagined+sc.unanalyzed;
  });
  const maxLines=Math.max(...lineCounts)||1;
  AUTHOR_SLOTS.forEach((slot,si)=>{
    const panel=document.createElement('div');
    panel.className='total-panel';
    panel.style.flex=`${lineCounts[si]||1} 1 0`;
    panel.style.minWidth='30px';
    const label=document.createElement('div');
    label.className='author-panel-label';
    label.textContent=slot.label;
    panel.appendChild(label);
    const wrap=document.createElement('div');
    wrap.className='total-bar-wrap';
    wrap.innerHTML=glyphTotalBar(slot.key);
    wrap.querySelectorAll('.total-seg-group').forEach(g=>{
      g.addEventListener('mouseenter',()=>{
        const el=document.getElementById('totalSegInfo');
        if(el) el.textContent=`${g.dataset.label}: ${g.dataset.count} lines`;
      });
      g.addEventListener('mouseleave',()=>{
        const el=document.getElementById('totalSegInfo');
        if(el) el.textContent='';
      });
    });
    panel.appendChild(wrap);
    const countLabel=document.createElement('div');
    countLabel.className='total-panel-count';
    countLabel.textContent=`Total lines: ${lineCounts[si]}`;
    panel.appendChild(countLabel);
    row.appendChild(panel);
  });
  container.appendChild(row);
  const isStruct=viewMode==='structure';
  const leg=document.createElement('div');
  leg.className='author-legend';
  leg.id='totalLegend';
  const structItems=`
    <div class="legend-row"><div class="legend-swatch" style="background:#2E9E6B"></div>Kami-no-ku</div>
    <div class="legend-row"><div class="legend-swatch" style="background:#E5503A"></div>Shimo-no-ku</div>
    <div class="legend-row"><div class="legend-swatch" style="background:#6F63C9"></div>Imagined ku</div>`;
  const devItems=`
    <div class="legend-row"><div class="legend-swatch" style="background:#F28FC0"></div>Kakekotoba</div>
    <div class="legend-row"><div class="legend-swatch" style="background:#7EBBEE"></div>Makurakotoba</div>
    <div class="legend-row"><div class="legend-swatch" style="background:#B4DE65"></div>Kigo</div>`;
  leg.innerHTML=`<div class="author-poem-info" id="totalSegInfo"></div>
    <strong>Legend</strong>${isStruct?structItems:devItems}`;
  container.appendChild(leg);
  totalViewBuilt=true;
}
function refreshTotalView(){
  if(!totalViewBuilt) return;
  totalViewBuilt=false;
  buildTotalView();
}

let layoutMode='poem'; // 'poem' | 'author' | 'total'
function setLayoutMode(mode){
  if(mode===layoutMode) return;
  layoutMode=mode;
  document.getElementById('vtByPoem').classList.toggle('active', mode==='poem');
  document.getElementById('vtByAuthor').classList.toggle('active', mode==='author');
  document.getElementById('vtByTotal').classList.toggle('active', mode==='total');
  document.querySelector('.grid-nav').style.display = mode==='poem' ? 'grid' : 'none';
  document.getElementById('authorGrids').style.display = mode==='author' ? 'flex' : 'none';
  document.getElementById('totalGrids').style.display = mode==='total' ? 'flex' : 'none';
  if(mode==='author' && !authorGridsBuilt) buildAuthorGrids();
  if(mode==='total' && !totalViewBuilt) buildTotalView();
  saveUIState();
}

function nextGridPos(state, gridCols, gridRows){
  while(state.row>=gridRows-1 && state.col<=2){
    state.row++;
    if(state.row>gridRows){state.row=1;state.col--;}
  }
  const pos={row:state.row,col:state.col};
  state.row++;
  if(state.row>gridRows){state.row=1;state.col--;}
  return pos;
}

function computeGridDims(){
  const mobile = window.matchMedia('(max-width:640px)').matches;
  return mobile ? {cols:8, rows:13} : {cols:13, rows:8};
}

let GRID_COLS=13, GRID_ROWS=8;

function buildGrid(){
  const grid=document.getElementById('grid');
  grid.querySelectorAll('.pc').forEach(el=>el.remove());
  const dims=computeGridDims();
  GRID_COLS=dims.cols; GRID_ROWS=dims.rows;
  const state={row:1,col:GRID_COLS};
  POEMS.forEach(poem=>{
    const {row,col}=nextGridPos(state, GRID_COLS, GRID_ROWS);
    const cell=document.createElement('div');
    cell.className='pc'+(poem.real?' analyzed':'');
    cell.tabIndex=0;
    cell.dataset.n=poem.n;
    cell.dataset.row=row;
    cell.dataset.col=col;
    cell.style.gridRow=row;
    cell.style.gridColumn=col;
    cell.setAttribute('aria-label',`Poem ${poem.n}`);
    cell.innerHTML=`<div class="glyph-wrap">${glyph(poem)}</div>`;
    cell.addEventListener('click',e=>onCellClick(e,cell,poem));
    cell.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' ')openModal(poem.n);});
    grid.appendChild(cell);
  });
  buildNavRails();
}

let selRow=1, selCol=1;
let stepperLock=false;

function buildNavRails(){
  const colRail=document.getElementById('colRail');
  const rowRailR=document.getElementById('rowRailRight');
  if(colRail) colRail.innerHTML='';
  if(rowRailR) rowRailR.innerHTML='';
  for(let c=1;c<=GRID_COLS;c++){
    if(!colRail) continue;
    const btn=document.createElement('button');
    btn.className='nav-btn'; btn.type='button'; btn.dataset.col=c; btn.textContent='·';
    btn.addEventListener('click',()=>selectCell(selRow,c));
    colRail.appendChild(btn);
  }
  for(let r=1;r<=GRID_ROWS;r++){
    if(!rowRailR) continue;
    const btn=document.createElement('button');
    btn.className='nav-btn'; btn.type='button'; btn.dataset.row=r; btn.textContent='·';
    btn.addEventListener('click',()=>selectCell(r,selCol));
    rowRailR.appendChild(btn);
  }
  updateRailActive();
}

function updateRailPoem(num){
  document.querySelectorAll('.col-rail .nav-btn.active,.row-rail .nav-btn.active').forEach(b=>{b.textContent=num;});
}

function selectCell(row,col){
  const cell=document.querySelector(`#grid .pc[data-row="${row}"][data-col="${col}"]`);
  if(!cell) return;
  stepperLock=true;
  applyZoom(cell);
}

function updateRailActive(){
  document.querySelectorAll('.col-rail .nav-btn').forEach(b=>b.classList.toggle('active', +b.dataset.col===selCol));
  document.querySelectorAll('.row-rail .nav-btn').forEach(b=>b.classList.toggle('active', +b.dataset.row===selRow));
}

let _lastGridWasMobile=window.matchMedia('(max-width:640px)').matches;
window.addEventListener('resize', ()=>{
  const nowMobile=window.matchMedia('(max-width:640px)').matches;
  if(nowMobile!==_lastGridWasMobile){
    _lastGridWasMobile=nowMobile;
    buildGrid();
  }
});

function updateHdHeight(){
  const hd = document.querySelector('.hd');
  if(hd) document.documentElement.style.setProperty('--hd-h', hd.offsetHeight+'px');
}
updateHdHeight();
window.addEventListener('resize', updateHdHeight);
if(window.ResizeObserver){
  new ResizeObserver(updateHdHeight).observe(document.querySelector('.hd'));
}

function highlightLine(text, wordMap, labelMap, deviceKeyMap){
  if(!wordMap||!Object.keys(wordMap).length) return escHtml(text);
  const words=Object.keys(wordMap).sort((a,b)=>b.length-a.length);
  const re=new RegExp('('+words.map(w=>w.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|')+')','gi');
  return text.replace(re,m=>{
    const key=m.toLowerCase();
    const color=wordMap[key]||'#D4A300';
    const label=labelMap&&labelMap[key];
    const tipAttr=label?` data-tip="${escHtml(label)}"`:'';
    const deviceKey=deviceKeyMap&&deviceKeyMap[key];
    const deviceAttr=deviceKey?` data-device="${escHtml(deviceKey)}"`:'';
    return `<span class="dw-en" style="background:${color}"${tipAttr}${deviceAttr}>${escHtml(m)}</span>`;
  });
}
function escHtml(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

let currentN=null;

function renderJPChars(n, poem){
  const jp=(SRC_JP[String(n)]||'').replace(/\n/g,'');
  const devs=viewMode==='device' ? (SRC_DEVICES[String(n)]||{}) : {};
  const devLabels=viewMode==='device' ? (SRC_DEVICE_LABELS[String(n)]||{}) : {};
  const sorted=Object.keys(devs).sort((a,b)=>b.length-a.length);
  const charColors=new Array(jp.length).fill(null);
  const charWords=new Array(jp.length).fill(null);
  let i=0;
  while(i<jp.length){
    let matched=false;
    for(const w of sorted){
      if(jp.startsWith(w,i)){
        const col=devs[w];
        for(let j=i;j<i+w.length;j++){ charColors[j]=col; charWords[j]=w; }
        i+=w.length;matched=true;break;
      }
    }
    if(!matched) i++;
  }

  const rawJP=SRC_JP[String(n)]||'';
  const verses=rawJP.includes('\n')?rawJP.split('\n'):null;
  let kamiEnd;
  if(verses&&verses.length===5){
    kamiEnd=verses[0].length+verses[1].length+verses[2].length;
  } else {
    kamiEnd=Math.round(jp.length*3/5);
  }

  const spans=[];
  for(let p=0;p<jp.length;p++){
    const dev=charColors[p];
    let style='', tipAttr='', deviceAttr='', runCls='';
    if(dev){
      const isStart = p===0 || charWords[p-1]!==charWords[p];
      const isEnd = p===jp.length-1 || charWords[p+1]!==charWords[p];
      const rTop = isStart?'4px':'0', rBottom = isEnd?'4px':'0';
      style=` style="background:${dev};border-radius:${rTop} ${rTop} ${rBottom} ${rBottom};"`;
      const label=devLabels[charWords[p]];
      if(label) tipAttr=` data-tip="${escHtml(label)}"`;
      deviceAttr=` data-device="${escHtml(charWords[p])}"`;
      runCls=(isStart?' run-start':'')+(isEnd?' run-end':'');
    }
    spans.push(`<span class="jp-ch${runCls}"${style}${tipAttr}${deviceAttr}>${escHtml(jp[p])}</span>`);
  }

  const furiList = SRC_FURIGANA[String(n)] || [];
  const furiRuns=[]; let cursor=0;
  furiList.forEach(entry=>{
    const idx=jp.indexOf(entry.kanji, cursor);
    if(idx===-1) return;
    furiRuns.push({start:idx, end:idx+entry.kanji.length, reading:entry.reading});
    cursor=idx+entry.kanji.length;
  });
  const runIdxByChar=new Array(jp.length).fill(-1);
  furiRuns.forEach((r,ri)=>{ for(let j=r.start;j<r.end;j++) runIdxByChar[j]=ri; });

  let chars=''; let p=0;
  while(p<jp.length){
    const ri=runIdxByChar[p];
    if(ri===-1){ chars+=spans[p]; p++; continue; }
    let q=p;
    while(q<jp.length && runIdxByChar[q]===ri) q++;
    chars+=`<span class="jp-ruby-group">${spans.slice(p,q).join('')}<span class="jp-furigana">${escHtml(furiRuns[ri].reading)}</span></span>`;
    p=q;
  }
  return {html:chars, kamiEnd, total:jp.length};
}

const KANJI_DIGITS=['','一','二','三','四','五','六','七','八','九'];
function toKanjiNumber(n){
  if(n===100) return '百';
  if(n<10) return KANJI_DIGITS[n];
  if(n<20) return '十'+(n%10 ? KANJI_DIGITS[n%10] : '');
  const tens=Math.floor(n/10), ones=n%10;
  return KANJI_DIGITS[tens]+'十'+(ones ? KANJI_DIGITS[ones] : '');
}

function openModal(n){
  currentN=n;
  const poem=POEMS[n-1];
  const csv=CSV[String(n)]||{};
  const hl=viewMode==='device' ? (HIGHLIGHTS[String(n)]||{}) : {};
  const devs=viewMode==='device' ? (SRC_DEVICES[String(n)]||{}) : {};

  const jpP=document.getElementById('jpPanel');
  const {html:jpCharsHTML, kamiEnd, total}=renderJPChars(n, poem);

  const kamiFrac=kamiEnd/total;
  const sbKami=`<div class="jp-sidebar-seg" style="height:${(kamiFrac*100).toFixed(1)}%;background:${C.kami};" data-tip="Kami-no-ku"></div>`;
  const sbShimo=`<div class="jp-sidebar-seg" style="height:${((1-kamiFrac)*100).toFixed(1)}%;background:${C.shimo};" data-tip="Shimo-no-ku"></div>`;

  const legendColors=new Set(Object.values(devs));
  const legendRows=[];
  legendRows.push([C.kami,'Kami-no-ku']);
  legendRows.push([C.shimo,'Shimo-no-ku']);
  const hasImagined=poem.real&&poem.bars.some(b=>b.segs.some(s=>s.type==='imagined'));
  if(hasImagined) legendRows.push([C.imagined,'Imagined ku']);
  if(legendColors.has(C.kakekotoba)||Object.values(hl).some(h=>Object.values(h).includes(C.kakekotoba)))
    legendRows.push([C.kakekotoba,'掛詞 Kakekotoba']);
  if(legendColors.has(C.makurakotoba))
    legendRows.push([C.makurakotoba,'枕詞 Makurakotoba']);
  if(legendColors.has(C.kigo))
    legendRows.push([C.kigo,'季語 Kigo']);

  const legendRowsHTML=legendRows.map(([c,l])=>
    `<div class="lrow"><div class="lsw" style="background:${c}"></div>${escHtml(l)}</div>`
  ).join('');

  jpP.innerHTML=`
    <div class="jp-scroll">
      <div class="jp-inner">
        <div class="jp-sidebar">${sbKami}${sbShimo}</div>
        <div class="jp-chars-area"><div class="jp-chars">${jpCharsHTML}</div></div>
      </div>
    </div>
    <div class="title-jp">百人一首の${toKanjiNumber(n)}番</div>
  `;
  let legEl=document.getElementById('modalLegend');
  if(!legEl){
    legEl=document.createElement('div');
    legEl.id='modalLegend';
    legEl.className='jp-legend';
    document.getElementById('overlay').appendChild(legEl);
  }
  legEl.innerHTML=`<div class="lgd-title">Legend</div><div class="lgd-items">${legendRowsHTML}</div>`;

  const MODAL_ORDER=['D','M','N','P'];
  const kuColor={kami:C.kami,shimo:C.shimo,imagined:C.imagined};
  const enP=document.getElementById('enPanel');
  const kuLabel={kami:'Kami-no-ku',shimo:'Shimo-no-ku',imagined:'Imagined line'};
  const blocks=MODAL_ORDER.map(lbl=>{
    const lines=csv[lbl]||[];
    const wordMap=hl[lbl]||{};
    const labelMap=viewMode==='device' ? ((HIGHLIGHT_LABELS[String(n)]||{})[lbl]||{}) : {};
    const deviceKeyMap=viewMode==='device' ? ((HIGHLIGHT_DEVICE_KEYS[String(n)]||{})[lbl]||{}) : {};
    const bar=poem.real?poem.bars.find(b=>b.lbl===lbl):null;
    const segs=bar?bar.segs:null;
    const linesHTML=lines.map((ln,li)=>{
      const type=segs&&segs[li]?segs[li].type:null;
      const uc=type?kuColor[type]:'transparent';
      const lineTipAttr=type?` data-tip="${kuLabel[type]}"`:'';
      return `<div class="tl-row"><span class="tl" style="border-bottom-color:${uc}"${lineTipAttr}>${highlightLine(ln,wordMap,labelMap,deviceKeyMap)}</span></div>`;
    }).join('');
    return `<div class="trans-block">
      <div class="trans-label">${TRANS_NAMES[lbl]}</div>
      <div class="trans-lines">${linesHTML||'<span class="no-data">—</span>'}</div>
    </div>`;
  }).join('');

  enP.innerHTML=`<div class="trans-grid">${blocks}</div>`;
  const titleEl=document.getElementById('modalTitle');
  titleEl.innerHTML=`<div class="modal-title-main">${escHtml(csv.poet||'')}</div><div class="modal-title-sub">Poem ${n}</div>`;

  document.getElementById('overlay').classList.add('open');
  document.getElementById('mPrev').disabled=n<=1;
  document.getElementById('mNext').disabled=n>=100;
  saveUIState();
}

function closeModal(){document.getElementById('overlay').classList.remove('open');currentN=null;saveUIState();}
function navModal(d){if(currentN)openModal(Math.max(1,Math.min(100,currentN+d)));}

document.getElementById('mClose').addEventListener('click',closeModal);
document.getElementById('mPrev').addEventListener('click',()=>navModal(-1));
document.getElementById('mNext').addEventListener('click',()=>navModal(1));
document.addEventListener('keydown',e=>{
  if(introOverlay.classList.contains('open')) return;
  if(e.key==='Escape')closeModal();
  if(e.key==='ArrowLeft')navModal(-1);
  if(e.key==='ArrowRight')navModal(1);
  if(e.key==='ArrowDown' && currentN && zoomedCell){
    closeModal();
    stepZoom(-1);
  }
});
document.getElementById('overlay').addEventListener('click',e=>{
  if(e.target===e.currentTarget)closeModal();
});

// Swipe left/right in the modal to go to next/prev poem
(()=>{
  const ov=document.getElementById('overlay');
  let tx=0,ty=0;
  ov.addEventListener('touchstart',e=>{tx=e.changedTouches[0].clientX;ty=e.changedTouches[0].clientY;},{passive:true});
  ov.addEventListener('touchend',e=>{
    const dx=e.changedTouches[0].clientX-tx;
    const dy=e.changedTouches[0].clientY-ty;
    if(Math.abs(dx)>Math.abs(dy)&&Math.abs(dx)>44) navModal(dx<0?1:-1);
  },{passive:true});
})();

function setViewMode(mode){
  if(mode===viewMode) return;
  viewMode = mode;
  document.getElementById('vtStructure').classList.toggle('active', mode==='structure');
  document.getElementById('vtDevice').classList.toggle('active', mode==='device');
  document.querySelector('.legend').classList.toggle('structure-only', mode==='structure');
  const aleg=document.getElementById('authorLegend');
  if(aleg) aleg.classList.toggle('structure-only', mode==='structure');
  document.querySelectorAll('#grid .pc').forEach(cell=>{
    if(cell===zoomedCell) return;
    const poem = POEMS[+cell.dataset.n - 1];
    cell.querySelector('.glyph-wrap').innerHTML = glyph(poem);
  });
  if(zoomedCell) applyCellZoomTier(zoomedCell);
  refreshAuthorGrids();
  refreshTotalView();
  if(currentN) openModal(currentN);
  saveUIState();
}
document.getElementById('vtStructure').addEventListener('click', ()=>setViewMode('structure'));
document.getElementById('vtDevice').addEventListener('click', ()=>setViewMode('device'));
document.getElementById('vtByPoem').addEventListener('click', ()=>setLayoutMode('poem'));
document.getElementById('vtByAuthor').addEventListener('click', ()=>setLayoutMode('author'));
document.getElementById('vtByTotal').addEventListener('click', ()=>setLayoutMode('total'));

function jumpToPoem(n){
  if(layoutMode!=='poem') setLayoutMode('poem');
  const cell=document.querySelector(`#grid .pc[data-n="${n}"]`);
  if(!cell) return;
  stepperLock=true;
  applyZoom(cell);
  openModal(n);
}
const poemJump=document.getElementById('poemJump');
poemJump.addEventListener('keydown',e=>{
  if(e.key==='Enter'){const n=+e.currentTarget.value;if(n>=1&&n<=100){jumpToPoem(n);e.currentTarget.blur();}}
});
poemJump.addEventListener('change',e=>{
  const n=+e.currentTarget.value;if(n>=1&&n<=100) jumpToPoem(n);
});

const gw = document.getElementById('gw');
const grid = document.getElementById('grid');

const ZOOM_STEP = 25;
function stepZoom(dir){
  if(dir>0){
    if(zoomLevel<25) setZoomLevel(25);
    else if(zoomLevel<75) setZoomLevel(75);
    else setZoomLevel(100);
  } else {
    if(zoomLevel>75) setZoomLevel(75);
    else if(zoomLevel>25) setZoomLevel(25);
    else setZoomLevel(0);
  }
}

function windowForLevel(val){
  if(val>=75) return {cols:3, rows:1};
  if(val>=50) return {cols:5, rows:3};
  if(val>0)   return {cols:7, rows:5};
  return {cols:GRID_COLS, rows:GRID_ROWS};
}
let zoomedCell = null;
let zoomTier = 'none'; // 'none' | 'book'
let zoomLevel = 0;
let zoomTx = 0, zoomTy = 0;
let lastAppliedScale = 1;
let nativeCellPx = 82;
let restingGridW = 0, restingGridH = 0;

function clearZoom(){
  if(zoomedCell) restoreCellGlyph(zoomedCell);
  zoomedCell = null;
  grid.style.transitionDuration = '0s';
  grid.getBoundingClientRect();
  grid.style.transform = '';
  grid.style.transformOrigin = '';
  grid.style.transitionDuration = '';
  zoomLevel = 0;
  zoomTier = 'none';
  grid.classList.remove('zoom-active');
  lastAppliedScale = 1;
}

function applyZoom(cell){
  if(cell === zoomedCell) return;
  if(zoomedCell) restoreCellGlyph(zoomedCell);
  grid.style.transitionDuration = '0s';
  grid.style.transform = '';
  grid.getBoundingClientRect(); // force layout flush
  zoomedCell = cell;
  const col = +cell.dataset.col, row = +cell.dataset.row;
  selCol = col; selRow = row;
  updateRailActive();
  updateRailPoem(+cell.dataset.n);
  const cellRect = cell.getBoundingClientRect();
  nativeCellPx = cellRect.width;
  const gridRect = grid.getBoundingClientRect();
  restingGridW = gridRect.width;
  restingGridH = gridRect.height;
  const fx = cellRect.left - gridRect.left + cellRect.width/2;
  const fy = cellRect.top - gridRect.top + cellRect.height/2;
  zoomTx = (restingGridW/2) - fx;
  zoomTy = (restingGridH/2) - fy;
  grid.style.transformOrigin = `${f(fx)}px ${f(fy)}px`;
  cell.classList.add('zoomed');
  zoomTier = 'none';
  zoomLevel = 0;
  lastAppliedScale = 1;
  grid.classList.remove('zoom-active');
  applyCellZoomTier(cell);
  grid.style.transitionDuration = '';
}

function setZoomLevel(val){
  val = Math.max(0, Math.min(100, val));
  const prevLevel = zoomLevel;
  zoomTier = val>=50 ? 'book' : (val>0 ? 'bars' : 'none');
  zoomLevel = val;
  grid.classList.toggle('zoom-active', val>0);
  if(val===0){
    grid.style.transform = '';
    lastAppliedScale = 1;
  } else {
    const win = windowForLevel(val);
    let scale = Math.min(
      (restingGridW*0.98) / (nativeCellPx*win.cols),
      (restingGridH*0.98) / (nativeCellPx*win.rows)
    );
    if(val > prevLevel) scale = Math.max(scale, lastAppliedScale);
    lastAppliedScale = scale;
    grid.style.transform = `translate(${f(zoomTx)}px, ${f(zoomTy)}px) scale(${scale})`;
  }
  if(zoomedCell) applyCellZoomTier(zoomedCell);
  if(val>=100 && prevLevel<100 && zoomedCell) openModal(+zoomedCell.dataset.n);
}

function shrinkToFitAll(wrap){
  const body = wrap.querySelector('.zc-body');
  if(!body) return;
  const texts = [...wrap.querySelectorAll('.zc-book-lines, .zc-book-lbl')];
  const header = wrap.querySelector('.zc-book-title');
  const jpText = wrap.querySelector('.gz-text');
  if(!texts.length) return;
  const jpOverflows = () => jpText && (
    jpText.scrollHeight > jpText.clientHeight + 0.5 ||
    jpText.scrollWidth > jpText.clientWidth + 0.5
  );
  let guard = 0;
  while((body.scrollHeight > body.clientHeight + 0.5 || jpOverflows()) && guard < 100){
    let shrunkAny = false;
    if(jpOverflows()){
      const cur = parseFloat(getComputedStyle(jpText).fontSize);
      const next = Math.max(1, cur*0.94);
      if(next < cur){ jpText.style.fontSize = next.toFixed(2)+'px'; shrunkAny = true; }
    }
    if(body.scrollHeight > body.clientHeight + 0.5){
      texts.forEach(el=>{
        const cur = parseFloat(getComputedStyle(el).fontSize);
        const next = Math.max(0.4, cur*0.94);
        if(next < cur){ el.style.fontSize = next.toFixed(2)+'px'; shrunkAny = true; }
      });
      if(header){
        const cur = parseFloat(getComputedStyle(header).fontSize);
        const next = Math.max(0.6, cur*0.92);
        if(next < cur){ header.style.fontSize = next.toFixed(2)+'px'; shrunkAny = true; }
      }
    }
    if(!shrunkAny) break;
    guard++;
  }
}

function applyCellZoomTier(cell){
  const poem = POEMS[+cell.dataset.n - 1];
  const wrap = cell.querySelector('.glyph-wrap');
  wrap.style.opacity = '0';
  if(zoomTier==='none'){
    const poet = (CSV[String(poem.n)]||{}).poet || '';
    wrap.innerHTML = `<div class="zc-hover-lbl">Poem ${poem.n}: ${escHtml(poet)}</div>`;
  } else if(zoomTier==='bars'){
    wrap.innerHTML = glyph(poem, true);
  } else {
    wrap.innerHTML = renderZoomCard(poem, nativeCellPx, nativeCellPx);
    shrinkToFitAll(wrap);
  }
  requestAnimationFrame(()=>{ wrap.style.opacity = '1'; });
}

function restoreCellGlyph(cell){
  cell.classList.remove('zoomed');
  const poem = POEMS[+cell.dataset.n - 1];
  cell.querySelector('.glyph-wrap').innerHTML = glyph(poem);
}

function buildJpMarkup(n){
  const jpRaw = SRC_JP[String(n)] || '';
  const jp = jpRaw.replace(/\n/g,'');
  if(!jp) return null;
  const devs = viewMode==='device' ? (SRC_DEVICES[String(n)]||{}) : {};
  const devLabels = viewMode==='device' ? (SRC_DEVICE_LABELS[String(n)]||{}) : {};
  const sorted = Object.keys(devs).sort((a,b)=>b.length-a.length);
  const charColors = new Array(jp.length).fill(null);
  const charWords = new Array(jp.length).fill(null);
  let i=0;
  while(i<jp.length){
    let matched=false;
    for(const w of sorted){
      if(jp.startsWith(w,i)){
        const col=devs[w];
        for(let j=i;j<i+w.length;j++){ charColors[j]=col; charWords[j]=w; }
        i+=w.length; matched=true; break;
      }
    }
    if(!matched) i++;
  }
  const chars = jp.split('').map((ch,idx)=>{
    const dev = charColors[idx];
    if(!dev) return `<span class="gz-ch">${escHtml(ch)}</span>`;
    const isStart = idx===0 || charWords[idx-1]!==charWords[idx];
    const isEnd = idx===jp.length-1 || charWords[idx+1]!==charWords[idx];
    const rTop = isStart?'2px':'0', rBottom = isEnd?'2px':'0';
    const label = devLabels[charWords[idx]];
    const tipAttr = label ? ` data-tip="${escHtml(label)}"` : '';
    const deviceAttr = ` data-device="${escHtml(charWords[idx])}"`;
    const runCls = (isStart?' run-start':'')+(isEnd?' run-end':'');
    return `<span class="gz-ch${runCls}" style="background:${dev};border-radius:${rTop} ${rTop} ${rBottom} ${rBottom};"${tipAttr}${deviceAttr}>${escHtml(ch)}</span>`;
  }).join('');
  const verses = jpRaw.includes('\n') ? jpRaw.split('\n') : null;
  const kamiEnd = (verses && verses.length===5)
    ? verses[0].length+verses[1].length+verses[2].length
    : Math.round(jp.length*3/5);
  return {chars, kamiFrac: kamiEnd/jp.length, len: jp.length};
}

function renderZcBook(poem, availW, availH){
  const n = poem.n;
  const csv = CSV[String(n)] || {};
  const poet = csv.poet || '';
  const markup = buildJpMarkup(n);
  if(!markup || !poem.real){
    return `<div class="zc-bars">${glyph(poem)}</div>`;
  }

  const uiScale = Math.max(0.06, Math.min(1, availH/300));
  const jpFontSize = Math.max(uiScale*1.4, Math.min(11, (availH*0.95) / (markup.len*0.95)));
  const sidebar = `<div class="gz-sidebar" style="width:${Math.max(1, 3*uiScale).toFixed(2)}px;">
    <div class="gz-sb-seg" style="height:${(markup.kamiFrac*100).toFixed(1)}%;background:${C.kami}"></div>
    <div class="gz-sb-seg" style="height:${((1-markup.kamiFrac)*100).toFixed(1)}%;background:${C.shimo}"></div>
  </div>`;
  const jpCol = `<div class="zc-book-jp" style="gap:${(4*uiScale).toFixed(2)}px;">${sidebar}<div class="gz-text" style="font-size:${jpFontSize.toFixed(2)}px;">${markup.chars}</div></div>`;
  const numCol = `<div class="zc-book-num">百人一首の${toKanjiNumber(n)}番</div>`;

  const hl = viewMode==='device' ? (HIGHLIGHTS[String(n)]||{}) : {};
  const kuColor = {kami:C.kami, shimo:C.shimo, imagined:C.imagined};
  const order = ['D','N','P','M'];
  const linesFontSize = Math.max(1, Math.min(7, availH*0.07));
  const lblFontSize = Math.max(1, Math.min(6, availH*0.06));
  const blocks = order.map(lbl=>{
    const lines = csv[lbl]||[];
    const wordMap = hl[lbl]||{};
    const labelMap = viewMode==='device' ? ((HIGHLIGHT_LABELS[String(n)]||{})[lbl]||{}) : {};
    const deviceKeyMap = viewMode==='device' ? ((HIGHLIGHT_DEVICE_KEYS[String(n)]||{})[lbl]||{}) : {};
    const bar = poem.bars.find(b=>b.lbl===lbl);
    const segs = bar ? bar.segs : null;
    const linesHTML = lines.map((ln,li)=>{
      const type = segs&&segs[li]?segs[li].type:null;
      const uc = type?kuColor[type]:'transparent';
      return `<div class="zc-book-line" style="border-bottom-color:${uc};">${highlightLine(ln,wordMap,labelMap,deviceKeyMap)}</div>`;
    }).join('');
    return `<div class="zc-book-block"><div class="zc-book-lbl" style="font-size:${lblFontSize.toFixed(2)}px;">${escHtml(TRANS_NAMES[lbl])}</div><div class="zc-book-lines" style="font-size:${linesFontSize.toFixed(2)}px;">${linesHTML}</div></div>`;
  }).join('');

  const titleFontSize = Math.max(1.5, Math.min(9, availH*0.09));
  const enCol = `<div class="zc-book-en" style="gap:${(6*uiScale).toFixed(2)}px;">
    <div class="zc-book-title" style="font-size:${titleFontSize.toFixed(2)}px;margin-bottom:${(2*uiScale).toFixed(2)}px;">Poem ${n}: ${escHtml(poet)}</div>
    ${blocks}
  </div>`;

  return `<div class="zc-book" style="gap:${(10*uiScale).toFixed(2)}px;">${jpCol}${numCol}<div class="zc-book-divider"></div>${enCol}</div>`;
}

function renderZoomCard(poem, cardW, cardH){
  const body = renderZcBook(poem, cardW, cardH);
  const pad = Math.max(1, cardW*0.03).toFixed(1);
  const gap = Math.max(1, cardW*0.02).toFixed(1);
  return `<div class="zc-card" style="width:${cardW.toFixed(1)}px;height:${cardH.toFixed(1)}px;"><div class="zc-body" style="padding:${pad}px;gap:${gap}px;">${body}</div></div>`;
}

function onGridMouseMove(e){
  const hovered = document.elementFromPoint(e.clientX, e.clientY)?.closest('#grid .pc');
  if(!hovered){ clearZoom(); return; }
  applyZoom(hovered);
}

function onCellClick(e, cell, poem){
  openModal(poem.n);
}

gw.addEventListener('mousemove', onGridMouseMove);
gw.addEventListener('mouseenter', ()=>{ stepperLock=false; });
gw.addEventListener('mouseleave', ()=>{ if(!stepperLock) clearZoom(); });
window.addEventListener('resize', clearZoom);

document.addEventListener('keydown', e=>{
  if(document.getElementById('overlay').classList.contains('open')) return;
  if(introOverlay.classList.contains('open')) return;
  if(!zoomedCell) return;
  if(e.key==='ArrowUp' || e.key==='ArrowDown'){
    e.preventDefault();
    stepZoom(e.key==='ArrowUp' ? 1 : -1);
    return;
  }
  const deltas = {ArrowRight:[0,1], ArrowLeft:[0,-1]};
  const d = deltas[e.key];
  if(!d) return;
  e.preventDefault();
  let row = +zoomedCell.dataset.row + d[0];
  let col = +zoomedCell.dataset.col + d[1];
  const next = document.querySelector(`#grid .pc[data-row="${row}"][data-col="${col}"]`);
  if(next) applyZoom(next);
});

const INTRO_SEEN_KEY = 'hyakuninIntroSeen';
const UI_STATE_KEY = 'hyakuninUIState';
function saveUIState(){ try{ localStorage.setItem(UI_STATE_KEY, JSON.stringify({view:viewMode,layout:layoutMode,poem:currentN})); }catch(e){} }

const INTRO_GLANCE_NOS = [3, 4, 1, 2];

const DOT_COLORS = ['#2E9E6B','#E5503A','#6F63C9','#F28FC0','#7EBBEE','#B4DE65'];

window._introViewMode = 'device';
window.setIntroPoemInfo = function(n, poet){
  const el = document.getElementById('introGlanceInfo');
  if(!el) return;
  el.innerHTML = n
    ? `<div class="igpi-n">Poem ${n}:</div><div class="igpi-poet">${poet}</div>`
    : '<div class="igpi-hint">hover a poem</div>';
};
window.switchIntroView = function(mode){
  window._introViewMode = mode;
  const prev = viewMode;
  viewMode = mode;
  document.querySelectorAll('.intro-mgc[data-n]').forEach(el=>{
    const poem = POEMS[+el.dataset.n - 1];
    if(poem) el.innerHTML = glyph(poem, false);
  });
  const barCell = document.getElementById('introBarCell');
  if(barCell) barCell.innerHTML = glyph(POEMS[0], true);
  viewMode = prev;
  document.querySelectorAll('.intro-step.active .vt-btn[data-mode]').forEach(btn=>{
    btn.classList.toggle('active', btn.dataset.mode===mode);
  });
};
window.introZoomStep = function(dir){
  const cell = document.getElementById('introZoomCell');
  if(!cell) return;
  const cur = +(cell.dataset.zoom||0);
  const next = Math.max(0, Math.min(1, cur+dir));
  if(next===cur) return;
  cell.dataset.zoom = next;
  cell.classList.toggle('zoomed', next>0);
  const poem = POEMS[0];
  const prev = viewMode;
  viewMode = window._introViewMode||'device';
  cell.innerHTML = glyph(poem, next>0);
  viewMode = prev;
};
const INTRO_STEPS = [
  {
    title: 'Introduction',
    body: `<p>This project compares four historic English translations of the <em>Ogura Hyakunin Isshu</em> (OHI), a 13th century Japanese anthology of 100 waka poems, each by a different classical poet.</p>
      <p>The visualization approach is inspired by genomic synteny analysis: a method for studying the relationship between species that once shared a common ancestor.</p>
      <p>This walkthrough explains how to read and interact with the visualization.</p>`
  },
  {
    title: '4 Translations of OHI',
    body: `<p>Translators Dickins (1866), MacCauley (1899), Noguchi (1907), and Porter (1909) each rendered all 100 poems of the OHI into English.</p>
      <figure style="margin:.4rem 0 0;">
        <div class="intro-poem-grid-4">
          <div class="intro-poem-block">
            <div class="intro-poem-lbl">Dickins 1866</div>
            ${(CSV['34'].D||[]).slice(0,1).map(l=>`<div>${escHtml(l)}</div>`).join('')}
          </div>
          <div class="intro-poem-block">
            <div class="intro-poem-lbl">MacCauley 1899</div>
            ${(CSV['34'].M||[]).slice(0,1).map(l=>`<div>${escHtml(l)}</div>`).join('')}
          </div>
          <div class="intro-poem-block">
            <div class="intro-poem-lbl">Noguchi 1907</div>
            ${(CSV['34'].N||[]).slice(0,1).map(l=>`<div>${escHtml(l)}</div>`).join('')}
          </div>
          <div class="intro-poem-block">
            <div class="intro-poem-lbl">Porter 1909</div>
            ${(CSV['34'].P||[]).slice(0,1).map(l=>`<div>${escHtml(l)}</div>`).join('')}
          </div>
        </div>
        <figcaption class="intro-poem-caption">Poem 34: opening line for four translations</figcaption>
      </figure>`
  },
  {
    title: 'Encoding Literary Structure and Devices',
    body: `<p>Each translation becomes a vertical bar ordered by initial publishing date and labelled with the translators' last name initials. Toggle to view just structure, or structure and literary devices:</p>
      <div style="display:flex;justify-content:center;padding:.45rem 0 .2rem;">
        <div class="intro-zoom-cell" id="introBarCell" style="width:120px;height:120px;">${(()=>{const p=viewMode;viewMode='device';const r=glyph(POEMS[0],true);viewMode=p;return r;})()}</div>
      </div>
      <div class="view-toggle" role="group">
        <button class="vt-btn" data-mode="structure" onclick="switchIntroView('structure')">Structure</button>
        <button class="vt-btn active" data-mode="device" onclick="switchIntroView('device')">Devices</button>
      </div>
      <div class="intro-swatches" style="margin-top:.5rem;">
        <div class="intro-swatch-row"><strong style="color:${C.kami}">Kami-no-ku:</strong> Upper section, lines 1–3 (5-7-5)</div>
        <div class="intro-swatch-row"><strong style="color:${C.shimo}">Shimo-no-ku:</strong> Lower section, lines 4–5 (7-7)</div>
        <div class="intro-swatch-row"><strong style="color:${C.imagined}">Imagined ku:</strong> No mapping in the source</div>
      </div>
      <div class="intro-swatches intro-devices-swatches" style="margin-top:.35rem;">
        <div class="intro-swatch-row"><strong style="color:${C.kakekotoba}">Kakekotoba:</strong> Pivot word carrying two meanings</div>
        <div class="intro-swatch-row"><strong style="color:${C.makurakotoba}">Makurakotoba:</strong> Fixed ornamental pillow word</div>
        <div class="intro-swatch-row"><strong style="color:${C.kigo}">Kigo:</strong> Seasonal reference word</div>
      </div>`
  },
  {
    title: 'Viewing all Poems',
    body: `<p>The main page shows all 100 poems. Each column is one poem including its source text and four translations. Hover to see poem and poet.</p>
      <div class="intro-poem-grid-2x2" id="introGlancePoems">
        ${INTRO_GLANCE_NOS.map(n=>{
          const poem=POEMS[n-1];
          const poet=(CSV[String(n)]||{}).poet||'';
          return `<div class="intro-mgc" data-n="${n}" data-label="Poem ${n} · ${poet}">${glyph(poem,false)}</div>`;
        }).join('')}
      </div>`
  },
  {
    title: 'Navigating the Poems',
    body: `<p><strong>Zoom:</strong> hover any poem and press ↑ to expand it iteratively until opening to the full text — each bar's proportions show how many lines the translator used. Press ↓ to return.</p>
      <p><strong>Click</strong> any poem to open the full text containing the original Japanese, four translations, and a breakdown of literary choices. ← → or arrow keys move between poems; Esc closes this view.</p>
      <p><strong>By Author</strong> shows one translator's complete 100-poem output. <strong>By Total</strong> aggregates across all poems.</p>`
  },
  {
    title: "That's all for now!",
    body: `<p>You now have everything you need to read the visualization. Each of the 100 poems carries its own history of interpretation through visually showing where translators agreed, diverged, or invented lines.</p>
      <p>For background on the anthology, waka poetry, and the methodology behind this project, visit the <a href="about.html" style="color:inherit;text-decoration:underline;text-underline-offset:2px;">about page</a>.</p>
      <p style="margin-top:1.2rem;text-align:center;font-size:.8rem;color:#aaa;">Press <strong style="color:#555">Get Started</strong> to begin.</p>`
  },
];

const introOverlay = document.getElementById('introOverlay');
const introStepsEl = document.getElementById('introSteps');
const introDotsEl = document.getElementById('introDots');
const introBackBtn = document.getElementById('introBack');
const introNextBtn = document.getElementById('introNext');
const introCloseBtn = document.getElementById('introClose');
const helpBtn = document.getElementById('helpBtn');
let introIdx = 0;

function renderIntro(){
  const titleEl = document.getElementById('introTitle');
  if(titleEl) titleEl.textContent = INTRO_STEPS[introIdx].title;
  introStepsEl.innerHTML = INTRO_STEPS.map((s,i)=>
    `<div class="intro-step${i===introIdx?' active':''}">${s.body}</div>`
  ).join('');
  introDotsEl.innerHTML = INTRO_STEPS.map((_,i)=>
    `<div class="intro-dot${i===introIdx?' active':''}" style="--dc:${DOT_COLORS[i]}"></div>`
  ).join('');
  introBackBtn.disabled = introIdx===0;
  const arrowOnly = introNextBtn.classList.contains('intro-arrow-btn');
  if(!arrowOnly){
    introNextBtn.textContent = introIdx===INTRO_STEPS.length-1 ? 'Get Started' : 'Next →';
    introBackBtn.textContent = '← Previous';
  }
}
function showIntro(){
  introIdx = 0;
  renderIntro();
  introOverlay.classList.add('open');
}
function closeIntro(){
  introOverlay.classList.remove('open');
  try{ localStorage.setItem(INTRO_SEEN_KEY, '1'); }catch(e){}
}
introNextBtn.addEventListener('click', ()=>{
  if(introIdx < INTRO_STEPS.length-1){ introIdx++; renderIntro(); }
  else closeIntro();
});
introBackBtn.addEventListener('click', ()=>{
  if(introIdx > 0){ introIdx--; renderIntro(); }
});
if(introCloseBtn) introCloseBtn.addEventListener('click', closeIntro);
helpBtn.addEventListener('click', showIntro);

introStepsEl.addEventListener('mouseover', e=>{
  const cell = e.target.closest('.intro-mgc[data-n]');
  if(!cell || cell._hovered) return;
  cell._hovered = true;
  const n = +cell.dataset.n;
  const poet = (CSV[String(n)]||{}).poet||'';
  cell.innerHTML = `<div class="zc-hover-lbl">Poem ${n}<br>${escHtml(poet)}</div>`;
});
introStepsEl.addEventListener('mouseout', e=>{
  const cell = e.target.closest('.intro-mgc[data-n]');
  if(!cell) return;
  if(cell.contains(e.relatedTarget)) return;
  cell._hovered = false;
  const poem = POEMS[+cell.dataset.n - 1];
  if(!poem) return;
  const prev = viewMode;
  viewMode = window._introViewMode || viewMode;
  cell.innerHTML = glyph(poem, false);
  viewMode = prev;
});
document.addEventListener('keydown', e=>{
  if(!introOverlay.classList.contains('open')) return;
  if(e.key==='Escape') closeIntro();
  if(e.key==='ArrowRight') introNextBtn.click();
  if(e.key==='ArrowLeft' && introIdx>0){ introIdx--; renderIntro(); }
});

let introAlreadySeen = false;
try{ introAlreadySeen = !!localStorage.getItem(INTRO_SEEN_KEY); }catch(e){}
if(!introAlreadySeen && !new URLSearchParams(location.search).has('noIntro')) showIntro();

const hoverTip = document.getElementById('hoverTip');
let activeTipEl = null;
let glowingEls = [];
let lastGlowKey = null;

function clearGlow(){
  glowingEls.forEach(el=>el.classList.remove('glow'));
  glowingEls = [];
}

function positionTip(el){
  const rect = el.getBoundingClientRect();
  const gap = 10;
  hoverTip.style.left = (rect.right + gap) + 'px';
  hoverTip.style.top = (rect.top + rect.height/2) + 'px';
  requestAnimationFrame(()=>{
    const tipRect = hoverTip.getBoundingClientRect();
    if(tipRect.right > window.innerWidth - 8){
      hoverTip.style.left = (rect.left - gap) + 'px';
      hoverTip.classList.add('flip');
    } else {
      hoverTip.classList.remove('flip');
    }
  });
}

document.addEventListener('mouseover', e=>{
  const el = e.target.closest('[data-tip]');
  if(!el) return;

  if(el !== activeTipEl){
    activeTipEl = el;
    hoverTip.textContent = el.dataset.tip;
    hoverTip.classList.add('show');
    hoverTip.classList.remove('flip');
    positionTip(el);
  }

  const key = e.target.closest('[data-device]')?.dataset.device || el.dataset.device || null;
  if(key !== lastGlowKey){
    lastGlowKey = key;
    clearGlow();
    if(key){
      glowingEls = [...document.querySelectorAll(`[data-device="${CSS.escape(key)}"]`)];
      glowingEls.forEach(g=>g.classList.add('glow'));
    }
  }
});
document.addEventListener('mouseout', e=>{
  const leavingTip = e.target.closest('[data-tip]');
  const enteringTip = e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('[data-tip]');
  if(leavingTip && leavingTip!==enteringTip){
    activeTipEl = null;
    lastGlowKey = null;
    hoverTip.classList.remove('show');
    clearGlow();
  }
});

buildGrid();

try {
  const saved = JSON.parse(localStorage.getItem(UI_STATE_KEY)||'{}');
  if(saved.view && saved.view !== viewMode) setViewMode(saved.view);
  if(saved.layout && saved.layout !== layoutMode) setLayoutMode(saved.layout);
  if(saved.poem) openModal(saved.poem);
} catch(e) {}

// URL params override localStorage (for shareable / embeddable links)
try {
  const p = new URLSearchParams(location.search);
  const hasParams = p.has('view') || p.has('layout') || p.has('poem');
  if(p.has('view')) setViewMode(p.get('view'));
  if(p.has('layout')) setLayoutMode(p.get('layout'));
  if(p.has('poem')) openModal(+p.get('poem'));
  else if(hasParams) closeModal();
} catch(e) {}
}
