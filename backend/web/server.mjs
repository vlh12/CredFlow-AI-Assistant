import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {readFileSync} from 'node:fs';
import {verify,createPublicKey,randomBytes} from 'node:crypto';
import {portals} from './portals.mjs';
const publicKeyPath=fileURLToPath(new URL('../runtime/private/auth-public.pem',import.meta.url));
export function verifyIdentity(token,publicKey){
 const parts=token.split('.');if(parts.length!==3)throw Error('Invalid token');
 const header=JSON.parse(Buffer.from(parts[0],'base64url'));
 if(header.alg!=='RS256'||!verify('RSA-SHA256',Buffer.from(parts[0]+'.'+parts[1]),publicKey,Buffer.from(parts[2],'base64url')))throw Error('Invalid signature');
 const c=JSON.parse(Buffer.from(parts[1],'base64url')),now=Date.now()/1000;
 if(c.iss!=='credflow-auth'||!(Array.isArray(c.aud)?c.aud:[c.aud]).includes('credflow-api')||!c.sub||!Number.isFinite(c.exp)||c.exp<=now||(c.nbf&&c.nbf>now))throw Error('Expired or invalid identity');return c;
}
export function matchesPortal(c,portal){return Array.isArray(c.roles)&&c.roles.includes(portal.role)&&(!portal.lenderId||c.lenderId===portal.lenderId)&&(portal.role!=='LENDER_OFFICER'||/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(c.lenderId||''));}
export function roleAllowed(role,service,method,p){
 if(service==='auth'){
  if(['/api/v1/auth/login','/api/v1/auth/lenders','/api/v1/auth/forgot-password','/api/v1/auth/reset-password'].includes(p))return true;
  if(p==='/api/v1/auth/register-seller'||p==='/api/v1/auth/marketplaces')return role==='SELLER';
  if(p==='/api/v1/account/profile')return ['MARKETPLACE','LENDER_OFFICER','ADMIN'].includes(role);
  if(/^\/api\/v1\/seller\/loan-drafts(?:\/[0-9a-fA-F-]{36}(?:\/(?:validate|submit|assistant\/messages))?)?$/.test(p))return role==='SELLER';
  if(p==='/api/v1/seller/profile'||p==='/api/v1/seller/loan-requests')return role==='SELLER';
  if(/^\/api\/v1\/marketplace\/sellers\/[0-9a-fA-F-]{36}\/business-history$/.test(p))return role==='MARKETPLACE';
  if(p==='/api/v1/marketplace/sellers'||p==='/api/v1/marketplace/loan-requests')return role==='MARKETPLACE';
  return p.startsWith('/api/v1/admin/')&&role==='ADMIN';
 }
 if(service==='audit')return role==='ADMIN';
 if(service==='eligibility'&&p.startsWith('/api/v1/admin/routing-priorities'))return role==='ADMIN';
 if(service==='eligibility'&&p.startsWith('/api/v1/lender-products'))return role==='LENDER_OFFICER';
 if(service==='eligibility'||service==='consent')return role==='SELLER';
 if(service==='integration')return role==='LENDER_OFFICER';
 if(service==='application'){if(method==='POST'&&p.endsWith('/corrections'))return role==='SELLER';return method==='GET'?['SELLER','MARKETPLACE','ADMIN'].includes(role):false;}
 if(service==='orchestration'){
  if(method==='POST'&&/^\/api\/v1\/submissions\/[0-9a-fA-F-]{36}\/offers\/[0-9a-fA-F-]{36}\/terms-document$/.test(p))return role==='LENDER_OFFICER';
  if(method!=='GET')return role==='SELLER'||(role==='MARKETPLACE'&&/\/information-requests\/[0-9a-fA-F-]{36}\/responses$/.test(p));
  if(p.startsWith('/api/v1/submissions'))return role==='LENDER_OFFICER';
  if(role==='MARKETPLACE')return p.endsWith('/workflow')||p.endsWith('/information-requests')||p.endsWith('/timeline')||p==='/api/v1/application-amounts';
  return ['SELLER','LENDER_OFFICER','ADMIN'].includes(role);
 }
 return false;
}


const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../frontend');
const targets={eligibility:process.env.ELIGIBILITY_URL || 'http://127.0.0.1:8083',audit:process.env.AUDIT_URL || 'http://127.0.0.1:8086',auth:process.env.AUTH_URL || 'http://127.0.0.1:8085',application:process.env.APPLICATION_URL || 'http://127.0.0.1:8081',consent:process.env.CONSENT_URL || 'http://127.0.0.1:8082',orchestration:process.env.GATEWAY_URL || process.env.ORCHESTRATION_URL || 'http://127.0.0.1:8084',integration:process.env.GATEWAY_URL || process.env.INTEGRATION_URL || 'http://127.0.0.1:8087'};
const uuid='[0-9a-fA-F-]{36}';
export function allowed(service,method,p) {
  if(service==='auth'&&new RegExp('^/api/v1/seller/loan-drafts(?:/'+uuid+')?$').test(p)&&['GET','POST','PATCH'].includes(method)){return p.endsWith('loan-drafts')?['GET','POST'].includes(method):['GET','PATCH'].includes(method);}
  if(service==='auth'&&method==='POST'&&new RegExp('^/api/v1/seller/loan-drafts/'+uuid+'/(validate|submit|assistant/messages)$').test(p))return true;
  const rules={eligibility:{GET:['/api/v1/admin/routing-priorities',`/api/v1/applications/${uuid}/eligibility`,'/api/v1/lender-products',`/api/v1/lender-products/${uuid}/rules/history`],PUT:[`/api/v1/lender-products/${uuid}/rules`,`/api/v1/admin/routing-priorities/${uuid}`]},audit:{GET:[`/api/v1/applications/${uuid}/audit`]},auth:{GET:['/api/v1/admin/lenders','/api/v1/seller/loan-requests','/api/v1/marketplace/loan-requests',`/api/v1/marketplace/sellers/${uuid}/business-history`,'/api/v1/auth/lenders','/api/v1/auth/marketplaces','/api/v1/seller/profile','/api/v1/marketplace/sellers','/api/v1/admin/accounts','/api/v1/account/profile',`/api/v1/admin/marketplaces(?:/${uuid})?`],PUT:['/api/v1/seller/profile','/api/v1/account/profile',`/api/v1/admin/marketplaces/${uuid}`],DELETE:[`/api/v1/admin/marketplaces/${uuid}`],POST:['/api/v1/admin/lenders','/api/v1/admin/marketplaces',`/api/v1/marketplace/sellers/${uuid}/business-history`,'/api/v1/seller/loan-requests','/api/v1/auth/login','/api/v1/auth/forgot-password','/api/v1/auth/reset-password','/api/v1/auth/register-seller']},application:{GET:[`/api/v1/applications/${uuid}/corrections`,`/api/v1/applications(?:/${uuid})?`,"/api/v1/applications/active"],POST:['/api/v1/applications',`/api/v1/applications/${uuid}/corrections`]},consent:{GET:[`/api/v1/applications/${uuid}/consents`,`/api/v1/applications/${uuid}/financial-data-availability`],POST:[`/api/v1/applications/${uuid}/(?:consents|financial-consents)(?:/revoke)?`],PUT:[`/api/v1/applications/${uuid}/consents`]},orchestration:{GET:['/api/v1/application-amounts',`/api/v1/offers/${uuid}/terms-document(?:/metadata)?`,`/api/v1/applications/${uuid}/(workflow|timeline|offers|information-requests)`,`/api/v1/submissions(?:/${uuid})?`],POST:[`/api/v1/submissions/${uuid}/offers/${uuid}/terms-document`,`/api/v1/offers/${uuid}/(acceptance|decline)`,`/api/v1/information-requests/${uuid}/responses`,`/api/v1/applications/${uuid}/(cancellation|financial-refresh)`]},integration:{POST:[`/api/v1/submissions/${uuid}/(decisions|information-requests|offers|offer-withdrawals)`]}};
  return !!rules[service]?.[method]?.some(rule=>new RegExp(`^${rule}$`).test(p));
}
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.json':'application/json; charset=utf-8'};
function json(res,status,data) { res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'}); res.end(JSON.stringify(data)); }
const sessionLifetimeSeconds=15*60;
const sessionCookieName=portal=>'credflow_session_'+portal.id;
function sessionToken(req,portal){
 const entries=(req.headers.cookie||'').split(';').map(s=>s.trim()).filter(s=>s.startsWith(sessionCookieName(portal)+'='));
 if(entries.length!==1)return '';
 return entries[0].slice(sessionCookieName(portal).length+1);
}
function cookieClaims(token,key){
 const claims=verifyIdentity(token,key);
 if(!Number.isFinite(claims.iat))throw Error('Session issue time required');
 const exp=Math.min(claims.exp,claims.iat+sessionLifetimeSeconds);
 if(exp<=Date.now()/1000)throw Error('Session expired');
 return {...claims,exp};
}
function sessionView(claims,portal){return {username:claims.username||claims.sub,userId:claims.sub,role:portal.role,sellerId:claims.sellerId||null,marketplaceId:claims.marketplaceId||null,lenderId:claims.lenderId||null,expiresAt:claims.exp*1000,expiresIn:Math.max(0,Math.floor(claims.exp-Date.now()/1000))};}
function setSessionCookie(req,res,portal,token='',expires=0){
 const maxAge=token?Math.max(0,Math.floor(expires-Date.now()/1000)):0;
 const secure=req.socket.encrypted||process.env.CREDFLOW_COOKIE_SECURE==='true';
 res.setHeader('Set-Cookie',`${sessionCookieName(portal)}=${token}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=${maxAge}; Expires=${new Date(token?expires*1000:0).toUTCString()}${secure?'; Secure':''}`);
}
function sameOrigin(req){return req.headers.origin===`${req.socket.encrypted?'https':'http'}://${req.headers.host}`;}
export function createServer({portal=portals[0],publicKey,serviceTargets=targets,sessionClock=Date.now}={}) {
 let key=publicKey;const getKey=()=>key||(key=createPublicKey(readFileSync(publicKeyPath)));
 const sessions=new Map();
 const readSession=req=>{
  const id=sessionToken(req,portal),entry=sessions.get(id);
  if(!entry||entry.expiresAt<=sessionClock()){sessions.delete(id);throw Error('Session expired');}
  return {token:entry.token,claims:cookieClaims(entry.token,getKey())};
 };
 return http.createServer(async(req,res)=>{
  for(const [id,entry] of sessions)if(entry.expiresAt<=sessionClock())sessions.delete(id);
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  try {
    const url=new URL(req.url,'http://localhost');
    if(url.pathname==='/api/portal')return json(res,200,{id:portal.id,name:portal.name,role:portal.role});
    if(url.pathname==='/api/session'){
      if(req.method!=='GET')return json(res,405,{message:'Method not allowed.'});
      if(req.headers.origin&&!sameOrigin(req))return json(res,403,{code:'ORIGIN_DENIED',message:'Origin is not permitted.'});
      let claims;try{claims=readSession(req).claims;}catch{setSessionCookie(req,res,portal);return json(res,401,{message:'Sign in to continue.'});}
      if(!matchesPortal(claims,portal))return json(res,403,{message:'This account belongs to another portal.'});
      return json(res,200,sessionView(claims,portal));
    }
    if(url.pathname==='/api/session/logout'){
      if(req.method!=='POST')return json(res,405,{message:'Method not allowed.'});
      if(!sameOrigin(req))return json(res,403,{code:'ORIGIN_DENIED',message:'Origin is not permitted.'});
      if(req.headers['x-credflow-user']){try{const claims=readSession(req).claims;if(req.headers['x-credflow-user']!==claims.sub)return json(res,409,{code:'SESSION_CHANGED',message:'This portal is signed in to another account. Refresh to continue.'});}catch{}}
      sessions.delete(sessionToken(req,portal));
      setSessionCookie(req,res,portal);return json(res,200,{message:'Signed out.'});
    }
    if(url.pathname==='/api/health') {
      if(req.headers.origin&&!sameOrigin(req))return json(res,403,{code:'ORIGIN_DENIED',message:'Origin is not permitted.'});
      let claims;try{claims=req.headers.authorization?verifyIdentity(req.headers.authorization.replace(/^Bearer /,''),getKey()):readSession(req).claims;}catch{return json(res,401,{message:'Sign in to continue.'});}
      if(!matchesPortal(claims,portal)||portal.role!=='ADMIN')return json(res,403,{message:'Administrator access required.'});
      if(!req.headers.authorization&&req.headers['x-credflow-user']&&req.headers['x-credflow-user']!==claims.sub)return json(res,409,{code:'SESSION_CHANGED',message:'This portal is signed in to another account. Refresh to continue.'});
      const checks=await Promise.all(Object.entries({Auth:8085,Applications:8081,Consent:8082,Eligibility:8083,Audit:8086,Workflow:8084,'Lender integration':8087,'Identity and financial simulator':8090,'Bank A':8091,'NBFC B':8092,'Bank C':8093}).map(async([name,port])=>{try{const r=await fetch(`http://127.0.0.1:${port}/actuator/health`,{signal:AbortSignal.timeout(3000)});return {name,status:r.ok?'UP':'UNAVAILABLE'};}catch{return {name,status:'UNAVAILABLE'};}}));return json(res,200,{services:checks});
    }
    
    if(url.pathname.startsWith('/api/proxy/')) {
      // Only same-origin browser calls; private APIs and simulator callbacks are never proxied.
      if(req.headers.origin&&!sameOrigin(req)) return json(res,403,{code:'ORIGIN_DENIED',message:'Origin is not permitted.'});
      const match=url.pathname.match(/^\/api\/proxy\/([^/]+)(\/.*)$/);
      if(!match || !allowed(match[1],req.method,match[2])) return json(res,404,{code:'ROUTE_NOT_EXPOSED',message:'This public route is not exposed.'});
      const isPublic=match[1]==='auth'&&['/api/v1/auth/login','/api/v1/auth/forgot-password','/api/v1/auth/reset-password','/api/v1/auth/register-seller','/api/v1/auth/marketplaces'].includes(match[2]);
      const wantsSession=req.headers['x-credflow-session']==='cookie';
      if(wantsSession&&!sameOrigin(req))return json(res,403,{code:'ORIGIN_DENIED',message:'Origin is not permitted.'});
      let claims,authorization=req.headers.authorization;
      if(!isPublic){
       try{
        if(authorization)claims=verifyIdentity(authorization.replace(/^Bearer /,''),getKey());
        else{const session=readSession(req);claims=session.claims;authorization='Bearer '+session.token;if(!['GET','HEAD'].includes(req.method)&&!sameOrigin(req))return json(res,403,{code:'ORIGIN_DENIED',message:'Refresh the page and try again.'});}
       }catch{if(!req.headers.authorization)setSessionCookie(req,res,portal);return json(res,401,{code:'TOKEN_REQUIRED',message:'Sign in to continue.'});}
       if(!matchesPortal(claims,portal))return json(res,403,{code:'PORTAL_ACCESS_DENIED',message:'This account belongs to another portal.'});
       if(!req.headers.authorization&&req.headers['x-credflow-user']&&req.headers['x-credflow-user']!==claims.sub)return json(res,409,{code:'SESSION_CHANGED',message:'This portal is signed in to another account. Refresh to continue.'});
      }
      const automatedSubmission=portal.role==='MARKETPLACE'&&match[1]==='application'&&req.method==='POST'&&match[2]==='/api/v1/applications'&&claims?.marketplaceId&&claims.client_id==='marketplace-submission-'+claims.marketplaceId&&String(claims.scope||'').split(' ').includes('application.submit');
      if(!automatedSubmission&&!roleAllowed(portal.role,match[1],req.method,match[2]))return json(res,403,{code:'ROLE_ACCESS_DENIED',message:'This feature is not available for your role.'});
      const base=new URL(serviceTargets[match[1]]);
      if(!['http:','https:'].includes(base.protocol)) throw new Error('Invalid service target');
      const pdfUpload=match[1]==='orchestration'&&req.method==='POST'&&match[2].endsWith('/terms-document');
      const limit=pdfUpload?6*1024*1024:100000,chunks=[];let length=0;
      for await(const chunk of req){length+=chunk.length;if(length>limit)return json(res,413,{message:pdfUpload?'Choose a PDF of at most 5 MB.':'Request exceeds the allowed size.'});chunks.push(chunk);}
      const body=Buffer.concat(chunks);
      const headers={};
      for(const key of ['authorization','content-type','idempotency-key','x-correlation-id']) if(req.headers[key]) headers[key]=req.headers[key];
      if(authorization)headers.authorization=authorization;
      const result=await fetch(`${base.origin}${base.pathname.replace(/\/$/,'')}${match[2]}${url.search}`,{method:req.method,headers,...(body.length?{body}:{}),signal:AbortSignal.timeout(18000),redirect:'error'});
      if(match[1]==='orchestration'&&req.method==='GET'&&match[2].endsWith('/terms-document')&&result.ok){
       if(!String(result.headers.get('content-type')).startsWith('application/pdf'))return json(res,502,{message:'The terms document response is invalid.'});
       const bytes=Buffer.from(await result.arrayBuffer());if(bytes.length>5*1024*1024)return json(res,502,{message:'The terms document exceeds the allowed size.'});
       res.writeHead(result.status,{'Content-Type':'application/pdf','Content-Length':bytes.length,'Content-Disposition':result.headers.get('content-disposition')||'inline','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(bytes);return;
      }
      const responseText=await result.text();
      if(match[2]==='/api/v1/auth/login'&&result.ok){
       try{
        const token=JSON.parse(responseText).accessToken,identity=wantsSession?cookieClaims(token,getKey()):verifyIdentity(token,getKey());
        if(!matchesPortal(identity,portal))return json(res,403,{code:'PORTAL_ACCESS_DENIED',message:'Use the portal assigned to your account.'});
        if(wantsSession){const id=randomBytes(32).toString('base64url');sessions.delete(sessionToken(req,portal));sessions.set(id,{token,expiresAt:identity.exp*1000});setSessionCookie(req,res,portal,id,identity.exp);return json(res,200,sessionView(identity,portal));}
       }catch{return json(res,502,{message:'The authentication response could not be verified.'});}
      }
      res.writeHead(result.status,{'Content-Type':'application/json','Cache-Control':'no-store',...(result.headers.has('retry-after')?{'Retry-After':result.headers.get('retry-after')}:{})}); res.end(responseText); return;
    }
    if(req.method!=='GET' && req.method!=='HEAD') return json(res,405,{message:'Method not allowed.'});
    const name=decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname);
    // Serve a narrow public surface; never expose README, tests, server or credentials.
    if(!/^\/(index\.html|(?:css|js|assets)\/[a-zA-Z0-9_./-]+)$/.test(name) || name.split('/').includes('..')) return json(res,404,{message:'Not found.'});
    const file=path.resolve(root,'.'+name);
    if(!file.startsWith(root+path.sep)) return json(res,404,{message:'Not found.'});
    const content=await readFile(file); res.writeHead(200,{'Content-Type':types[path.extname(file)] || 'application/octet-stream','Cache-Control':'no-cache'}); res.end(req.method==='HEAD'?undefined:content);
  } catch(error) {
    if(error.code==='ENOENT') return json(res,404,{message:'Not found.'});
    json(res,502,{code:'SERVICE_UNAVAILABLE',message:'The backend is unavailable. Start the service and check its configured URL. A queued action may still complete; refresh before retrying.'});
  }
}); }
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 const portal=portals.find(p=>p.id===process.env.CREDFLOW_PORTAL)||portals[0];
 createServer({portal}).listen(portal.port,'127.0.0.1',()=>console.log(`${portal.name}: http://localhost:${portal.port}`));
}
