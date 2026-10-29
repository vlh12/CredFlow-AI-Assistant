import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes,generateKeyPairSync} from 'node:crypto';
import {parseProperties,properties,forward} from './setup-common.mjs';

export const schemas={auth:'CF_AUTH',application:'CF_APPLICATION',consent:'CF_CONSENT',eligibility:'CF_ELIGIBILITY',audit:'CF_AUDIT',orchestration:'CF_ORCHESTRATION',integration:'CF_LENDER_INTEGRATION',external:'CF_SIM_FINANCIAL','bank-a':'CF_SIM_BANK_A','nbfc-b':'CF_SIM_NBFC_B','bank-c':'CF_SIM_BANK_C'};
const ports={auth:8085,application:8081,consent:8082,eligibility:8083,audit:8086,orchestration:8084,integration:8087,external:8090,'bank-a':8091,'nbfc-b':8092,'bank-c':8093};
const serviceClients={consent:'consent-verification-service',eligibility:'eligibility-service',orchestration:'orchestration-service',integration:'integration-service','bank-a':'mock-bank-a','nbfc-b':'mock-nbfc-b','bank-c':'mock-bank-c'};
const password=()=>`Cf_9${randomBytes(16).toString('hex')}`;
export const migrations=[
 'database/organization-catalog.sql','database/seller-registration.sql','database/seller-loan-requests.sql',
 'database/marketplace-business-history.sql','database/offer-terms-documents.sql','database/marketplace-management.sql',
 'database/scope-completion.sql','database/phase0-alignment.sql','database/phase0-completion/01_financial_permission_checkpoint.sql',
 'database/bank-c-tables.sql','database/password-recovery.sql','database/fresh-install/seed-organizations.sql','database/lender-management.sql','database/ai-assistant/01-create-loan-drafts.sql',
];
function sqlBody(root,relative){
 const content=fs.readFileSync(path.join(root,relative),'utf8');
 // Only known repository scripts are assembled. Do not import arbitrary SQL.
 if(/^\s*(?:CONNECT|HOST|@@?|SPOOL)\s/im.test(content))throw Error(`Unexpected SQL*Plus command in ${relative}.`);
 return content.split(/\r?\n/).filter(line=>!/^\s*EXIT(?:\s+(?:SUCCESS|FAILURE|SQL\.SQLCODE|[0-9]+))?\s*;?\s*$/i.test(line)&&!/^\s*ALTER SESSION SET CONTAINER\s*=/i.test(line)).join('\n');
}
export function databaseInstaller(root,runtime){
 const owners=Object.values(schemas);
 const blocks=[`-- GENERATED PRIVATE FILE: contains this installation's database passwords.
-- Fresh FREEPDB1 only. Run as SYSTEM. Never commit or spool this file.
SET ECHO OFF
SET VERIFY OFF
SET DEFINE OFF
SET SERVEROUTPUT ON
WHENEVER SQLERROR EXIT FAILURE ROLLBACK
WHENEVER OSERROR EXIT FAILURE
DECLARE n NUMBER; BEGIN
 IF SYS_CONTEXT('USERENV','SESSION_USER') <> 'SYSTEM' OR SYS_CONTEXT('USERENV','CON_NAME') <> 'FREEPDB1' THEN
  RAISE_APPLICATION_ERROR(-20001,'Connect as SYSTEM to FREEPDB1 before running the fresh installer.');
 END IF;
 SELECT COUNT(*) INTO n FROM DBA_USERS WHERE USERNAME IN (${owners.map(v=>`'${v}'`).join(',')});
 IF n <> 0 THEN RAISE_APPLICATION_ERROR(-20002,'Fresh installation refused: one or more CredFlow schemas already exist. No schemas were created.'); END IF;
 SELECT COUNT(*) INTO n FROM DBA_TABLESPACES WHERE TABLESPACE_NAME='USERS' AND CONTENTS='PERMANENT' AND STATUS='ONLINE';
 IF n <> 1 THEN RAISE_APPLICATION_ERROR(-20003,'An online USERS tablespace is required.'); END IF;
END;
/`];
 for(const [service,owner] of Object.entries(schemas)){
  const secret=runtime[`db.${service}.password`];
  if(!/^Cf_9[0-9a-f]{32}$/.test(secret))throw Error('Fresh DB generator requires its generated schema passwords.');
  blocks.push(`CREATE USER ${owner} IDENTIFIED BY "${secret}" DEFAULT TABLESPACE USERS TEMPORARY TABLESPACE TEMP QUOTA 500M ON USERS;
GRANT CREATE SESSION TO ${owner};`);
 }
 const reference=fs.readFileSync(path.join(root,'database/member1-member3/member1-schema-reference.sql'),'utf8');
 const sections=[...reference.matchAll(/^-- Connect as (CF_[A-Z]+);[^\n]*\n([\s\S]*?)(?=^-- Connect as CF_|$(?![\s\S]))/gm)];
 if(sections.length!==3)throw Error('Member 1 schema reference must contain the Auth, Application and Consent sections.');
 for(const section of sections)blocks.push(`PROMPT Creating ${section[1]} base tables\nALTER SESSION SET CURRENT_SCHEMA=${section[1]};\n${section[2]}`);
 blocks.push('ALTER SESSION SET CURRENT_SCHEMA=SYSTEM;',sqlBody(root,'database/member1-member3/02_create_tables_as_system.sql'),sqlBody(root,'database/member1-member3/03_create_indexes_as_system.sql'));
 for(const [owner,folder,files] of [
  ['CF_ELIGIBILITY','eligibility',['V1__event_delivery_tables.sql','V2__financial_storage.sql','V3__financial_summary_package.sql','V4__demo_product_rules.sql','V5__eligibility_results.sql','V6__financial_import_provenance.sql','V7__eligibility_completion_outbox.sql','V8__eligibility_operation_intake.sql']],
  ['CF_AUDIT','audit',['V1__event_delivery_tables.sql','V2__audit_events.sql']],
  ['CF_SIM_FINANCIAL','mock-financial',['01-tables.sql']],
 ]){
  blocks.push(`ALTER SESSION SET CURRENT_SCHEMA=${owner};`);
  for(const file of files)blocks.push(sqlBody(root,`backend/member2/database/manual/${folder}/${file}`));
 }
 blocks.push('ALTER SESSION SET CURRENT_SCHEMA=SYSTEM;');
 for(const file of migrations)blocks.push(`PROMPT Applying ${file}`,sqlBody(root,file));
 blocks.push(`COMMIT;
PROMPT Fresh schema installation completed. Verify packages, then provision service identities.
SELECT OWNER,OBJECT_NAME,OBJECT_TYPE FROM DBA_OBJECTS WHERE OWNER IN (${owners.map(v=>`'${v}'`).join(',')}) AND STATUS='INVALID';
EXIT SUCCESS`);
 return blocks.join('\n\n')+'\n';
}
export function prepareLocal(root){
 const target=path.join(root,'backend/runtime/private');
 if(fs.existsSync(target))throw Error('Setup refused: backend/runtime/private already exists. Existing settings, keys and data were not changed.');
 const runtime={'db.url':'jdbc:oracle:thin:@//localhost:1521/FREEPDB1'};
 for(const [service,owner] of Object.entries(schemas)){runtime[`db.${service}.user`]=owner;runtime[`db.${service}.password`]=password();}
 for(const alias of ['admin','marketplace','seller','other-seller','bank-a','nbfc-b','bank-c']){
  runtime[`account.${alias}.username`]=alias==='bank-c'?'bank.c.officer':`integration.${alias}`;
  runtime[`account.${alias}.password`]=password();
 }
 for(const client of new Set(Object.values(serviceClients)))runtime[`client.${client}.secret`]=randomBytes(32).toString('base64url');
 const files=new Map();
 const pub=forward(path.join(target,'auth-public.pem')),priv=forward(path.join(target,'auth-private.pem'));
 for(const service of Object.keys(schemas)){
  const values=parseProperties(fs.readFileSync(path.join(root,`backend/runtime/examples/${service}.properties.example`),'utf8'));
  values['server.port']=ports[service];values['spring.datasource.username']=schemas[service];values['spring.datasource.password']=runtime[`db.${service}.password`];
  for(const key of Object.keys(values)){
   if(key.endsWith('public-key-path'))values[key]=pub;
   if(key.endsWith('private-key-path'))values[key]=priv;
   if(key.endsWith('public-key-location'))values[key]=values[key].startsWith('file:')?`file:${pub}`:pub;
   if(key.endsWith('client-secret')){
    const client=serviceClients[service];if(!client)throw Error(`Unknown client binding for ${service}.`);
    values[key]=runtime[`client.${client}.secret`];
   }
  }
  if(service==='auth'){values['credflow.marketplace-submission.enabled']='true';values['credflow.recovery.enabled']='true';}
  if(service==='bank-c'){
   for(const key of Object.keys(values))if(key.endsWith('.client-id'))values[key]='mock-bank-c';
  }
  files.set(`${service}.properties`,properties(values));
 }
 const keys=generateKeyPairSync('rsa',{modulusLength:3072,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
 files.set('auth-public.pem',keys.publicKey);files.set('auth-private.pem',keys.privateKey);
 const broker=parseProperties(fs.readFileSync(path.join(root,'backend/runtime/examples/kafka.properties.example'),'utf8'));
 broker['log.dirs']=forward(path.join(target,'kafka-data'));
 files.set('kafka.properties',properties(broker));files.set('runtime.properties',properties(runtime));
 files.set('kafka-cluster.id',randomBytes(16).toString('base64url')+'\n');
 files.set('fresh-install.sql',databaseInstaller(root,runtime));
 for(const [file,content] of files)if(/CHANGE_ME/.test(content))throw Error(`Unresolved placeholder in ${file}.`);
 // Perform all validation before creating the destination. There is no overwrite mode.
 fs.mkdirSync(path.dirname(target),{recursive:true});fs.mkdirSync(target);
 for(const folder of ['logs/kafka','kafka-data'])fs.mkdirSync(path.join(target,folder),{recursive:true});
 for(const [file,content] of files)fs.writeFileSync(path.join(target,file),content,{flag:'wx',mode:0o600});
 return {target,files:[...files.keys()]};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  if(process.argv.length>2)throw Error('Usage: node scripts/setup-local.mjs (fresh checkout only).');
  const result=prepareLocal(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'));
  console.log(`Prepared ${result.files.length} private files. No database or Kafka process was started.`);
  console.log('Next: follow SETUP-WINDOWS.md. Credentials remain in backend/runtime/private/runtime.properties; do not publish them.');
 }catch(error){console.error(error.message);process.exitCode=1;}
}
