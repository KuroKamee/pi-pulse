'use strict';
const byId = id => document.getElementById(id);
const gib = bytes => (bytes / 1073741824).toFixed(2);
const fmt = (v, unit = '') => Number.isFinite(v) ? `${v.toFixed(1)}${unit}` : '—';
const clock = t => new Date(t * 1000).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
const stamp = t => new Date(t * 1000).toLocaleString();
const valueOf = (d, key) => ['memory','disk'].includes(key) ? d?.[key]?.percent : d?.[key];
const unitOf = () => byId('measurement').value === 'temperature_c' ? ' °C' : ' %';
let piHealth = null, piHealthReceived = 0, liveReceived = 0;
let saved = null, live = null, previousNetwork = null, historyRequest = 0, chartPoints = [];
function svg(tag, attrs, text) {
  const node = document.createElementNS('http://www.w3.org/2000/svg',tag);
  for (const [key,value] of Object.entries(attrs)) node.setAttribute(key,value);
  if (text !== undefined) node.textContent = text;
  return node;
}
function clearReadings() {
  for (const id of ['temperature','cpu','memory','disk','uptime','clock','cores','processes','swap','available-memory','load','network-down','network-up','network-total','stat-current']) byId(id).textContent = '—';
  for (const id of ['memory-detail','disk-detail','sensor','device-model']) byId(id).textContent = 'Unavailable';
}
function showSample(index) {
  if (!chartPoints.length) return;
  index = Math.max(0,Math.min(chartPoints.length-1, index));
  const p = chartPoints[index];
  byId('sample-picker').value = index;
  byId('sample-detail').textContent = `${stamp(p.t)} · ${byId('measurement').selectedOptions[0].text}: ${fmt(p.v,unitOf())}`;
  byId('cursor-line').setAttribute('x1',p.x);
  byId('cursor-line').setAttribute('x2',p.x);
  byId('cursor-line').setAttribute('y1',20);
  byId('cursor-line').setAttribute('y2',250);
  byId('cursor-line').setAttribute('visibility','visible');
}
function plotHistory() {
  const key = byId('measurement').value, unit = unitOf();
  byId('stat-current').textContent = fmt(valueOf(live,key),unit);
  const points = (saved?.samples || []).map(p => ({t:p.sampled_at,v:valueOf(p,key)})).filter(p => Number.isFinite(p.v));
  chartPoints = [];
  byId('grid').replaceChildren();
  byId('line').setAttribute('d','');
  byId('average-line').setAttribute('d','');
  byId('point').setAttribute('visibility','hidden');
  byId('cursor-line').setAttribute('visibility','hidden');
  byId('sample-picker').disabled = !points.length;
  byId('sample-detail').textContent = 'Hover, tap, or use the slider to inspect a saved reading.';
  for (const id of ['stat-average','stat-min','stat-max']) byId(id).textContent = '—';
  if (!points.length) {
    byId('grid').append(svg('text',{x:400,y:135,'text-anchor':'middle'},'No saved samples available'));
    return;
  }
  const values = points.map(p => p.v), min = Math.min(...values), max = Math.max(...values);
  const avg = values.reduce((a,b) => a+b,0)/values.length;
  byId('stat-average').textContent = fmt(avg,unit);
  byId('stat-min').textContent = fmt(min,unit);
  byId('stat-max').textContent = fmt(max,unit);
  // Temperature zooms to a labeled range. Percent graphs always retain a zero baseline.
  const lower = key === 'temperature_c' ? Math.floor((min-3)/5)*5 : 0;
  const upper = key === 'temperature_c' ? Math.max(lower+10,Math.ceil((max+3)/5)*5) : Math.min(100,Math.max(5,Math.ceil(max*1.15/5)*5));
  const end = saved.server_time;
  const start = byId('fit').checked ? Math.max(end-saved.hours*3600,Math.min(points[0].t,end-60)) : end-saved.hours*3600;
  const x = t => 68+(t-start)/(end-start)*710;
  const y = v => 250-(v-lower)/(upper-lower)*230;
  for (let i=0; i<=4; i++) {
    const v = lower+(upper-lower)*i/4, yy=y(v);
    byId('grid').append(svg('line',{x1:68,x2:778,y1:yy,y2:yy}),svg('text',{x:58,y:yy+5,'text-anchor':'end'},fmt(v,unit)));
    const t = start+(end-start)*i/4;
    byId('grid').append(svg('text',{x:x(t),y:279,'text-anchor':i===0?'start':i===4?'end':'middle'},clock(t)));
  }
  let previous = null;
  const path = points.map(p => {
    const command = previous === null || p.t-previous>75 ? 'M':'L';
    previous=p.t;
    chartPoints.push({...p,x:x(p.t),y:y(p.v)});
    return `${command}${x(p.t).toFixed(2)},${y(p.v).toFixed(2)}`;
  }).join(' ');
  byId('line').setAttribute('d',path);
  byId('average-line').setAttribute('d',`M68 ${y(avg)}H778`);
  const last = chartPoints[chartPoints.length-1];
  byId('point').setAttribute('cx',last.x);
  byId('point').setAttribute('cy',last.y);
  byId('point').setAttribute('visibility','visible');
  byId('sample-picker').max = chartPoints.length-1;
  byId('sample-picker').value = chartPoints.length-1;
  byId('axis-note').textContent = `Auto-scaled axis · ${stamp(start)} → ${stamp(end)}`;
  byId('chart').setAttribute('aria-label',`${byId('measurement').selectedOptions[0].text}. Average ${fmt(avg,unit)}, minimum ${fmt(min,unit)}, maximum ${fmt(max,unit)}. ${points.length} samples. Use the sample slider for exact readings.`);
}
byId('chart').addEventListener('pointermove', event => {
  if (!chartPoints.length) return;
  const rect = byId('chart').getBoundingClientRect();
  const px = (event.clientX-rect.left)/rect.width*800;
  let closest = 0;
  chartPoints.forEach((p,i) => { if (Math.abs(p.x-px)<Math.abs(chartPoints[closest].x-px)) closest=i; });
  showSample(closest);
});
byId('sample-picker').addEventListener('input',event => showSample(Number(event.target.value)));
function recentRows(samples) {
  byId('recent-rows').replaceChildren();
  for (const p of samples.slice(-10).reverse()) {
    const row=document.createElement('tr');
    for (const text of [stamp(p.sampled_at),fmt(p.temperature_c,' °C'),fmt(p.cpu_percent,' %'),fmt(p.memory?.percent,' %')]) {
      const cell=document.createElement('td'); cell.textContent=text; row.append(cell);
    }
    byId('recent-rows').append(row);
  }
}
async function refreshHistory() {
  const sequence=++historyRequest, abort=new AbortController();
  const timer=setTimeout(() => abort.abort(),10000);
  try {
    const response=await fetch(`/api/history?hours=${byId('period').value}`,{cache:'no-store',signal:abort.signal});
    if (!response.ok) throw new Error('History unavailable');
    const data=await response.json();
    if (sequence!==historyRequest) return;
    saved=data;
    const last=data.samples[data.samples.length-1];
    const stale=last && data.server_time-last.sampled_at>90;
    byId('history-status').textContent=data.samples.length
      ? `${data.samples.length} saved readings · every 30 seconds · 7-day retention${stale?' · Recording delayed; history may be stale':''}`
      : 'Waiting for the first saved reading. Allow up to 30 seconds.';
    recentRows(data.samples); plotHistory();
  } catch (error) {
    if (sequence!==historyRequest) return;
    saved=null; recentRows([]); plotHistory();
    byId('history-status').textContent='History unavailable. Check your connection; retrying automatically.';
  } finally { clearTimeout(timer); }
}
byId('period').addEventListener('change',()=>{saved=null; recentRows([]); plotHistory(); refreshHistory();});
byId('measurement').addEventListener('change',plotHistory);
byId('fit').addEventListener('change',plotHistory);
const byteText = n => !Number.isFinite(n)?'—':n>=1073741824?`${(n/1073741824).toFixed(2)} GiB`:n>=1048576?`${(n/1048576).toFixed(1)} MiB`:`${(n/1024).toFixed(1)} KiB`;
function systemDetails(d) {
  const s=d.system || {};
  byId('device-model').textContent=s.model || 'Device details unavailable';
  byId('clock').textContent=fmt(s.frequency_mhz,' MHz');
  byId('cores').textContent=s.logical_cpus ?? '—';
  byId('processes').textContent=s.process_count ?? '—';
  byId('swap').textContent=byteText(s.swap_used_bytes);
  byId('available-memory').textContent=byteText(d.memory.available_bytes);
  byId('load').textContent=s.load_average?s.load_average.map(v=>v.toFixed(2)).join(' / '):'—';
  const entries=Object.entries(d.network || {}), identity=entries.map(([name])=>name).sort().join(', ');
  const current={t:d.sampled_at,up:0,down:0,boot:Math.round(d.sampled_at-d.uptime_seconds),identity};
  for (const [,v] of entries) { current.up+=v.sent_bytes; current.down+=v.received_bytes; }
  const prev=previousNetwork, dt=prev?current.t-prev.t:0;
  const valid=entries.length && prev && prev.identity===identity && Math.abs(prev.boot-current.boot)<3 && dt>0 && dt<30 && current.up>=prev.up && current.down>=prev.down;
  byId('network-down').textContent=valid?`${byteText((current.down-prev.down)/dt)}/s`:'Waiting for next reading…';
  byId('network-up').textContent=valid?`${byteText((current.up-prev.up)/dt)}/s`:'Waiting for next reading…';
  byId('network-total').textContent=entries.length?byteText(current.down):'Unavailable';
  byId('network-note').textContent=entries.length?`${identity} · totals since interface counters began. Includes dashboard traffic; not an internet speed test.`:'No Ethernet/Wi-Fi counters available.';
  previousNetwork=current;
}
async function refresh() {
  const abort=new AbortController(), timer=setTimeout(()=>abort.abort(),4000);
  try {
    const response=await fetch('/api/metrics',{cache:'no-store',signal:abort.signal});
    if (!response.ok) throw new Error('Collector unavailable');
    const d=await response.json();
    if (d.schema_version!==1 || !Number.isFinite(d.cpu_percent)) throw new Error('Invalid metrics');
    live=d; liveReceived=Date.now(); renderHealth();
    byId('status').textContent='CONNECTED'; byId('error').hidden=true;
    byId('hostname').textContent=d.hostname;
    byId('temperature').textContent=fmt(d.temperature_c);
    byId('sensor').textContent=d.temperature_c===null?'Sensor unavailable':'CPU thermal sensor';
    byId('cpu').textContent=fmt(d.cpu_percent);
    byId('memory').textContent=gib(d.memory.used_bytes);
    byId('memory-detail').textContent=`${gib(d.memory.total_bytes)} GiB total · ${d.memory.percent}% used`;
    byId('disk').textContent=gib(d.disk.used_bytes);
    byId('disk-detail').textContent=`${gib(d.disk.free_bytes)} GiB available · ${d.disk.percent}% used`;
    const u=d.uptime_seconds;
    byId('uptime').textContent=`${Math.floor(u/86400)}d ${Math.floor(u/3600)%24}h ${Math.floor(u/60)%60}m`;
    byId('updated').textContent=new Date(d.sampled_at*1000).toLocaleTimeString();
    byId('stat-current').textContent=fmt(valueOf(d,byId('measurement').value),unitOf());
    systemDetails(d);
  } catch (error) {
    live=null; previousNetwork=null; clearReadings(); renderHealth();
    byId('status').textContent='DISCONNECTED';
    byId('error').textContent='Live readings unavailable. Check the collector and SSH tunnel. Saved history may still be shown.';
    byId('error').hidden=false;
  } finally { clearTimeout(timer); setTimeout(refresh,5000); }
}
refresh(); refreshHistory(); setInterval(refreshHistory,30000);

function renderPiHole(d) {
  piHealth=d; piHealthReceived=Date.now(); renderHealth();
  for (const id of ['pihole-queries','pihole-blocked','pihole-percent','pihole-blocking']) byId(id).textContent='—';
  if (d.state !== 'connected') {
    byId('pihole-state').textContent=d.state==='not_configured'?'SETUP NEEDED':'UNAVAILABLE';
    byId('pihole-message').textContent=d.message || 'Cannot reach Pi-hole. Retrying automatically.';
    return;
  }
  byId('pihole-state').textContent='CONNECTED';
  byId('pihole-queries').textContent=Number(d.queries).toLocaleString();
  byId('pihole-blocked').textContent=Number(d.blocked).toLocaleString();
  byId('pihole-percent').textContent=fmt(d.percent_blocked,' %');
  byId('pihole-blocking').textContent=({enabled:'Enabled',disabled:'Disabled',failed:'Failed',unknown:'Unknown'})[d.blocking] || 'Unknown';
  byId('pihole-message').textContent=`Updated ${stamp(d.sampled_at)} · refreshes every 15 seconds`;
}
async function refreshPiHole() {
  const abort=new AbortController(), timer=setTimeout(()=>abort.abort(),12000);
  try {
    const response=await fetch('/api/pihole',{cache:'no-store',signal:abort.signal});
    if (!response.ok) throw new Error('Pi-hole summary unavailable');
    renderPiHole(await response.json());
  } catch (error) {
    renderPiHole({state:'unavailable',message:'Pi-hole readings unavailable. Check your collector connection; retrying automatically.'});
  } finally {clearTimeout(timer);setTimeout(refreshPiHole,15000);}
}
refreshPiHole();

// Application warning thresholds, not a hardware fault diagnosis.
function healthChecks(metrics, pi, metricsFresh, piFresh) {
  const result=[];
  const add=(level,title,message)=>result.push({level,title,message});
  if (!metrics || !metricsFresh) add('unknown','System readings unavailable','Check the SSH tunnel and collector. Current temperature and storage cannot be checked.');
  else {
    const temp=metrics.temperature_c, disk=metrics.disk;
    if (!Number.isFinite(temp)) add('unknown','Temperature unavailable','The CPU sensor did not return a reading.');
    else if (temp>=80) add('critical','High CPU temperature',`${temp.toFixed(1)} °C. Check the fan and airflow; the Pi may reduce its speed at this temperature.`);
    else if (temp>=75) add('warning','CPU is getting warm',`${temp.toFixed(1)} °C. Check airflow and watch for a sustained rise.`);
    else add('ok','Temperature within range',`${temp.toFixed(1)} °C · early warning at 75 °C.`);
    if (!Number.isFinite(disk?.percent) || !Number.isFinite(disk?.free_bytes)) add('unknown','Storage unavailable','Cannot check space on the main filesystem.');
    else {
      const level=disk.percent>=95 || disk.free_bytes<1073741824?'critical':disk.percent>=85 || disk.free_bytes<3221225472?'warning':'ok';
      add(level,level==='ok'?'Storage has room':'Storage running low',`${(disk.free_bytes/1073741824).toFixed(2)} GiB available · ${disk.percent.toFixed(1)}% used.${level==='ok'?'':' Review large files and backups before removing anything.'}`);
    }
  }
  if (!pi || !piFresh || pi.state!=='connected') add('unknown','Pi-hole status unavailable','Cannot verify blocking. Check the Pi-hole dashboard; an API or login problem does not necessarily mean DNS has stopped.');
  else if (pi.blocking==='failed') add('critical','Pi-hole reports blocking failed','Open the Pi-hole dashboard and check its status.');
  else if (pi.blocking==='disabled') add('warning','Ad blocking is disabled','Enable blocking in Pi-hole when you want filtering to resume.');
  else if (pi.blocking!=='enabled') add('unknown','Blocking status unknown','Open the Pi-hole dashboard to check filtering.');
  else add('ok','Pi-hole blocking enabled','Pi-hole reports filtering is enabled. This does not test every device’s DNS settings.');
  return result;
}
function renderHealth() {
  const checks=healthChecks(live,piHealth,Date.now()-liveReceived<20000,Date.now()-piHealthReceived<45000);
  const overall=checks.some(c=>c.level==='critical')?'critical':checks.some(c=>c.level==='warning')?'warning':checks.some(c=>c.level==='unknown')?'unknown':'ok';
  const panel=byId('health-panel'); panel.setAttribute('data-level',overall);
  byId('health-state').textContent=({critical:'ACTION NEEDED',warning:'CHECK WARNINGS',unknown:'CHECKS INCOMPLETE',ok:'CHECKS PASSED'})[overall];
  const list=byId('health-checks'); list.replaceChildren();
  for (const check of checks) {
    const item=document.createElement('li'), title=document.createElement('strong'), detail=document.createElement('p');
    item.setAttribute('data-level',check.level);
    title.textContent=check.title; detail.textContent=check.message;
    item.append(title,detail); list.append(item);
  }
}
renderHealth();
setInterval(renderHealth,5000);
