const fs=require('fs'),vm=require('vm'),assert=require('assert');
const nodes={};
function node(){return {textContent:'',value:'',children:[],attrs:{},selectedOptions:[{text:'Temperature'}],setAttribute(k,v){this.attrs[k]=v},append(...v){this.children.push(...v)},replaceChildren(...v){this.children=v},addEventListener(){}};}
const document={getElementById(id){return nodes[id]??=(node())},createElement:node,createElementNS:node};
document.getElementById('measurement').value='temperature_c';
document.getElementById('period').value='1';
document.getElementById('fit').checked=true;
let code=fs.readFileSync(require('path').join(__dirname,'static/app.js'),'utf8');
code=code.replace('refresh(); refreshHistory(); setInterval(refreshHistory,30000);','');
code=code.replace('refreshPiHole();','');
const context=vm.createContext({document,console,AbortController,setTimeout,clearTimeout,setInterval:()=>{}});
vm.runInContext(code,context);
vm.runInContext(`saved={hours:1,server_time:1000,samples:[{sampled_at:800,temperature_c:50},{sampled_at:830,temperature_c:60},{sampled_at:860,temperature_c:null},{sampled_at:950,temperature_c:55}]}; live={temperature_c:57}; plotHistory();`,context);
assert.equal(nodes['stat-current'].textContent,'57.0 °C');
assert.equal(nodes['stat-average'].textContent,'55.0 °C');
assert.equal(nodes['stat-min'].textContent,'50.0 °C');
assert.equal(nodes['stat-max'].textContent,'60.0 °C');
assert.equal((nodes.line.attrs.d.match(/M/g)||[]).length,2);
assert(nodes.grid.children.some(n=>n.textContent.includes('°C')));
vm.runInContext('showSample(1)',context);
assert(nodes['sample-detail'].textContent.includes('60.0 °C'));
vm.runInContext('saved=null;live=null;plotHistory()',context);
assert.equal(nodes['stat-average'].textContent,'—');
assert.equal(nodes['stat-current'].textContent,'—');
assert.equal(nodes.line.attrs.d,'');
console.log('Dashboard statistics, labels, gaps, sample inspection and empty state passed.');

vm.runInContext("renderPiHole({state:'connected',queries:100,blocked:25,percent_blocked:25,blocking:'enabled',sampled_at:1000})",context);
assert.equal(nodes['pihole-blocked'].textContent,'25');
assert.equal(nodes['pihole-percent'].textContent,'25.0 %');
vm.runInContext("renderPiHole({state:'unavailable'})",context);
assert.equal(nodes['pihole-blocked'].textContent,'—');
assert.equal(nodes['pihole-state'].textContent,'UNAVAILABLE');
console.log('Pi-hole rendering clears stale values on errors.');

const healthy={temperature_c:50,disk:{percent:20,free_bytes:10*1073741824}};
const enabled={state:'connected',blocking:'enabled'};
context.hm=healthy;context.hp=enabled;
const check=(expr)=>vm.runInContext(expr,context);
assert(check('healthChecks(hm,hp,true,true)').every(c=>c.level==='ok'));
for(const [temp,level] of [[74.9,'ok'],[75,'warning'],[80,'critical']]){context.temp=temp;assert.equal(check('healthChecks({...hm,temperature_c:temp},hp,true,true)')[0].level,level)}
assert.equal(check('healthChecks({...hm,temperature_c:null},hp,true,true)')[0].level,'unknown');
assert.equal(check('healthChecks({...hm,disk:{percent:95,free_bytes:10e9}},hp,true,true)')[1].level,'critical');
assert.equal(check('healthChecks({...hm,disk:{percent:10,free_bytes:0.5e9}},hp,true,true)')[1].level,'critical');
assert.equal(check('healthChecks({...hm,disk:{percent:85,free_bytes:10e9}},hp,true,true)')[1].level,'warning');
assert.equal(check('healthChecks(hm,{state:"connected",blocking:"disabled"},true,true)')[2].level,'warning');
assert.equal(check('healthChecks(hm,{state:"connected",blocking:"failed"},true,true)')[2].level,'critical');
assert(check('healthChecks(hm,hp,false,false)').every(c=>c.level==='unknown'));
console.log('Health thresholds, missing sensors, stale readings, low space and Pi-hole failures passed.');
