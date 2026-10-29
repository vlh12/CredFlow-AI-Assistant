package com.credflow.auth.assistant;
import java.util.*;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
class DraftValidationTest {
 DraftValidation v=new DraftValidation();
 Map<String,String> valid(){return Map.of("requestedAmount","100000.00","loanPurpose","PURCHASE_INVENTORY","preferredTenureMonths","12","declaredMonthlyIncome","50000.00","monthlyExpenses","10000.00","existingMonthlyDebt","0.00","dateOfBirth","1990-01-01","documentReference","TEST-SAMPLE001");}
 @Test void emptyDraftReportsEveryRequiredField(){assertEquals(8,v.validate(Map.of()).missingFields().size());}
 @Test void realContractAcceptsInventoryAndRejectsInventedPurpose(){assertTrue(v.validate(valid()).ready());assertNotNull(v.error("loanPurpose","INVENTORY_PURCHASE"));}
 @Test void invalidFinancesAndAdultAgeAreRejected(){assertNotNull(v.error("requestedAmount","0.00"));assertNotNull(v.error("declaredMonthlyIncome","0.00"));assertNull(v.error("existingMonthlyDebt","0.00"));assertNotNull(v.error("dateOfBirth",java.time.LocalDate.now().minusYears(10).toString()));assertNotNull(v.error("monthlyExpenses","-5.00"));}
 @Test void consentAndProfileFieldsCannotEnterDraft(){assertThrows(IllegalArgumentException.class,()->v.clean(Map.of("sellerId","other")));assertThrows(IllegalArgumentException.class,()->v.clean(Map.of("initialSharingAuthorised","true")));}
 @Test void submissionNeedsAllExplicitDeclarations(){assertThrows(IllegalArgumentException.class,()->v.submission(valid(),false,true,true));assertThrows(IllegalArgumentException.class,()->v.submission(valid(),true,false,true));assertThrows(IllegalArgumentException.class,()->v.submission(valid(),true,true,false));assertEquals("PURCHASE_INVENTORY",v.submission(valid(),true,true,true).loanPurpose());}
}
