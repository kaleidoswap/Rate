// Real installed Mind core; only LLM output and tool side effects are synthetic.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Funnel,ToolRegistry} from '../../node_modules/@kaleidorg/mind/dist/index.js';
const final={text:'ok',rawContent:'ok',toolCalls:[]};
function harness(settings={}){
 const seen=[],executed=[];
 const defs=['remember','recall','search_knowledge','get_balances','demo_spend'].map(name=>({name,description:name,parameters:{type:'object',properties:{}},requiresConfirmation:name==='demo_spend'}));
 const tools=new ToolRegistry([{id:'demo',listTools:()=>defs,has:n=>defs.some(d=>d.name===n),execute:async(n,a)=>{executed.push(n);return n==='get_balances'?{total_sats:12,layers:[]}:{};}}]);
 const provider={name:'fake',runTurn:async input=>{seen.push({...input,messages:input.messages.map(m=>({...m}))});return final}};
 const funnel=new Funnel({provider,tools,skills:[{name:'wallet-assistant',description:'Wallet',instructions:'Wallet instructions',tools:['get_balances'],triggers:['wallet']}],getSettings:()=>settings,recipes:[]});
 return {funnel,provider,seen,executed,settings};
}
test('persona updates reach subsequent agentic turns without recreating the funnel',async()=>{const h=harness({persona:'Rispondi in italiano.'});await h.funnel.runTurn('Saluta');assert.match(h.seen[0].messages[0].content,/Rispondi in italiano/);h.settings.persona='Keep it brief.';await h.funnel.runTurn('Saluta ancora');assert.match(h.seen[1].messages[0].content,/Keep it brief/);assert.doesNotMatch(h.seen[1].messages[0].content,/Rispondi in italiano/)});
test('history selection retains messages, not token-budgeted turns',async()=>{const h=harness({historyLength:4});const history=Array.from({length:10},(_,i)=>({role:i%2?'assistant':'user',content:`m${i}`}));await h.funnel.runTurn('Saluta',{history});assert.deepEqual(h.seen[0].messages.slice(1,-1).map(m=>m.content),['m6','m7','m8','m9'])});
test('memory and RAG toggles remove their tools from an agentic request',async()=>{const h=harness({memoryEnabled:false,ragEnabled:false});await h.funnel.runTurn('Saluta');const names=h.seen[0].tools.map(t=>t.name);for(const n of ['remember','recall','search_knowledge'])assert.ok(!names.includes(n));h.settings.memoryEnabled=true;h.settings.ragEnabled=true;await h.funnel.runTurn('Saluta ancora');for(const n of ['remember','recall','search_knowledge'])assert.ok(h.seen[1].tools.some(t=>t.name===n))});
test('disabled wallet skill is not a permission gate on deterministic balance',async()=>{const h=harness({disabledSkills:['wallet-assistant']});assert.equal(h.funnel.listSkills().length,0);const result=await h.funnel.runTurn("What's my balance?");assert.equal(result.tier,'fast');assert.deepEqual(h.executed,['get_balances']);assert.equal(h.seen.length,0)});
test('a spending tool does not execute without approval, then executes after approval',async()=>{const h=harness();let calls=0;h.provider.runTurn=async()=>++calls%2?{...final,toolCalls:[{name:'demo_spend',arguments:{amount:1}}]}:final;await h.funnel.runTurn('Run a custom action');assert.equal(h.executed.length,0);calls=0;await h.funnel.runTurn('Run a custom action',{onConfirm:async()=>({approved:true})});assert.deepEqual(h.executed,['demo_spend'])});
