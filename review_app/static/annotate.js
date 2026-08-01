// ── Data loading ─────────────────────────────────────────────────────────
// Same computed dataset as the artifact/site (via /api/data, live from the
// current annotation files — not a static poems.json snapshot), plus a
// per-poem corrections overlay fetched lazily when a poem's modal opens.
let C, CSV, SRC_JP, SRC_DEVICES, HIGHLIGHTS, REAL_DATA;
// SRC_DEVICE_LABELS: source JP word -> hover-tooltip string (e.g. "Kigo —
// Autumn"). HIGHLIGHT_LABELS: same, but keyed by translator label -> EN
// phrase. HIGHLIGHT_DEVICE_KEYS: translator label -> EN phrase -> the SAME
// source JP word SRC_DEVICE_LABELS uses — this is what ties one device's JP
// characters to its rendering in all four translators' English.
let SRC_DEVICE_LABELS, HIGHLIGHT_LABELS, HIGHLIGHT_DEVICE_KEYS;
let corrections = {}; // { [poemNumber]: correctionsDoc }
let reasoning = {};   // { [poemNumber]: {source, translations} raw annotation JSON }
let notes = {};       // { [poemNumber]: {general, ku:{"1":...,...,"5":...}} }

async function loadReasoningFor(n){
  if(reasoning[n]) return reasoning[n];
  const res = await fetch(`/api/reasoning/${n}`);
  const data = await res.json();
  reasoning[n] = data;
  return data;
}

async function loadNotesFor(n){
  if(notes[n]) return notes[n];
  const res = await fetch(`/api/notes/${n}`);
  const data = await res.json();
  notes[n] = data;
  return data;
}

// Top-level (not inside init()'s closure) since it's called both before
// init() runs and from within it, after every correction is saved.
async function refreshAccuracyBadge(){
  try{
    const res = await fetch('/api/accuracy');
    const data = await res.json();
    const badge = document.getElementById('accuracyBadge');
    if(!badge) return;
    if(!data.total){
      badge.textContent = 'No reviews logged yet';
    } else {
      badge.textContent = `${data.total} reviewed · ${data.confirmed_rate_pct}% confirmed as-is`;
    }
  }catch(e){}
}

fetch('/api/data')
  .then(r => r.json())
  .then(data => {
    ({C, CSV, SRC_JP, SRC_DEVICES, HIGHLIGHTS, REAL_DATA,
      SRC_DEVICE_LABELS, HIGHLIGHT_LABELS, HIGHLIGHT_DEVICE_KEYS} = data);
    init();
    refreshAccuracyBadge();
  })
  .catch(err => {
    document.getElementById('grid').innerHTML =
      '<p style="padding:2rem;color:#b23a12;">Failed to load /api/data — ' + err + '</p>';
  });

function init(){

const DCOLORS=[C.kakekotoba,C.makurakotoba,C.kigo];

const TRANS_LBLS=['D','N','M','P'];
const TRANS_NAMES={D:'F.V. Dickens 1866',N:'Noguchi 1907',M:'MacCauley 1917',P:'Porter 1909'};
const TRANS_FULLNAME={D:'Dickens',N:'Noguchi',M:'McCauley',P:'Porter'};

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

const POEMS=Array.from({length:100},(_,i)=>{
  const n=i+1;
  return REAL_DATA[n]||mkPlaceholder(n);
});

const DIM=82;
const SVG_W_BARS=82;
const BAR_X=[0, 23, 40, 57, 74];
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
      const span = {start: pos/total, end: (pos+word.length)/total};
      (byColor[color] = byColor[color]||[]).push(span);
    });
  return byColor;
}

function gridDeviceColor(dc){
  return dc;
}

function glyph(poem){
  const maxLines=Math.max(...poem.bars.map(b=>b.nLines));
  const jpFracs = poem.real ? jpDeviceFracs(poem.n) : {};
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
    if(bi===0 && poem.real && Object.keys(jpFracs).length>0){
      Object.entries(jpFracs).forEach(([dc,spans])=>{
        spans.forEach(({start,end})=>{
          parts.push(`<rect x="${x}" y="${f(start*bh)}" width="${bw}" height="${f((end-start)*bh)}" fill="${gridDeviceColor(dc)}"/>`);
        });
      });
    } else {
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
  return `<svg width="100%" height="100%" viewBox="0 0 ${SVG_W_BARS} ${DIM}" preserveAspectRatio="xMinYMin meet" xmlns="http://www.w3.org/2000/svg">${parts.join('')}</svg>`;
}

function nextGridPos(state){
  while(state.row>=7 && state.col>=12 && state.col<=13){
    state.row++;
    if(state.row>8){state.row=1;state.col++;}
  }
  const pos={row:state.row,col:state.col};
  state.row++;
  if(state.row>8){state.row=1;state.col++;}
  return pos;
}

function buildGrid(){
  const grid=document.getElementById('grid');
  const state={row:1,col:1};
  POEMS.forEach(poem=>{
    const {row,col}=nextGridPos(state);
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
    cell.addEventListener('click',()=>openModal(poem.n));
    cell.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' ')openModal(poem.n);});
    grid.appendChild(cell);
  });
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
    // Same JP word HIGHLIGHT_DEVICE_KEYS recorded for this phrase — lets
    // hovering this EN highlight glow the source JP characters too, and
    // vice versa (see renderJPChars' data-device attribute below).
    const deviceKey=deviceKeyMap&&deviceKeyMap[key];
    const deviceAttr=deviceKey?` data-device="${escHtml(deviceKey)}"`:'';
    return `<span class="dw-en" style="background:${color}"${tipAttr}${deviceAttr}>${escHtml(m)}</span>`;
  });
}
function escHtml(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

// ── Device runs, correction-aware ──────────────────────────────────────────
// Apply reviewer corrections before computing non-overlapping device spans.
function computeDeviceRuns(n, corr){
  const jp=(SRC_JP[String(n)]||'').replace(/\n/g,'');
  const devsRaw=SRC_DEVICES[String(n)]||{};
  const devCorr=(corr&&corr.devices)||{};
  // Added corrections override the original device color.
  const addedColors={};
  Object.entries(devCorr).forEach(([w,rec])=>{
    if(rec&&rec.status==='added'&&rec.corrected&&jp.includes(w)) addedColors[w]=rec.corrected.color;
  });
  const words=[...new Set([...Object.keys(devsRaw), ...Object.keys(addedColors)])]
    .filter(w=>w!=='none'&&jp.includes(w));
  const sorted=[...words].sort((a,b)=>b.length-a.length);
  const charColors=new Array(jp.length).fill(null);
  const charWord=new Array(jp.length).fill(null);
  let i=0;
  while(i<jp.length){
    let matched=false;
    for(const w of sorted){
      if(jp.startsWith(w,i)){
        const rec=devCorr[w];
        if(rec && rec.status==='removed'){ i+=w.length; matched=true; break; }
        let s=i, e=i+w.length;
        if(rec && rec.status==='corrected' && rec.corrected){
          s=Math.max(0,rec.corrected.start); e=Math.min(jp.length,rec.corrected.end);
        }
        const col=addedColors[w]||devsRaw[w];
        for(let j=s;j<e;j++){ charColors[j]=col; charWord[j]=w; }
        i+=w.length; matched=true; break;
      }
    }
    if(!matched) i++;
  }
  return {jp, charColors, charWord};
}

// Furigana entries are given in poem order as {kanji, reading} — walk the
// text left-to-right, matching each entry starting just after where the
// previous one ended, rather than a generic substring search, so a
// repeated kanji elsewhere in the poem can't steal the wrong run.
function computeFurigana(jp, furiganaList){
  const runs=[];
  let cursor=0;
  (furiganaList||[]).forEach(entry=>{
    const idx=jp.indexOf(entry.kanji, cursor);
    if(idx===-1) return;
    runs.push({start:idx, end:idx+entry.kanji.length, reading:entry.reading});
    cursor=idx+entry.kanji.length;
  });
  return runs;
}

function renderJPChars(n, poem, corr, furiganaList){
  const {jp, charColors, charWord} = computeDeviceRuns(n, corr);

  const rawJP=SRC_JP[String(n)]||'';
  const verses=rawJP.includes('\n')?rawJP.split('\n'):null;
  let kamiEnd;
  if(verses&&verses.length===5){
    kamiEnd=verses[0].length+verses[1].length+verses[2].length;
  } else {
    kamiEnd=Math.round(jp.length*3/5);
  }
  const bCorr=(corr&&corr.kami_shimo_boundary);
  if(bCorr && bCorr.status==='corrected' && bCorr.corrected && typeof bCorr.corrected.kamiEnd==='number'){
    kamiEnd=bCorr.corrected.kamiEnd;
  }

  const spans=[];
  for(let p=0;p<jp.length;p++){
    const dev=charColors[p];
    const word=charWord[p];
    let style='', attrs='';
    if(dev){
      const isStart = p===0 || charColors[p-1]!==dev || charWord[p-1]!==word;
      const isEnd = p===jp.length-1 || charColors[p+1]!==dev || charWord[p+1]!==word;
      const rTop = isStart?'4px':'0', rBottom = isEnd?'4px':'0';
      style=` style="background:${dev};border-radius:${rTop} ${rTop} ${rBottom} ${rBottom};"`;
      // data-tip: the same definition string HIGHLIGHT_LABELS gives this
      // word's rendering in each translator's English, so hovering either
      // side shows an identical definition. data-device: the JP word
      // itself — HIGHLIGHT_DEVICE_KEYS tags each translator's matching
      // phrase with this SAME word, so the glow listener (below) can find
      // and light up every tied element together, not just this one.
      const label=(SRC_DEVICE_LABELS[String(n)]||{})[word];
      const tipAttr=label?` data-tip="${escHtml(label)}"`:'';
      const runCls=(isStart?' run-start':'')+(isEnd?' run-end':'');
      attrs=` class="jp-ch dev-ch${runCls}" data-word="${escHtml(word)}" data-color="${dev}" data-pos="${p}" data-device="${escHtml(word)}"${tipAttr}`;
    } else {
      attrs=' class="jp-ch"';
    }
    spans.push(`<span${attrs}${style}>${escHtml(jp[p])}</span>`);
  }

  // Group consecutive characters that belong to the same furigana run under
  // one <ruby> element — device-highlight spans are preserved untouched
  // inside it, the reading is just layered on top via <rt>.
  const furiRuns = computeFurigana(jp, furiganaList);
  const runIdxByChar = new Array(jp.length).fill(-1);
  furiRuns.forEach((r,ri)=>{ for(let j=r.start;j<r.end;j++) runIdxByChar[j]=ri; });

  let chars='';
  let p=0;
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

// ── Correction sidebar ───────────────────────────────────────────────────
// Opens automatically with every poem and stays open — a full checklist of
// every classification (kami/shimo boundary, every detected source device,
// every translator's per-line ku type), each with its own inline
// confirm/remove/edit controls, so a reviewer sees the whole picture at
// once instead of clicking one item at a time.
const corrSidebar = document.getElementById('corrSidebar');
const corrSidebarBody = document.getElementById('corrSidebarBody');
document.getElementById('corrSidebarClose').addEventListener('click', hideSidebar);

function hideSidebar(){
  corrSidebar.classList.remove('open');
  corrSidebar.setAttribute('aria-hidden','true');
  document.getElementById('overlay').classList.remove('has-sidebar');
}
function showSidebarPanel(){
  corrSidebar.classList.add('open');
  corrSidebar.setAttribute('aria-hidden','false');
  document.getElementById('overlay').classList.add('has-sidebar');
}

async function postCorrection(n, scope, kind, item_id, action, original, correctedVal){
  const res = await fetch(`/api/corrections/${n}`, {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({scope, kind, item_id, action, original, corrected: correctedVal||null})
  });
  const data = await res.json();
  corrections[n] = data.corrections;
  refreshAccuracyBadge();
  return data;
}

// Same kami/shimo boundary logic renderJPChars uses (verse-length split,
// fallback 3/5 ratio, then any human correction) — factored out so the
// sidebar's displayed value always matches what's actually drawn.
function computeKamiEnd(n, jpLen, corr){
  const rawJP=SRC_JP[String(n)]||'';
  const verses=rawJP.includes('\n')?rawJP.split('\n'):null;
  let kamiEnd = (verses&&verses.length===5)
    ? verses[0].length+verses[1].length+verses[2].length
    : Math.round(jpLen*3/5);
  const bCorr=corr&&corr.kami_shimo_boundary;
  if(bCorr && bCorr.status==='corrected' && bCorr.corrected && typeof bCorr.corrected.kamiEnd==='number'){
    kamiEnd=bCorr.corrected.kamiEnd;
  }
  return kamiEnd;
}

function flashRow(selector){
  const row = corrSidebarBody.querySelector(selector);
  if(!row) return;
  row.scrollIntoView({block:'center'});
  row.classList.remove('flash'); void row.offsetWidth; row.classList.add('flash');
}

// ── LLM rationale lookup ──────────────────────────────────────────────────
// Pulls the actual "why" out of the raw annotation JSON (not the flattened
// word→color map) — kakekotoba pun interaction, makurakotoba conventional
// meaning, kigo season, and the bipartite
// pivot/relationship note. Returns null if nothing matches (kami/shimo-only
// words carry no separate device rationale).
// A word can carry more than one device, so return every applicable rationale.
function findDeviceReasoning(word, srcAnno){
  if(!srcAnno) return null;
  const out=[];
  const kake = (srcAnno.kakekotoba||[]).find(k=>k.word===word);
  if(kake) out.push({label:'Kakekotoba (pivot word)', text:kake.interaction});
  const makura = (srcAnno.makurakotoba||[]).find(m=>m.word===word);
  if(makura) out.push({label:'Makurakotoba (pillow word)', text:makura.conventional_meaning});
  if(srcAnno.kigo && srcAnno.kigo.word===word){
    out.push({label:`Kigo — ${srcAnno.kigo.season}`, text:srcAnno.kigo.note||'Seasonal reference word.'});
  }
  return out.length?out:null;
}
// The pipeline DOES capture per-translator, per-device rationale — just
// under a different shape than the source-side devices: kakekotoba_handling
// / makurakotoba_handling key by the JP original_word but carry an
// en_equivalent (the actual highlighted English word or phrase).
function findTranslatorDeviceReasoning(translator, enWord, trAnno){
  const t = trAnno&&trAnno[translator];
  if(!t) return null;
  const norm = s => (s||'').toLowerCase();
  const kk = (t.kakekotoba_handling||[]).find(k=>norm(k.en_equivalent).includes(norm(enWord)));
  if(kk) return {label:`Kakekotoba handling — ${kk.method}`, text:kk.note};
  const mk = (t.makurakotoba_handling||[]).find(m=>norm(m.en_equivalent).includes(norm(enWord)));
  if(mk) return {label:`Makurakotoba handling — ${mk.method}`, text:mk.note};
  return null;
}
function findBoundaryReasoning(srcAnno){
  const bp = srcAnno&&srcAnno.bipartite;
  if(!bp) return null;
  return {label:bp.relationship_type||'Kami/Shimo relationship',
          text:[bp.kami_theme&&`Kami: ${bp.kami_theme}`, bp.shimo_theme&&`Shimo: ${bp.shimo_theme}`, bp.pivot_note]
                 .filter(Boolean).join(' ')};
}
function findLineReasoning(translator, lineIdx, trAnno){
  const t = trAnno&&trAnno[translator];
  if(!t) return null;
  const entry=(t.line_mapping&&t.line_mapping.entries||[]).find(e=>e.en_line===lineIdx+1);
  const bpNote = t.bipartite&&t.bipartite.note;
  const text=[entry&&entry.content_summary, bpNote].filter(Boolean).join(' — ');
  return text ? {label:'Translator note', text} : null;
}
// The AI's guess at which source word a translation phrase preserves
// (HIGHLIGHT_DEVICE_KEYS) is sometimes missing or wrong — this lets a
// reviewer manually point a translation device back to the correct source
// word (or unlink it), overriding that guess. `rec` is the device_link
// correction entry for one translator word, if any has been saved.
function effectiveDeviceLink(baseKey, rec){
  if(!rec) return baseKey||'';
  if(rec.status==='removed') return '';
  if(rec.status==='corrected' && rec.corrected) return rec.corrected.source_word||'';
  return baseKey||'';
}
// Same override, applied across a whole translator's word->sourceWord map
// (HIGHLIGHT_DEVICE_KEYS[n][lbl]) — used when rendering the actual
// highlighted text, so the glow/tooltip wiring reflects manual corrections
// too, not just the AI's original guess.
function effectiveDeviceKeyMap(baseMap, deviceLinkCorr){
  const map = {...baseMap};
  Object.entries(deviceLinkCorr||{}).forEach(([w,rec])=>{
    const key = w.toLowerCase();
    const linked = effectiveDeviceLink(map[key], rec);
    if(linked) map[key]=linked; else delete map[key];
  });
  return map;
}
// Dropdown of every known source device word for this poem (plus "no
// link") — the only words that actually have a rendered, glow-able
// .dev-ch span in the JP panel, so linking to anything else would point at
// nothing.
function sourceWordOptionsHTML(sourceWords, selected){
  const opts = ['<option value="">(no link)</option>']
    .concat(sourceWords.map(w=>`<option value="${escHtml(w)}" ${w===selected?'selected':''}>${escHtml(w)}</option>`));
  return opts.join('');
}

function whyHTML(id, why){
  if(!why) return '';
  const items = Array.isArray(why) ? why : [why];
  if(!items.length) return '';
  const body = items.map(w=>`<div><span class="cs-why-label">${escHtml(w.label)}:</span> ${escHtml(w.text)}</div>`).join('');
  return `<button class="cs-why-btn" data-why-toggle="${id}" title="Why?">?</button>
    <div class="cs-why" data-why="${id}">${body}</div>`;
}

const DEVICE_TYPE_COLORS = [
  ['kakekotoba','Kakekotoba'], ['makurakotoba','Makurakotoba'], ['kigo','Kigo'],
];
function deviceTypeOptionsHTML(){
  return DEVICE_TYPE_COLORS.map(([k,label])=>`<option value="${C[k]}">${label}</option>`).join('');
}

function renderSidebarChecklist(n, corr, reasonData, notesData){
  const poem = POEMS[n-1];
  const jp = (SRC_JP[String(n)]||'').replace(/\n/g,'');
  const devsRaw = SRC_DEVICES[String(n)]||{};
  const devCorr = (corr.source&&corr.source.devices)||{};
  const devWords = Object.keys(devsRaw).filter(w=>w!=='none'&&jp.includes(w));
  // Human-added source devices the AI never flagged at all.
  const addedSrcWords = Object.entries(devCorr).filter(([w,rec])=>rec.status==='added'&&!devWords.includes(w)).map(([w])=>w);
  const kamiEnd = computeKamiEnd(n, jp.length, corr.source);
  const boundaryCorr = corr.source&&corr.source.kami_shimo_boundary;
  const boundaryStatus = boundaryCorr?boundaryCorr.status:'pending';
  const kuColor={kami:C.kami,shimo:C.shimo,imagined:C.imagined};
  const srcAnno = reasonData&&reasonData.source;
  const trAnno = reasonData&&reasonData.translations;

  const boundaryWhy = whyHTML('boundary', findBoundaryReasoning(srcAnno));
  const boundarySection = `
    <div class="cs-section">
      <div class="cs-section-h">Kami / Shimo boundary</div>
      <div class="cs-row" data-boundary-row>
        <span class="cs-label">Kami ends after char</span>
        <input type="number" class="cs-num" id="csKamiEnd" value="${kamiEnd}" min="1" max="${jp.length-1}">
        <span class="cs-status cs-status-${boundaryStatus}">${boundaryStatus}</span>
        <button class="cs-mini" data-act="boundary-save">Save</button>
        <button class="cs-mini" data-act="boundary-confirm">✓</button>
        ${boundaryWhy}
      </div>
    </div>`;

  // Jokotoba (preface) — informational, not a per-word device with its own
  // color: it's a freely-composed multi-ku preface, not a fixed epithet, so
  // it's shown as its own read-only card rather than a highlightable word.
  const joko = srcAnno && srcAnno.jokotoba;
  const jokotobaSection = joko ? `
    <div class="cs-section">
      <div class="cs-section-h">Jokotoba (preface)</div>
      <div class="cs-info-block">
        <div><span class="cs-info-label">Text:</span> ${escHtml(joko.text||'')}</div>
        ${joko.pivot ? `<div><span class="cs-info-label">Pivot:</span> ${escHtml(joko.pivot)}</div>` : ''}
        ${joko.function ? `<div class="cs-info-note">${escHtml(joko.function)}</div>` : ''}
      </div>
    </div>` : '';

  function deviceRow(w, color, status, why){
    return `<div class="cs-row" data-device-row="${escHtml(w)}">
      <span class="cs-sw" style="background:${color}"></span>
      <span class="cs-word" title="${escHtml(w)}">${escHtml(w)}</span>
      <span class="cs-status cs-status-${status}">${status}</span>
      <button class="cs-mini" data-act="dev-confirm" data-word="${escHtml(w)}" data-color="${color}">✓</button>
      <button class="cs-mini" data-act="dev-remove" data-word="${escHtml(w)}" data-color="${color}">✕</button>
      ${whyHTML(`dev-${w}`, why)}
    </div>`;
  }
  const deviceRows =
    devWords.map(w=>{
      const rec=devCorr[w];
      // Added corrections override the model's original device color.
      const color = (rec&&rec.status==='added'&&rec.corrected) ? rec.corrected.color : devsRaw[w];
      const status = rec ? rec.status : 'pending';
      return deviceRow(w, color, status, findDeviceReasoning(w, srcAnno));
    }).join('') +
    addedSrcWords.map(w=>{
      const note=devCorr[w].corrected.note;
      return deviceRow(w, devCorr[w].corrected.color, 'added', note?{label:'Reviewer note',text:note}:null);
    }).join('');
  const deviceSection = `
    <div class="cs-section" data-add-scope="source">
      <div class="cs-section-h">Source devices (${devWords.length+addedSrcWords.length})</div>
      ${deviceRows || '<div class="cs-row"><span class="cs-word">No devices detected</span></div>'}
      ${addDeviceFormHTML('source')}
    </div>`;

  const translatorSections = TRANS_LBLS.map(lbl=>{
    const translator = TRANS_FULLNAME[lbl];
    const bar = poem.real?poem.bars.find(b=>b.lbl===lbl):null;
    if(!bar) return '';
    const lineCorr=(corr.translations&&corr.translations[translator]&&corr.translations[translator].lines)||{};
    const lineRows = bar.segs.map((seg,li)=>{
      let type = seg.type;
      const ov = lineCorr[String(li)];
      if(ov && ov.status==='corrected' && ov.corrected) type = ov.corrected.type;
      const status = ov?ov.status:'pending';
      const types=['kami','shimo','imagined'];
      const why = whyHTML(`line-${translator}-${li}`, findLineReasoning(translator, li, trAnno));
      return `<div class="cs-row" data-line-row="${translator}-${li}">
        <span class="cs-sw" style="background:${kuColor[type]||'#ccc'}"></span>
        <span class="cs-word">Line ${li+1}</span>
        <select class="cs-mini-select" data-translator="${translator}" data-line="${li}">
          ${types.map(t=>`<option value="${t}" ${t===type?'selected':''}>${t}</option>`).join('')}
        </select>
        <span class="cs-status cs-status-${status}">${status}</span>
        <button class="cs-mini" data-act="line-save" data-translator="${translator}" data-line="${li}" data-type="${type}">Save</button>
        <button class="cs-mini" data-act="line-confirm" data-translator="${translator}" data-line="${li}" data-type="${type}">✓</button>
        ${why}
      </div>`;
    }).join('');

    // Translation-side devices — the same words HIGHLIGHTS already colors
    // in the running translation text, surfaced here for review too, plus
    // any the AI missed.
    const wordMap = (HIGHLIGHTS[String(n)]||{})[lbl]||{};
    const transDevCorr = (corr.translations&&corr.translations[translator]&&corr.translations[translator].devices)||{};
    const deviceKeyMapBase = (HIGHLIGHT_DEVICE_KEYS[String(n)]||{})[lbl]||{};
    const deviceLinkCorr = (corr.translations&&corr.translations[translator]&&corr.translations[translator].device_links)||{};
    const allSourceWords = [...devWords, ...addedSrcWords];
    const aiWords = Object.keys(wordMap);
    const addedWords = Object.entries(transDevCorr).filter(([w,rec])=>rec.status==='added'&&!aiWords.includes(w)).map(([w])=>w);
    // Points a translation device back to the source JP word it renders —
    // this is what makes the glow/tooltip cross-highlight connect the two
    // correctly when the AI's own guess (HIGHLIGHT_DEVICE_KEYS) is missing
    // or wrong, rather than just showing them as independently-colored.
    function linkRowHTML(w){
      const linked = effectiveDeviceLink(deviceKeyMapBase[w.toLowerCase()], deviceLinkCorr[w]);
      return `<div class="cs-link-row">
        <span class="cs-link-label">Connects to</span>
        <select class="cs-mini-select" data-link-translator="${translator}" data-link-word="${escHtml(w)}">
          ${sourceWordOptionsHTML(allSourceWords, linked)}
        </select>
        <button class="cs-mini" data-act="tdev-link-save" data-translator="${translator}" data-word="${escHtml(w)}">Save</button>
      </div>`;
    }
    const transDeviceRows =
      aiWords.map(w=>{
        const rec=transDevCorr[w]; const status=rec?rec.status:'pending';
        const why=whyHTML(`tdev-${translator}-${w}`, findTranslatorDeviceReasoning(translator, w, trAnno));
        return `<div class="cs-row" data-tdevice-row="${translator}-${escHtml(w)}">
          <span class="cs-sw" style="background:${wordMap[w]}"></span>
          <span class="cs-word" title="${escHtml(w)}">${escHtml(w)}</span>
          <span class="cs-status cs-status-${status}">${status}</span>
          <button class="cs-mini" data-act="tdev-confirm" data-translator="${translator}" data-word="${escHtml(w)}" data-color="${wordMap[w]}">✓</button>
          <button class="cs-mini" data-act="tdev-remove" data-translator="${translator}" data-word="${escHtml(w)}" data-color="${wordMap[w]}">✕</button>
          ${why}
          ${linkRowHTML(w)}
        </div>`;
      }).join('') +
      addedWords.map(w=>{
        const note=transDevCorr[w].corrected.note;
        const why=whyHTML(`tdev-added-${translator}-${w}`, note?{label:'Reviewer note',text:note}:null);
        return `<div class="cs-row" data-tdevice-row="${translator}-${escHtml(w)}">
          <span class="cs-sw" style="background:${transDevCorr[w].corrected.color}"></span>
          <span class="cs-word" title="${escHtml(w)}">${escHtml(w)}</span>
          <span class="cs-status cs-status-added">added</span>
          ${why}
          ${linkRowHTML(w)}
        </div>`;
      }).join('');

    return `<div class="cs-section" data-add-scope="${translator}">
      <div class="cs-section-h">${TRANS_NAMES[lbl]} lines</div>
      ${lineRows}
      <div class="cs-section-h" style="margin-top:.8rem;">${TRANS_NAMES[lbl]} devices (${aiWords.length+addedWords.length})</div>
      ${transDeviceRows || '<div class="cs-row"><span class="cs-word">No devices detected</span></div>'}
      ${addDeviceFormHTML(translator)}
    </div>`;
  }).join('');

  const notesSection = renderNotesSection(notesData);
  corrSidebarBody.innerHTML = boundarySection + jokotobaSection + deviceSection + translatorSections + notesSection;
  showSidebarPanel();
}

function addDeviceFormHTML(scope){
  const id = scope.replace(/\s+/g,'_');
  return `
    <button class="cs-add-toggle" data-add-toggle="${id}">+ Add a device the AI missed</button>
    <div class="cs-add-form" data-add-form="${id}">
      <label>Word / phrase (must appear in the text)
        <input type="text" class="cs-add-word" data-scope="${escHtml(scope)}">
      </label>
      <label>Type
        <select class="cs-add-type">${deviceTypeOptionsHTML()}</select>
      </label>
      <label>Description (optional) — why this is a device
        <textarea class="cs-add-desc" placeholder="e.g. how the two readings interact, what it precedes, its seasonal association…"></textarea>
      </label>
      <button class="cs-mini" data-act="add-device" data-scope="${escHtml(scope)}">Save</button>
    </div>`;
}

// Annotator notes — free-form commentary, not tied to any specific
// AI-detected device: a general poem-level note plus one per ku (poem
// section). Rendered as its own always-visible section, same as the rest
// of the checklist.
function noteBlockHTML(scope, label, text){
  return `
    <div class="cs-note-block">
      <div class="cs-note-label"><span>${escHtml(label)}</span><span class="cs-note-saved" data-note-saved="${scope}">Saved</span></div>
      <textarea class="cs-note-text" data-note-scope="${scope}" placeholder="Add a comment…">${escHtml(text||'')}</textarea>
      <button class="cs-mini" data-act="note-save" data-scope="${scope}" style="margin-top:.35rem;">Save</button>
    </div>`;
}
// Word/phrase-level notes — free commentary pinned to a specific Japanese
// (or English) word/phrase, distinct from the ku-level and general notes
// above and from the structured device system (no color, no verification —
// just a comment a reviewer wants attached to that exact text).
function wordNoteBlockHTML(word, text){
  const scope = `word:${word}`;
  return `
    <div class="cs-note-block" data-word-note-block="${escHtml(word)}">
      <div class="cs-note-label"><span>"${escHtml(word)}"</span><span class="cs-note-saved" data-note-saved="${escHtml(scope)}">Saved</span></div>
      <textarea class="cs-note-text" data-note-scope="${escHtml(scope)}" placeholder="Add a comment…">${escHtml(text||'')}</textarea>
      <button class="cs-mini" data-act="note-save-word" data-word="${escHtml(word)}" style="margin-top:.35rem;">Save</button>
      <button class="cs-mini" data-act="note-delete-word" data-word="${escHtml(word)}" style="margin-top:.35rem;">Remove</button>
    </div>`;
}

function renderNotesSection(notesData){
  const nd = notesData || {general:'', ku:{}, words:{}};
  const kuBlocks = [1,2,3,4,5].map(k=>noteBlockHTML(String(k), `Ku ${k}`, (nd.ku||{})[String(k)])).join('');
  const wordEntries = Object.entries(nd.words||{});
  const wordBlocks = wordEntries.map(([w,t])=>wordNoteBlockHTML(w,t)).join('');
  return `
    <div class="cs-section" id="notesSectionRoot">
      <div class="cs-section-h">Annotator Notes</div>
      ${noteBlockHTML('general', 'General (whole poem)', nd.general)}
      ${kuBlocks}
      ${wordEntries.length ? `<div class="cs-section-h" style="margin-top:.8rem;">Word / phrase notes</div>${wordBlocks}` : ''}
      <button class="cs-add-toggle" data-add-toggle="wordnote">+ Add a note on a word/phrase</button>
      <div class="cs-add-form" data-add-form="wordnote">
        <label>Word / phrase (Japanese or English, exactly as it appears)
          <input type="text" class="cs-wordnote-word">
        </label>
        <label>Comment
          <textarea class="cs-wordnote-text" style="min-height:3rem;resize:vertical;font-family:inherit;padding:.5rem .6rem;border:1px solid #ccc;border-radius:5px;"></textarea>
        </label>
        <button class="cs-mini" data-act="note-save-word-new">Save</button>
      </div>
    </div>`;
}

// Event delegation — one listener handles every inline control in the
// checklist, re-rendering just the checklist (not the whole modal) after
// each save so the reviewer's scroll position and flow aren't disrupted.
corrSidebarBody.addEventListener('click', async e=>{
  const whyBtn = e.target.closest('[data-why-toggle]');
  if(whyBtn){
    const why = corrSidebarBody.querySelector(`[data-why="${whyBtn.dataset.whyToggle}"]`);
    if(why) why.classList.toggle('open');
    return;
  }
  const addToggle = e.target.closest('[data-add-toggle]');
  if(addToggle){
    const form = corrSidebarBody.querySelector(`[data-add-form="${addToggle.dataset.addToggle}"]`);
    if(form) form.classList.toggle('open');
    return;
  }

  const btn = e.target.closest('[data-act]');
  if(!btn || !currentN) return;
  const n = currentN;

  if(btn.dataset.act==='note-save'){
    // No refreshPoemView here — notes don't affect anything else rendered,
    // and a full checklist rebuild would blow away scroll position/focus
    // for what's meant to be a quick, low-friction save.
    const scope=btn.dataset.scope;
    const textarea=corrSidebarBody.querySelector(`[data-note-scope="${scope}"]`);
    const text=textarea.value;
    const res=await fetch(`/api/notes/${n}`,{
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({scope, text}),
    });
    const data=await res.json();
    notes[n]=data.notes;
    const savedTag=corrSidebarBody.querySelector(`[data-note-saved="${scope}"]`);
    if(savedTag){
      savedTag.classList.add('show');
      setTimeout(()=>savedTag.classList.remove('show'), 1500);
    }
    return;
  }

  if(btn.dataset.act==='note-save-word'){
    // Editing an EXISTING word note's text — no structural change, so same
    // low-friction flash-save as general/ku notes above.
    const word=btn.dataset.word;
    const textarea=corrSidebarBody.querySelector(`[data-note-scope="word:${CSS.escape(word)}"]`);
    const text=textarea.value;
    const res=await fetch(`/api/notes/${n}`,{
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({scope:'word', word, text}),
    });
    const data=await res.json();
    notes[n]=data.notes;
    const savedTag=corrSidebarBody.querySelector(`[data-note-saved="word:${CSS.escape(word)}"]`);
    if(savedTag){ savedTag.classList.add('show'); setTimeout(()=>savedTag.classList.remove('show'),1500); }
    return;
  }

  if(btn.dataset.act==='note-save-word-new'){
    const form=btn.closest('.cs-add-form');
    const word=form.querySelector('.cs-wordnote-word').value.trim();
    const text=form.querySelector('.cs-wordnote-text').value;
    if(!word || !text) return;
    const res=await fetch(`/api/notes/${n}`,{
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({scope:'word', word, text}),
    });
    const data=await res.json();
    notes[n]=data.notes;
    document.getElementById('notesSectionRoot').outerHTML = renderNotesSection(notes[n]);
    return;
  }

  if(btn.dataset.act==='note-delete-word'){
    const word=btn.dataset.word;
    const res=await fetch(`/api/notes/${n}`,{
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({scope:'word', word, text:''}),
    });
    const data=await res.json();
    notes[n]=data.notes;
    document.getElementById('notesSectionRoot').outerHTML = renderNotesSection(notes[n]);
    return;
  }

  if(btn.dataset.act==='boundary-save' || btn.dataset.act==='boundary-confirm'){
    const kamiEnd = +document.getElementById('csKamiEnd').value;
    const action = btn.dataset.act==='boundary-save' ? 'corrected' : 'confirmed';
    await postCorrection(n,'source','kami_shimo_boundary','kami_shimo_boundary',action,{},action==='corrected'?{kamiEnd}:undefined);
  } else if(btn.dataset.act==='dev-confirm' || btn.dataset.act==='dev-remove'){
    const word=btn.dataset.word, color=btn.dataset.color;
    const action = btn.dataset.act==='dev-confirm' ? 'confirmed' : 'removed';
    await postCorrection(n,'source','device',word,action,{word,color});
  } else if(btn.dataset.act==='tdev-confirm' || btn.dataset.act==='tdev-remove'){
    const translator=btn.dataset.translator, word=btn.dataset.word, color=btn.dataset.color;
    const action = btn.dataset.act==='tdev-confirm' ? 'confirmed' : 'removed';
    await postCorrection(n,translator,'device',word,action,{word,color});
  } else if(btn.dataset.act==='tdev-link-save'){
    const translator=btn.dataset.translator, word=btn.dataset.word;
    const sel=corrSidebarBody.querySelector(`select[data-link-translator="${CSS.escape(translator)}"][data-link-word="${CSS.escape(word)}"]`);
    const sourceWord=sel.value;
    // Empty selection explicitly unlinks (status "removed") rather than
    // leaving the AI's original guess in place — a reviewer picking
    // "(no link)" means "this isn't tied to that word", not "no opinion".
    if(sourceWord) await postCorrection(n,translator,'device_link',word,'corrected',{word},{source_word:sourceWord});
    else await postCorrection(n,translator,'device_link',word,'removed',{word});
  } else if(btn.dataset.act==='add-device'){
    const scope=btn.dataset.scope;
    const form=btn.closest('.cs-add-form');
    const word=form.querySelector('.cs-add-word').value.trim();
    const color=form.querySelector('.cs-add-type').value;
    const note=form.querySelector('.cs-add-desc').value.trim();
    if(!word) return;
    await postCorrection(n,scope,'device',word,'added',null,{word,color,note});
  } else if(btn.dataset.act==='line-save' || btn.dataset.act==='line-confirm'){
    const translator=btn.dataset.translator, lineIdx=btn.dataset.line;
    if(btn.dataset.act==='line-save'){
      const sel=corrSidebarBody.querySelector(`select[data-translator="${translator}"][data-line="${lineIdx}"]`);
      const type=sel.value;
      await postCorrection(n,translator,'line_ku_type',lineIdx,'corrected',{type:btn.dataset.type},{type});
    } else {
      await postCorrection(n,translator,'line_ku_type',lineIdx,'confirmed',{type:btn.dataset.type});
    }
  } else return;

  await refreshPoemView(n);
});

// Clicking an element in the poem itself jumps the (always-open) sidebar to
// its matching checklist row and briefly highlights it, rather than opening
// a separate editor — the row's own inline controls are already visible.
function jumpToDeviceRow(word){ flashRow(`[data-device-row="${CSS.escape(word)}"]`); }
function jumpToBoundaryRow(){ flashRow('[data-boundary-row]'); }
function jumpToLineRow(translator, lineIdx){ flashRow(`[data-line-row="${translator}-${lineIdx}"]`); }

async function loadCorrectionsFor(n){
  if(corrections[n]) return corrections[n];
  const res = await fetch(`/api/corrections/${n}`);
  const data = await res.json();
  corrections[n] = data;
  return data;
}

// After any single correction is saved, re-fetch and re-render everything
// for the current poem (jp panel, en panel, sidebar checklist) so every
// view of that item's status stays in sync — without closing/reopening the
// modal itself.
async function refreshPoemView(n){
  delete corrections[n];
  await renderPoem(n);
}

// Traditional kanji numeral for 1-100 (十七, 二十, 百, ...) — used for the
// modal's poem-number caption. Arabic digits inside title-jp's
// writing-mode:vertical-rl get rotated 90° by text-orientation:mixed (which
// only keeps CJK characters upright), reading as sideways/"flipped" numbers;
// kanji numerals stay upright and match the rest of the vertical title.
const KANJI_DIGITS=['','一','二','三','四','五','六','七','八','九'];
function toKanjiNumber(n){
  if(n===100) return '百';
  if(n<10) return KANJI_DIGITS[n];
  if(n<20) return '十'+(n%10 ? KANJI_DIGITS[n%10] : '');
  const tens=Math.floor(n/10), ones=n%10;
  return KANJI_DIGITS[tens]+'十'+(ones ? KANJI_DIGITS[ones] : '');
}

// ── Modal ─────────────────────────────────────────────────────────────────
let currentN=null;

function openModal(n){
  currentN=n;
  renderPoem(n);
  document.getElementById('overlay').classList.add('open');
}

// A translator's device wordMap (from HIGHLIGHTS) adjusted by whatever the
// reviewer has confirmed/removed/added — so a "removed" false positive
// actually stops highlighting, and an "added" word actually starts.
function effectiveWordMap(baseMap, transDevCorr){
  const map = {...baseMap};
  Object.entries(transDevCorr||{}).forEach(([w,rec])=>{
    if(rec.status==='removed'){ delete map[w]; delete map[w.toLowerCase()]; }
    else if(rec.status==='added' && rec.corrected){ map[w.toLowerCase()]=rec.corrected.color; }
  });
  return map;
}

function renderPoem(n){
  const poem=POEMS[n-1];
  const csv=CSV[String(n)]||{};
  const hl=HIGHLIGHTS[String(n)]||{};
  const devs=SRC_DEVICES[String(n)]||{};

  return Promise.all([loadCorrectionsFor(n), loadReasoningFor(n), loadNotesFor(n)]).then(([corr, reasonData, notesData])=>{
    const jpP=document.getElementById('jpPanel');
    const {html:jpCharsHTML, kamiEnd, total}=renderJPChars(n, poem, corr.source, reasonData&&reasonData.source&&reasonData.source.furigana);

    const kamiFrac=kamiEnd/total;
    const sbKami=`<div class="jp-sidebar-seg" style="height:${(kamiFrac*100).toFixed(1)}%;background:${C.kami};"></div>`;
    const sbShimo=`<div class="jp-sidebar-seg" style="height:${((1-kamiFrac)*100).toFixed(1)}%;background:${C.shimo};"></div>`;

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
      <div class="jp-inner">
        <div class="jp-sidebar" id="jpSidebar" title="Click to correct kami/shimo boundary">${sbKami}${sbShimo}</div>
        <div class="jp-chars-area"><div class="jp-chars">${jpCharsHTML}</div></div>
      </div>
    `;
    document.getElementById('jpSidebar').addEventListener('click', e=>{
      e.stopPropagation();
      jumpToBoundaryRow();
    });
    jpP.querySelectorAll('.dev-ch').forEach(el=>{
      el.addEventListener('click', e=>{
        e.stopPropagation();
        jumpToDeviceRow(el.dataset.word);
      });
    });

    const titleCol=document.getElementById('titleCol');
    titleCol.innerHTML=`
      <div class="title-jp">百人一首の${toKanjiNumber(n)}番</div>
      <div class="jp-legend"><div class="lgd-title">Legend</div>${legendRowsHTML}</div>
    `;

    const MODAL_ORDER=['D','N','P','M'];
    const kuColor={kami:C.kami,shimo:C.shimo,imagined:C.imagined};
    const enP=document.getElementById('enPanel');
    const blocks=MODAL_ORDER.map(lbl=>{
      const lines=csv[lbl]||[];
      const translator=TRANS_FULLNAME[lbl];
      const transDevCorr=(corr.translations && corr.translations[translator] && corr.translations[translator].devices)||{};
      const deviceLinkCorr=(corr.translations && corr.translations[translator] && corr.translations[translator].device_links)||{};
      const wordMap=effectiveWordMap(hl[lbl]||{}, transDevCorr);
      const labelMap=(HIGHLIGHT_LABELS[String(n)]||{})[lbl]||{};
      // Manual reviewer links (see linkRowHTML/tdev-link-save in the
      // sidebar) override the AI's own HIGHLIGHT_DEVICE_KEYS guess, so the
      // glow/tooltip wiring reflects a corrected connection, not just
      // whatever the pipeline originally inferred.
      const deviceKeyMap=effectiveDeviceKeyMap((HIGHLIGHT_DEVICE_KEYS[String(n)]||{})[lbl]||{}, deviceLinkCorr);
      // A manually-added link often has no AI-authored label of its own
      // (HIGHLIGHT_LABELS only covers phrases the pipeline itself found) —
      // fall back to the linked SOURCE word's own definition so the
      // tooltip is never blank just because the connection was drawn by a
      // reviewer instead of the pipeline.
      const srcLabelsForPoem=(SRC_DEVICE_LABELS[String(n)]||{});
      const effLabelMap={...labelMap};
      Object.entries(deviceKeyMap).forEach(([w,srcWord])=>{
        if(!effLabelMap[w] && srcLabelsForPoem[srcWord]) effLabelMap[w]=srcLabelsForPoem[srcWord];
      });
      const bar=poem.real?poem.bars.find(b=>b.lbl===lbl):null;
      const segs=bar?bar.segs:null;
      const lineCorr=(corr.translations && corr.translations[translator] && corr.translations[translator].lines)||{};
      const linesHTML=lines.map((ln,li)=>{
        let type=segs&&segs[li]?segs[li].type:null;
        const override=lineCorr[String(li)];
        if(override && override.status==='corrected' && override.corrected) type=override.corrected.type;
        const uc=type?kuColor[type]:'transparent';
        return `<div class="tl-row" data-line="${li}" data-translator="${translator}" data-type="${type||''}">`+
               `<span class="tl" style="border-bottom-color:${uc}">${highlightLine(ln,wordMap,effLabelMap,deviceKeyMap)}</span></div>`;
      }).join('');
      return `<div class="trans-block">
        <div class="trans-label">${TRANS_NAMES[lbl]}</div>
        <div class="trans-lines">${linesHTML||'<span class="no-data">—</span>'}</div>
      </div>`;
    }).join('');

    enP.innerHTML=`
      <div class="en-title">Poem ${n} — ${escHtml(csv.poet||'')}</div>
      <div class="trans-grid">${blocks}</div>
    `;
    enP.querySelectorAll('.tl-row').forEach(row=>{
      row.addEventListener('click', e=>{
        e.stopPropagation();
        const li=row.dataset.line, translator=row.dataset.translator, type=row.dataset.type;
        if(!type) return; // no ku data for this line, nothing to correct
        jumpToLineRow(translator, li);
      });
    });

    document.getElementById('mPrev').disabled=n<=1;
    document.getElementById('mNext').disabled=n>=100;

    renderSidebarChecklist(n, corr, reasonData, notesData);
  });
}

function closeModal(){document.getElementById('overlay').classList.remove('open');currentN=null;hideSidebar();}
function navModal(d){if(currentN)openModal(Math.max(1,Math.min(100,currentN+d)));}

document.getElementById('mClose').addEventListener('click',closeModal);
document.getElementById('mPrev').addEventListener('click',()=>navModal(-1));
document.getElementById('mNext').addEventListener('click',()=>navModal(1));
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){closeModal();}
  if(e.key==='ArrowLeft')navModal(-1);
  if(e.key==='ArrowRight')navModal(1);
});
document.getElementById('overlay').addEventListener('click',e=>{
  if(e.target===e.currentTarget)closeModal();
});

// ── Device-definition tooltip + tied cross-highlight glow ─────────────────
// Hovering a source JP device word (data-device on .dev-ch, set in
// renderJPChars) or its rendering in any translator's English (data-device
// on .dw-en, set in highlightLine) shows that device's definition
// (data-tip) and brightens every element sharing the same data-device
// value at once — so the connection between the original and each
// translation's handling of it reads as one thing, not four coincidentally
// same-colored patches. Delegated on document (not just the modal) so it
// keeps working after renderPoem() rebuilds jpPanel/enPanel each time.
const hoverTip = document.getElementById('hoverTip');
let activeTipEl = null;
let glowingEls = [];

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

// Triggers on data-tip OR data-device (not just data-tip) — a manually
// drawn link (see linkRowHTML/tdev-link-save) can exist without a label if
// SRC_DEVICE_LABELS has none for that source word, and the connection
// should still glow even when there's no definition text to show.
document.addEventListener('mouseover', e=>{
  const el = e.target.closest('[data-tip],[data-device]');
  if(!el || el===activeTipEl) return;
  activeTipEl = el;
  if(el.dataset.tip){
    hoverTip.textContent = el.dataset.tip;
    hoverTip.classList.add('show');
    hoverTip.classList.remove('flip');
    positionTip(el);
  } else {
    hoverTip.classList.remove('show');
  }

  clearGlow();
  const key = el.dataset.device;
  if(key){
    glowingEls = [...document.querySelectorAll(`[data-device="${CSS.escape(key)}"]`)];
    glowingEls.forEach(g=>g.classList.add('glow'));
  }
});
document.addEventListener('mouseout', e=>{
  const leaving = e.target.closest('[data-tip],[data-device]');
  const entering = e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('[data-tip],[data-device]');
  if(leaving && leaving!==entering){
    activeTipEl = null;
    hoverTip.classList.remove('show');
    clearGlow();
  }
});

buildGrid();
}
