// Opt-in local integration test. Creates one synthetic seller and a cancelled verification application.
const t=require('./lib/client.cjs');t.writable();
(async()=>{
 const staff=await t.login('marketplace');const {fixture,token}=await t.sellerFixture('ai-assistant',staff);await t.history(staff,fixture);
 const other=await t.login('other-seller'),admin=await t.login('admin');
 const root='/api/v1/seller/loan-drafts';let draft=t.expect(await t.call(5175,'auth',root,token,{}),200);const base=root+'/'+draft.draftId;
 t.expect(await t.call(5175,'auth',base,other),404);t.expect(await t.call(5178,'auth',root,admin),403);
 const fields={requestedAmount:'100000.00',loanPurpose:'PURCHASE_INVENTORY',preferredTenureMonths:'12',declaredMonthlyIncome:'500000.00',monthlyExpenses:'100000.00',existingMonthlyDebt:'10000.00',dateOfBirth:'1990-01-01',documentReference:'TEST-AIASSIST001'};
 const old=draft.version;draft=t.expect(await t.call(5175,'auth',base,token,{draftVersion:old,fields},'PATCH'),200);t.assert.equal(draft.status,'READY_FOR_REVIEW');
 t.expect(await t.call(5175,'auth',base,token,{draftVersion:old,fields:{}},'PATCH'),409);
 const resume=t.expect(await t.call(5175,'auth',root,token),200);t.assert.equal(resume.draft.draftId,draft.draftId);t.assert.deepEqual(resume.draft.fields,fields);
 const model=await fetch(`http://localhost:5175/api/proxy/auth${base}/assistant/messages`,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({draftVersion:draft.version,message:'Please explain what preferred tenure means. Do not suggest any amounts.'}),signal:AbortSignal.timeout(65000)});
 const reply=await model.json();t.assert.equal(model.status,200);t.assert.equal(reply.available,true,JSON.stringify(reply));t.assert(reply.suggestedUpdates.every(x=>x.requiresConfirmation));
 console.log('Real Ollama response:',reply.reply);
 t.assert.equal(t.expect(await t.call(5175,'auth',base,token),200).version,draft.version);
 const declarations={draftVersion:draft.version,initialSharingAuthorised:true,detailsConfirmed:true,kycTermsAccepted:true};
 t.expect(await t.call(5175,'auth',base+'/submit',token,{...declarations,initialSharingAuthorised:false}),400);
 t.assert.equal(t.expect(await t.call(5175,'auth','/api/v1/seller/loan-requests',token),200).totalElements,0);
 const key=t.crypto.randomUUID();const submitted=t.expect(await t.call(5175,'auth',base+'/submit',token,declarations,null,key),200);
 t.assert.equal(t.expect(await t.call(5175,'auth',base+'/submit',token,declarations,null,key),200).requestId,submitted.requestId);
 const saved=t.expect(await t.call(5175,'auth',base,token),200);t.assert.equal(saved.status,'SUBMITTED');
 t.expect(await t.call(5175,'auth',base,token,{draftVersion:saved.version,fields},'PATCH'),409);
 const queued=await t.wait('Existing loan submission',()=>t.call(5175,'auth','/api/v1/seller/loan-requests',token),r=>r.data.items?.some(x=>x.requestId===submitted.requestId&&x.applicationId));
 const app=queued.data.items.find(x=>x.requestId===submitted.requestId).applicationId;
 await t.wait('Workflow draft',()=>t.workflow(app,token),r=>r.status===200&&r.data.status==='DRAFT');await t.cancel(app,token);
 t.report('ai-assistant',{passed:true,draftId:draft.draftId,applicationId:app,checks:['seller ownership and role isolation','saved draft resume','stale edit protection','real local Ollama explanation','model suggestions do not write drafts','explicit declarations','existing submission and idempotent retry','submitted draft immutable','verification application cancelled']});
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
