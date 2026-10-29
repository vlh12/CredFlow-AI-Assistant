package com.credflow.auth.assistant;

import java.util.*;
import java.math.BigDecimal;
import java.util.regex.Pattern;
import org.springframework.stereotype.Service;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.security.oauth2.jwt.Jwt;

@Service
public class AssistantOrchestrator {
 private final LoanDraftService drafts;private final DraftValidation validation;private final OllamaClient model;
 private final Map<String,String> definitions=loadDefinitions();
 @SuppressWarnings("unchecked") private static Map<String,String> loadDefinitions(){try{return new tools.jackson.databind.ObjectMapper().readValue(new org.springframework.core.io.ClassPathResource("assistant/field-descriptions.json").getInputStream(),Map.class);}catch(Exception e){throw new IllegalStateException("Missing approved field definitions",e);}}
 private final Set<String> busy=java.util.concurrent.ConcurrentHashMap.newKeySet();
 public AssistantOrchestrator(LoanDraftService drafts,DraftValidation validation,OllamaClient model){this.drafts=drafts;this.validation=validation;this.model=model;}
 public record Suggestion(String field,String value,boolean requiresConfirmation){}
 public record Reply(String reply,List<Suggestion> suggestedUpdates,List<String> missingFields,Map<String,String> validationErrors,int draftVersion,boolean available){}
 public List<Suggestion> checked(Object raw,String message){
  if(!(raw instanceof List<?> list)||list.size()>6)throw new IllegalArgumentException("Invalid model suggestions");
  var suggestions=new ArrayList<Suggestion>();var used=new HashSet<String>();
  for(Object item:list){
   if(!(item instanceof Map<?,?> m)||m.size()!=2||!(m.get("field") instanceof String field)||!(m.get("value") instanceof String value)||!DraftValidation.AI_FIELDS.contains(field))throw new IllegalArgumentException("Unsupported model suggestion");
   if(!used.add(field)||validation.error(field,value)!=null)continue;
   // Financial and tenure suggestions must quote an explicit numeric value, never an inferred amount.
   if(!field.equals("loanPurpose")){
    var numbers=Pattern.compile("(?<![A-Za-z0-9.])[0-9][0-9,]*(?:\\.[0-9]+)?(?![A-Za-z0-9.])").matcher(message);boolean found=false;
    while(numbers.find())try{if(new BigDecimal(numbers.group().replace(",","")).compareTo(new BigDecimal(value))==0)found=true;}catch(NumberFormatException ignored){}
    if(!found)continue;
    if(Set.of("declaredMonthlyIncome","monthlyExpenses","existingMonthlyDebt").contains(field)&&!message.toLowerCase(Locale.ROOT).matches("(?s).*(monthly|per month|a month|each month).*"))continue;
    if(message.toLowerCase(Locale.ROOT).matches("(?s).*(annual|yearly|per year|dollars|usd|eur|lakh|crore|thousand).*"))continue;
   }
   suggestions.add(new Suggestion(field,value,true));
  }
  return suggestions;
 }
 public Reply message(String id,int version,String message,Jwt jwt){
  if(message==null||message.isBlank()||message.length()>1500)throw new IllegalArgumentException("Enter a question or answer of up to 1500 characters.");
  var draft=drafts.read(id,jwt);drafts.current(draft,version);String seller=drafts.seller(jwt);
  if(!busy.add(seller))throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS,"Wait for your current assistant response.");
  try {
   var safe=new LinkedHashMap<String,String>();draft.fields().forEach((k,v)->{if(DraftValidation.AI_FIELDS.contains(k))safe.put(k,v);});
   String reply;List<Suggestion> changes;boolean available;
   try{
    var result=model.chat(Map.of("draft",safe,"nextMissingField",draft.validation().missingFields().isEmpty()?"":draft.validation().missingFields().getFirst(),"validationErrors",draft.validation().validationErrors(),"sellerMessage",message));
    if(!(result.get("reply") instanceof String text)||text.isBlank()||text.length()>1600)throw new IllegalArgumentException("Invalid model reply");
    changes=checked(result.get("suggestedUpdates"),message);String focus=DraftValidation.explanationField(message);reply=definitions.getOrDefault(focus,text);available=true;
   }catch(Exception e){if(e instanceof InterruptedException)Thread.currentThread().interrupt();reply="AI assistance is temporarily unavailable. You can continue editing, saving and reviewing the form manually.";changes=List.of();available=false;}
   drafts.current(drafts.read(id,jwt),version);
   return new Reply(reply,changes,draft.validation().missingFields(),draft.validation().validationErrors(),version,available);
  }finally{busy.remove(seller);}
 }
}
