export const draftLabels=Object.freeze({requestedAmount:'Requested amount in INR',loanPurpose:'Loan purpose',preferredTenureMonths:'Preferred tenure in months',declaredMonthlyIncome:'Declared monthly income in INR',monthlyExpenses:'Monthly expenses in INR',existingMonthlyDebt:'Existing monthly debt repayments in INR',dateOfBirth:'Date of birth',documentReference:'Fictional TEST document reference'});
const moneyFields=new Set(['requestedAmount','declaredMonthlyIncome','monthlyExpenses','existingMonthlyDebt']);
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function formFields(form){return Object.fromEntries(Object.keys(draftLabels).map(key=>{let value=form.elements.namedItem(key)?.value?.trim()||'';if(moneyFields.has(key)&&value!==''&&Number.isFinite(Number(value)))value=Number(value).toFixed(2);return[key,value];}));}
export function assistantMarkup(){return `<aside class="loan-assistant" aria-label="Loan application assistant"><h3>Application help</h3><p class="muted small">Get help completing this form. AI suggestions need your confirmation. Only you can submit; your lender decides on approval.</p><button type="button" class="button" data-ai="open">Get help with this application</button><div data-ai-panel hidden><p class="muted small">AI runs locally with Ollama. Do not enter passwords, OTPs or real identity documents. Clarify monthly amounts and use INR.</p><div class="assistant-conversation" data-ai-log role="log" aria-live="polite"></div><label for="assistant-message">Your question or answer</label><textarea id="assistant-message" maxlength="1500" rows="3" placeholder="For example: What does monthly debt mean?"></textarea><button type="button" class="button primary" data-ai="send">Ask assistant</button><div data-ai-suggestions></div></div><div class="assistant-draft-controls"><button type="button" class="button" data-ai="save">Save draft</button><button type="button" class="button" data-ai="validate">Check application</button></div><p data-ai-status role="status">Loading saved draft…</p><div data-ai-validation></div><div data-ai-review hidden></div></aside>`;}
export async function mountAssistant(form,live){
 const panel=form.querySelector('.loan-assistant');const status=panel.querySelector('[data-ai-status]');
 let draft,epoch=0,busy=false,reviewed=null;
 const connected=()=>form.isConnected&&form.closest('dialog')?.open;
 const tell=text=>{if(connected())status.textContent=text;};
 const summary=result=>{if(!connected())return;panel.querySelector('[data-ai-validation]').innerHTML=[...(result.missingFields||[]).map(k=>`${draftLabels[k]} is required.`),...Object.entries(result.validationErrors||{}).map(([k,v])=>`${draftLabels[k]}: ${v}`)].map(x=>`<p class="error-inline">${escape(x)}</p>`).join('');};
 const invalidate=()=>{reviewed=null;panel.querySelector('[data-ai-review]').hidden=true;form.querySelector('[type=submit]').textContent='Review application';};
 const changed=event=>{if(!(event.target.name in draftLabels)&&!['detailsConfirmed','kycTermsAccepted','initialSharingAuthorised'].includes(event.target.name))return;epoch++;invalidate();panel.querySelector('[data-ai-suggestions]').replaceChildren();tell('Unsaved changes. Save your draft before closing.');};
 form.addEventListener('input',changed);form.addEventListener('change',changed);
 const run=async work=>{if(busy)throw Error('Wait for the current draft or assistant request.');busy=true;panel.querySelectorAll('button').forEach(b=>b.disabled=true);try{return await work();}finally{busy=false;if(connected())panel.querySelectorAll('button').forEach(b=>b.disabled=false);}};
 async function save(){
  const savedEpoch=epoch;const result=await live.request('auth',`/api/v1/seller/loan-drafts/${draft.draftId}`,{draftVersion:draft.version,fields:formFields(form)},'PATCH');
  draft=result;if(!connected())return;
  if(epoch!==savedEpoch)throw Error('The form changed while saving. Save again to include your latest changes.');
  summary(draft.validation);tell('Draft saved. You can close and resume this application.');return draft;
 }
 try{
  const result=await live.request('auth','/api/v1/seller/loan-drafts');draft=result.draft||await live.request('auth','/api/v1/seller/loan-drafts',{});
  if(!connected())return null;
  for(const [key,value] of Object.entries(epoch===0?draft.fields:{})){
   const input=form.elements.namedItem(key);if(!input)continue;
   if(input.tagName==='SELECT'&&value&&!Array.from(input.options).some(o=>o.value===value))input.add(new Option(`${value} months`,value));
   input.value=value;
  }
  invalidate();tell(Object.keys(draft.fields).length?'Saved draft restored. Confirm declarations again before submitting.':'New draft ready. Save your progress at any time.');
 }catch{tell('Draft storage is unavailable. You can still complete and submit this form manually.');panel.querySelectorAll('button').forEach(b=>b.disabled=true);return null;}
 panel.addEventListener('click',async event=>{
  const button=event.target.closest('[data-ai]');if(!button||button.disabled)return;
  const action=button.dataset.ai;
  if(action==='open'){panel.querySelector('[data-ai-panel]').hidden=false;button.hidden=true;panel.querySelector('textarea').focus();return;}
  try{await run(async()=>{
   if(action==='save'){await save();return;}
   if(action==='validate'){await save();summary(draft.validation);tell(draft.validation.missingFields.length||Object.keys(draft.validation.validationErrors).length?'Resolve the listed fields, then review.':'Application fields are ready. Review and confirm your declarations.');return;}
   if(action!=='send')return;
   const message=panel.querySelector('textarea').value.trim();if(!message)throw Error('Enter your question or answer.');
   await save();const requestEpoch=epoch;
   const log=panel.querySelector('[data-ai-log]');const line=document.createElement('p');line.textContent='You: '+message;log.append(line);panel.querySelector('textarea').value='';
   tell('Thinking locally with Ollama…');
   const reply=await live.request('auth',`/api/v1/seller/loan-drafts/${draft.draftId}/assistant/messages`,{message,draftVersion:draft.version});
   if(!connected())return;
   if(epoch!==requestEpoch||reply.draftVersion!==draft.version){tell('The form changed while the assistant was answering. Ask again using the latest values.');return;}
   const answer=document.createElement('p');answer.textContent='Assistant: '+reply.reply;log.append(answer);log.scrollTop=log.scrollHeight;
   const suggestions=panel.querySelector('[data-ai-suggestions]');suggestions.replaceChildren();
   for(const suggestion of reply.suggestedUpdates||[]){
    if(!(suggestion.field in draftLabels)||!suggestion.requiresConfirmation)continue;
    const row=document.createElement('div');row.className='assistant-suggestion';
    const text=document.createElement('p');text.textContent=`Suggested ${draftLabels[suggestion.field]}: ${suggestion.value}`;row.append(text);
    const accept=document.createElement('button');accept.type='button';accept.className='button';accept.textContent='Accept change';
    const reject=document.createElement('button');reject.type='button';reject.className='button';reject.textContent='Reject';
    accept.addEventListener('click',()=>{if(epoch!==requestEpoch)return;tell('Suggested change accepted. Save the updated draft.');const input=form.elements.namedItem(suggestion.field);if(input.tagName==='SELECT'&&!Array.from(input.options).some(o=>o.value===suggestion.value))input.add(new Option(`${suggestion.value} months`,suggestion.value));input.value=suggestion.value;input.dispatchEvent(new Event('input',{bubbles:true}));});
    reject.addEventListener('click',()=>row.remove());row.append(accept,reject);suggestions.append(row);
   }
   summary(reply);tell(reply.available?'Suggestions are optional. Review every value before accepting.':'AI unavailable. Manual editing, saving and submission remain available.');
  });}catch(error){tell(error.message);}
 });
 return {async submit(){return run(async()=>{
  const snapshot=JSON.stringify(formFields(form));
  if(!reviewed||reviewed.snapshot!==snapshot||reviewed.epoch!==epoch){
   await save();if(draft.validation.missingFields.length||Object.keys(draft.validation.validationErrors).length)throw Error('Resolve the listed validation issues before submission.');
   const review=panel.querySelector('[data-ai-review]');review.innerHTML='<h3>Review your application</h3><dl>'+Object.entries(formFields(form)).map(([k,v])=>`<dt>${escape(draftLabels[k])}</dt><dd>${escape(k==='loanPurpose'?v.replaceAll('_',' '):v)}</dd>`).join('')+'</dl><p>Check the values and declarations. Select “Confirm and request loan” to submit.</p>';review.hidden=false;review.scrollIntoView({block:'nearest'});
   reviewed={snapshot,epoch};form.querySelector('[type=submit]').textContent='Confirm and request loan';tell('Review complete details before confirming submission.');return false;
  }
  const data=new FormData(form);
  await live.request('auth',`/api/v1/seller/loan-drafts/${draft.draftId}/submit`,{draftVersion:draft.version,initialSharingAuthorised:data.has('initialSharingAuthorised'),detailsConfirmed:data.has('detailsConfirmed'),kycTermsAccepted:data.has('kycTermsAccepted')});return true;
 });}};
}
