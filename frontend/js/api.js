import { config } from './config.js';

export class ApiError extends Error {
  constructor(status, body, correlationId) {
    super(body?.message || (status === 0 ? 'Unable to reach the service. Check the connection and try again.' : `Request failed (${status}).`));
    this.status=status; this.code=body?.code || 'REQUEST_FAILED'; this.correlationId=body?.correlationId || correlationId;
    this.fieldErrors=body?.fieldErrors || [];
  }
}

export class LiveApi {
  constructor({ fetcher = (input, init) => globalThis.fetch(input, init), onUnauthorized = () => {} } = {}) {
    this.fetcher=fetcher; this.tokens={orchestration:'',integration:''}; this.pending=new Map(); this.onUnauthorized=onUnauthorized;
  }
  setTokens(tokens) { this.tokens={...tokens};this.cookieSession=false;this.sessionUserId=null; this.pending.clear(); }
  useSession(session) { this.tokens={};this.cookieSession=true;this.sessionUserId=session.userId;this.pending.clear(); }
  authHeaders(service) {return this.tokens[service]?{Authorization:`Bearer ${this.tokens[service]}`}:(this.cookieSession?{'X-CredFlow-User':this.sessionUserId}:{});}
  clear() { this.tokens={orchestration:'',integration:''};this.cookieSession=false;this.sessionUserId=null; this.pending.clear(); }
  async restoreSession() {
    const response=await this.fetcher('/api/session',{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(15000)});
    if(response.status===401)return null;
    const data=await response.json();if(!response.ok)throw new ApiError(response.status,data);
    this.useSession(data);return data;
  }
  async endSession() {
    const response=await this.fetcher('/api/session/logout',{method:'POST',credentials:'same-origin',headers:this.authHeaders('auth'),cache:'no-store',signal:AbortSignal.timeout(15000)});
    if(!response.ok){const data=await response.json();if(data.code==='SESSION_CHANGED')this.onUnauthorized();throw new ApiError(response.status,data);}
  }
  async request(service, path, body, method) {
    if (!this.tokens[service]&&!this.cookieSession) throw new ApiError(401,{code:'TOKEN_REQUIRED',message:`Sign in to access this service.`});
    const correlationId=crypto.randomUUID();
    const signature=`${service}:${path}:${JSON.stringify(body)}`;
    const key=body === undefined ? undefined : (this.pending.get(signature) || crypto.randomUUID());
    if (key) this.pending.set(signature,key);
    let response;
    try {
      response=await this.fetcher(`${config[`${service}Base`]}${path}`,{
        method:method || (body===undefined?'GET':'POST'), credentials:'same-origin',cache:'no-store', signal:AbortSignal.timeout(path.endsWith('/assistant/messages')?60000:20000),
        headers:{...this.authHeaders(service),'X-Correlation-ID':correlationId,...(body===undefined?{}:{'Content-Type':'application/json','Idempotency-Key':key})},
        ...(body===undefined?{}:{body:JSON.stringify(body)}),
      });
    } catch { throw new ApiError(0,{code:'CONNECTION_FAILED',message:'The service did not respond. A submitted action may still be processing. Refresh before retrying; unchanged retries reuse their key.'},correlationId); }
    let result;
    try { result=await response.json(); } catch { result={message:response.ok?'The service returned an unreadable response.':'The service returned an unexpected response.'}; }
    if (!response.ok) {
      if(response.status===401||result.code==='SESSION_CHANGED') this.onUnauthorized();
      if(response.status>=400 && response.status<500 && response.status!==429) this.pending.delete(signature);
      throw new ApiError(response.status,result,correlationId);
    }
    this.pending.delete(signature);
    return result;
  }
  async recover(path,body) {
    let response;
    try { response=await this.fetcher(`${config.authBase}/api/v1/auth/${path}`,{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)}); }
    catch { throw new ApiError(0,{message:path==='reset-password'?'The service did not respond. Your password may already have changed; try signing in before requesting another link.':'The recovery service did not respond. Check that the project is running and try again.'}); }
    let data;try { data=await response.json(); }catch { throw new ApiError(502,{message:'The recovery service returned an unreadable response. Please try again later.'}); }
    if(!response.ok)throw new ApiError(response.status,data,response.headers.get('X-Correlation-ID'));
    return data;
  }
  async login(username,password) {
    let response;
    try{response=await this.fetcher(`${config.authBase}/api/v1/auth/login`,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-CredFlow-Session':'cookie'},body:JSON.stringify({username,password}),cache:'no-store',signal:AbortSignal.timeout(20000)});}catch{throw new ApiError(0,{message:'Authentication service is unavailable.'});}
    const result=await response.json();if(!response.ok)throw new ApiError(response.status,result);return result;
  }
  amounts(ids) {return this.request('orchestration',`/api/v1/application-amounts?ids=${ids.map(encodeURIComponent).join(',')}`);}
  timeline(id) {return this.request('orchestration',`/api/v1/applications/${id}/timeline`);}
  termsMetadata(id) {return this.request('orchestration',`/api/v1/offers/${id}/terms-document/metadata`);}
  async uploadTerms(submissionId,offerId,reference,file) {
    if(!file||!file.name.toLowerCase().endsWith('.pdf')||file.size===0||file.size>5*1024*1024)throw new ApiError(400,{message:'Choose a PDF of at most 5 MB.'});
    const form=new FormData();form.set('termsReference',reference);form.set('file',file);
    let response;try{response=await this.fetcher(`${config.orchestrationBase}/api/v1/submissions/${submissionId}/offers/${offerId}/terms-document`,{method:'POST',credentials:'same-origin',headers:{...this.authHeaders('orchestration'),'Idempotency-Key':offerId,'X-Correlation-ID':crypto.randomUUID()},body:form,signal:AbortSignal.timeout(30000)});}catch{throw new ApiError(0,{message:'The terms upload did not respond. Retry the unchanged offer to reuse its document.'});}
    let body;try{body=await response.json();}catch{body={message:'The terms document could not be uploaded.'};}if(!response.ok){if(response.status===401||body.code==='SESSION_CHANGED')this.onUnauthorized();throw new ApiError(response.status,body);}return body;
  }
  async termsPdf(id) {
    let response;try{response=await this.fetcher(`${config.orchestrationBase}/api/v1/offers/${id}/terms-document`,{headers:this.authHeaders('orchestration'),credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(30000)});}catch{throw new ApiError(0,{message:'The terms PDF could not be loaded. Please try again.'});}
    if(!response.ok){let body;try{body=await response.json();}catch{body={message:'The terms PDF could not be loaded.'};}if(response.status===401||body.code==='SESSION_CHANGED')this.onUnauthorized();throw new ApiError(response.status,body);}
    if(!String(response.headers.get('content-type')).startsWith('application/pdf'))throw new ApiError(502,{message:'The terms document response is invalid.'});return response.blob();
  }
  eligibility(id) {return this.request('eligibility',`/api/v1/applications/${id}/eligibility`);}
  audit(id) {return this.request('audit',`/api/v1/applications/${id}/audit`);}
  applications(page=0) {return this.request('application',`/api/v1/applications?page=${page}&size=${config.pageSize}`);}
  application(id) {return this.request('application',`/api/v1/applications/${encodeURIComponent(id)}`);}
  consent(id) {return this.request('consent',`/api/v1/applications/${id}/consents`);}
  decideConsent(id,body,update=false) {return this.request('consent',`/api/v1/applications/${id}/consents`,body,update?'PUT':'POST');}
  financialConsent(id,body) {return this.request('consent',`/api/v1/applications/${id}/financial-consents`,body);}
  revokeFinancialConsent(id,body) {return this.request('consent',`/api/v1/applications/${id}/financial-consents/revoke`,body);}
  revokeConsent(id,version) {return this.request('consent',`/api/v1/applications/${id}/consents/revoke`,{expectedConsentVersion:version,reasonCode:'SELLER_WITHDRAWAL'});}
  workflow(id) { return this.request('orchestration',`/api/v1/applications/${encodeURIComponent(id)}/workflow`); }
  offers(id) { return this.all(`/api/v1/applications/${encodeURIComponent(id)}/offers`); }
  questions(id) { return this.all(`/api/v1/applications/${encodeURIComponent(id)}/information-requests`); }
  queue(page=0) { return this.request('orchestration',`/api/v1/submissions?page=${page}&size=${config.pageSize}`); }
  submission(id) { return this.request('orchestration',`/api/v1/submissions/${encodeURIComponent(id)}`); }
  async all(path) {
    let page=0,items=[], result;
    do { result=await this.request('orchestration',`${path}?page=${page}&size=100`); items.push(...result.items); page++; }
    while(items.length<result.totalElements && result.items.length>0 && page<100);
    return {items,totalElements:result.totalElements};
  }
  offerAction(offer,action) { return this.request('orchestration',`/api/v1/offers/${offer.offerId}/${action}`,{expectedOfferVersion:offer.version}); }
  answer(question,answers,refs=[]) { return this.request('orchestration',`/api/v1/information-requests/${question.informationRequestId}/responses`,{expectedInformationVersion:question.version,answers,syntheticDocumentReferences:refs}); }
  workflowAction(w,action) { return this.request('orchestration',`/api/v1/applications/${w.applicationId}/${action}`,{expectedWorkflowVersion:w.workflowVersion}); }
  officer(submissionId,action,body) { return this.request('integration',`/api/v1/submissions/${submissionId}/${action}`,body); }
}

