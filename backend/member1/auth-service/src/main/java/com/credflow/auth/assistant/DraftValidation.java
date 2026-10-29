package com.credflow.auth.assistant;

import java.math.BigDecimal;
import java.time.*;
import java.util.*;
import org.springframework.stereotype.Component;
import com.credflow.auth.marketplace.*;

@Component
public class DraftValidation {
 public static final Map<String,String> LABELS;
 static {
  var m=new LinkedHashMap<String,String>();
  m.put("requestedAmount","Requested amount in INR"); m.put("loanPurpose","Loan purpose");
  m.put("preferredTenureMonths","Preferred tenure in months"); m.put("declaredMonthlyIncome","Declared monthly income in INR");
  m.put("monthlyExpenses","Monthly expenses in INR"); m.put("existingMonthlyDebt","Existing monthly debt repayments in INR");
  m.put("dateOfBirth","Date of birth"); m.put("documentReference","Fictional TEST document reference");
  LABELS=Collections.unmodifiableMap(m);
 }
 public static String explanationField(String message){
  String m=message.toLowerCase(Locale.ROOT);
  if(!m.matches("(?s).*(what|explain|meaning|mean|help|understand|define).*"))return "";
  if(m.contains("debt")||m.contains("emi"))return "existingMonthlyDebt";
  if(m.contains("expense"))return "monthlyExpenses";
  if(m.contains("income"))return "declaredMonthlyIncome";
  if(m.contains("tenure")||m.contains("repay"))return "preferredTenureMonths";
  if(m.contains("purpose"))return "loanPurpose";
  if(m.contains("amount"))return "requestedAmount";
  return "";
 }
 public static final Set<String> PURPOSES=Set.of("WORKING_CAPITAL","PURCHASE_INVENTORY","BUSINESS_EXPANSION");
 public static final Set<String> AI_FIELDS=Set.of("requestedAmount","loanPurpose","preferredTenureMonths","declaredMonthlyIncome","monthlyExpenses","existingMonthlyDebt");
 public record Result(List<String> missingFields, Map<String,String> validationErrors) { public boolean ready(){return missingFields.isEmpty()&&validationErrors.isEmpty();} }
 public Map<String,String> clean(Map<String,String> fields){
  if(fields==null||fields.size()>LABELS.size())throw new IllegalArgumentException("Invalid draft fields.");
  var out=new LinkedHashMap<String,String>();
  fields.forEach((k,v)->{if(!LABELS.containsKey(k)||v==null||v.length()>100)throw new IllegalArgumentException("Unsupported draft field or value.");out.put(k,v.trim());});
  return out;
 }
 public String error(String key,String value){
  try {
   if(value==null||value.isBlank())return "Required";
   switch(key){
    case "loanPurpose": return PURPOSES.contains(value)?null:"Choose a supported loan purpose.";
    case "preferredTenureMonths": return value.matches("[0-9]{1,3}")&&Integer.parseInt(value)>=1&&Integer.parseInt(value)<=120?null:"Enter 1 to 120 whole months.";
    case "dateOfBirth": var dob=LocalDate.parse(value);var now=LocalDate.now(ZoneOffset.UTC);return !dob.isAfter(now.minusYears(18))&&!dob.isBefore(now.minusYears(120))?null:"Seller must be between 18 and 120 years old.";
    case "documentReference": return value.matches("TEST-[A-Z0-9-]{6,40}")?null:"Use a fictional TEST- reference with 6 to 40 letters, digits or hyphens.";
    default:
     if(!LABELS.containsKey(key))return "Unsupported field";
     int digits=key.equals("requestedAmount")?9:12;
     if(!value.matches("[0-9]{1,"+digits+"}\\.[0-9]{2}"))return "Enter an INR amount with two decimal places.";
     return (key.equals("requestedAmount")||key.equals("declaredMonthlyIncome"))&&new BigDecimal(value).signum()<=0?"Amount must be positive.":null;
   }
  }catch(Exception e){return "Enter a valid "+LABELS.getOrDefault(key,"value")+".";}
 }
 public Result validate(Map<String,String> fields){
  var missing=new ArrayList<String>();var errors=new LinkedHashMap<String,String>();
  LABELS.forEach((k,label)->{String v=fields.get(k);if(v==null||v.isBlank())missing.add(k);else{String e=error(k,v);if(e!=null)errors.put(k,e);}});
  return new Result(missing,errors);
 }
 public LoanRequestInput submission(Map<String,String> f,boolean sharing,boolean confirmed,boolean kyc){
  if(!validate(f).ready())throw new IllegalArgumentException("Complete the draft and resolve validation errors before submitting.");
  if(!sharing||!confirmed||!kyc)throw new IllegalArgumentException("Confirm the details, prototype KYC terms and initial sharing permission yourself.");
  var phase=new Phase0Details(Integer.valueOf(f.get("preferredTenureMonths")),f.get("declaredMonthlyIncome"),f.get("monthlyExpenses"),f.get("existingMonthlyDebt"),LocalDate.parse(f.get("dateOfBirth")),"MOCK_ID",f.get("documentReference"),confirmed,kyc);
  phase.validate();return new LoanRequestInput(f.get("requestedAmount"),f.get("loanPurpose"),sharing,phase);
 }
}
