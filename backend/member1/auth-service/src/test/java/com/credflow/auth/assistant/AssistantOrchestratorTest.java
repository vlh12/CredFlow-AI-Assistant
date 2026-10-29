package com.credflow.auth.assistant;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.server.ResponseStatusException;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;
class AssistantOrchestratorTest {
 LoanDraftService drafts=mock(LoanDraftService.class);OllamaClient model=mock(OllamaClient.class);DraftValidation v=new DraftValidation();
 AssistantOrchestrator assistant=new AssistantOrchestrator(drafts,v,model);
 @Test void modelCannotSuggestConsentOrIdentity(){assertThrows(IllegalArgumentException.class,()->assistant.checked(List.of(Map.of("field","initialSharingAuthorised","value","true")),"yes"));assertThrows(IllegalArgumentException.class,()->assistant.checked(List.of(Map.of("field","dateOfBirth","value","1990-01-01")),"1990-01-01"));}
 @Test void financialInventionAndAmbiguityAreDiscarded(){var s=List.of(Map.of("field","declaredMonthlyIncome","value","50000.00"));assertTrue(assistant.checked(s,"My income is around five").isEmpty());assertTrue(assistant.checked(s,"income 50000").isEmpty());assertEquals(1,assistant.checked(s,"My monthly income is INR 50,000").size());assertTrue(assistant.checked(s,"My annual income is 50000").isEmpty());}
 @Test void validSuggestionAlwaysRequiresConfirmation(){var r=assistant.checked(List.of(Map.of("field","loanPurpose","value","PURCHASE_INVENTORY")),"buy stock");assertTrue(r.getFirst().requiresConfirmation());}
 @Test void unavailableProviderStillReturnsValidationWithoutSaving() throws Exception {
  Jwt jwt=mock(Jwt.class);var draft=new LoanDraftService.Draft("id",1,"DRAFT",Map.of("dateOfBirth","1990-01-01","documentReference","TEST-SECRET001"),v.validate(Map.of()),null);
  when(drafts.read("id",jwt)).thenReturn(draft);when(drafts.seller(jwt)).thenReturn("seller");when(model.chat(anyMap())).thenThrow(new java.io.IOException());
  var reply=assistant.message("id",1,"What is tenure?",jwt);assertFalse(reply.available());assertTrue(reply.suggestedUpdates().isEmpty());assertEquals(8,reply.missingFields().size());
  verify(drafts,never()).save(anyString(),anyInt(),anyMap(),any());
  verify(model).chat(argThat(c->!((Map<?,?>)c.get("draft")).containsKey("dateOfBirth")&&!((Map<?,?>)c.get("draft")).containsKey("documentReference")));
 }
 @Test void fieldExplanationUsesApprovedDefinition() throws Exception {
  Jwt jwt=mock(Jwt.class);var draft=new LoanDraftService.Draft("id",1,"DRAFT",Map.of(),v.validate(Map.of()),null);
  when(drafts.read("id",jwt)).thenReturn(draft);when(drafts.seller(jwt)).thenReturn("seller");
  when(model.chat(anyMap())).thenReturn(Map.of("reply","Rent is debt.","suggestedUpdates",List.of()));
  var response=assistant.message("id",1,"What does monthly debt mean?",jwt);
  assertTrue(response.available());assertTrue(response.reply().contains("Rent and utility bills belong under monthly expenses"));assertFalse(response.reply().contains("Rent is debt"));
 }
 @Test void staleModelResponseIsRejected() throws Exception {
  Jwt jwt=mock(Jwt.class);var draft=new LoanDraftService.Draft("id",1,"DRAFT",Map.of(),v.validate(Map.of()),null);when(drafts.read("id",jwt)).thenReturn(draft);when(drafts.seller(jwt)).thenReturn("seller");when(model.chat(anyMap())).thenReturn(Map.of("reply","Please enter an amount.","suggestedUpdates",List.of()));
  doNothing().doThrow(new ResponseStatusException(org.springframework.http.HttpStatus.CONFLICT)).when(drafts).current(draft,1);
  assertThrows(ResponseStatusException.class,()->assistant.message("id",1,"Hello",jwt));
 }
}
