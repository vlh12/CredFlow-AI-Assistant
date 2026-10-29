package com.credflow.auth.assistant;

import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.HttpStatus;
import tools.jackson.databind.ObjectMapper;
import com.credflow.auth.marketplace.LoanRequestService;

@Service
public class LoanDraftService {
 private final JdbcTemplate db; private final ObjectMapper json; private final DraftValidation validation; private final LoanRequestService loans;
 public LoanDraftService(JdbcTemplate db,ObjectMapper json,DraftValidation validation,LoanRequestService loans){this.db=db;this.json=json;this.validation=validation;this.loans=loans;}
 public record Draft(String draftId,int version,String status,Map<String,String> fields,DraftValidation.Result validation,String requestId){}
 public String seller(Jwt jwt){
  if(jwt==null||jwt.getClaimAsStringList("roles")==null||!jwt.getClaimAsStringList("roles").contains("SELLER")||jwt.getClaimAsString("sellerId")==null)throw new ResponseStatusException(HttpStatus.FORBIDDEN,"Seller access required.");
  return jwt.getClaimAsString("sellerId");
 }
 @SuppressWarnings("unchecked")
 private Draft present(Map<String,Object> row){
  try{Object raw=row.get("FIELDS_JSON");String text=raw instanceof java.sql.Clob c?c.getSubString(1,(int)c.length()):raw.toString();
   Map<String,String> fields=json.readValue(text,Map.class);
   return new Draft(row.get("DRAFT_ID").toString(),((Number)row.get("ROW_VERSION")).intValue(),row.get("DRAFT_STATUS").toString(),fields,validation.validate(fields),(String)row.get("REQUEST_ID"));
  }catch(Exception e){throw new IllegalStateException("Could not read application draft.");}
 }
 public Draft read(String id,Jwt jwt){
  var rows=db.queryForList("SELECT * FROM CF_LOAN_DRAFTS WHERE DRAFT_ID=? AND SELLER_ID=?",id,seller(jwt));
  if(rows.isEmpty())throw new ResponseStatusException(HttpStatus.NOT_FOUND,"Draft not found.");return present(rows.getFirst());
 }
 public Map<String,Object> latest(Jwt jwt){
  var rows=db.queryForList("SELECT * FROM CF_LOAN_DRAFTS WHERE SELLER_ID=? AND DRAFT_STATUS<>'SUBMITTED' ORDER BY UPDATED_AT DESC FETCH FIRST 1 ROWS ONLY",seller(jwt));
  return rows.isEmpty()?Map.of():Map.of("draft",present(rows.getFirst()));
 }
 @Transactional
 public Draft create(Jwt jwt){
  String seller=seller(jwt);
  if(db.queryForList("SELECT SELLER_ID FROM CF_SELLER_PROFILES WHERE SELLER_ID=? FOR UPDATE",seller).isEmpty())throw new ResponseStatusException(HttpStatus.CONFLICT,"Complete seller registration first.");
  var existing=latest(jwt);if(existing.containsKey("draft"))return (Draft)existing.get("draft");
  String id=UUID.randomUUID().toString();db.update("INSERT INTO CF_LOAN_DRAFTS(DRAFT_ID,SELLER_ID,FIELDS_JSON) VALUES (?,?,'{}')",id,seller);return read(id,jwt);
 }
 public void current(Draft draft,int version){
  if(draft.version()!=version||draft.status().equals("SUBMITTED"))throw new ResponseStatusException(HttpStatus.CONFLICT,"Draft changed or was submitted. Reopen the application to load its latest version.");
 }
 @Transactional
 public Draft save(String id,int version,Map<String,String> fields,Jwt jwt){
  var old=read(id,jwt);current(old,version);var clean=validation.clean(fields);String status=validation.validate(clean).ready()?"READY_FOR_REVIEW":"DRAFT";
  int count=db.update("UPDATE CF_LOAN_DRAFTS SET FIELDS_JSON=?,DRAFT_STATUS=?,ROW_VERSION=ROW_VERSION+1,UPDATED_AT=SYSTIMESTAMP WHERE DRAFT_ID=? AND SELLER_ID=? AND ROW_VERSION=? AND DRAFT_STATUS<>'SUBMITTED'",json.writeValueAsString(clean),status,id,seller(jwt),version);
  if(count!=1)throw new ResponseStatusException(HttpStatus.CONFLICT,"Draft changed. Reopen to load the latest version.");return read(id,jwt);
 }
 @Transactional
 public Object submit(String id,int version,boolean sharing,boolean confirmed,boolean kyc,String key,Jwt jwt){
  db.queryForList("SELECT DRAFT_ID FROM CF_LOAN_DRAFTS WHERE DRAFT_ID=? AND SELLER_ID=? FOR UPDATE",id,seller(jwt));
  var draft=read(id,jwt);
  if(draft.status().equals("SUBMITTED"))return loans.read(draft.requestId(),seller(jwt));
  current(draft,version);
  var result=loans.submit(validation.submission(draft.fields(),sharing,confirmed,kyc),key,jwt);
  db.update("UPDATE CF_LOAN_DRAFTS SET DRAFT_STATUS='SUBMITTED',REQUEST_ID=?,ROW_VERSION=ROW_VERSION+1,UPDATED_AT=SYSTIMESTAMP WHERE DRAFT_ID=? AND SELLER_ID=?",result.get("requestId"),id,seller(jwt));
  return result;
 }
}
