package com.credflow.auth.assistant;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.ObjectMapper;
import com.credflow.auth.marketplace.LoanRequestService;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;
class LoanDraftServiceTest {
 JdbcTemplate db=mock(JdbcTemplate.class);LoanRequestService loans=mock(LoanRequestService.class);
 LoanDraftService service=new LoanDraftService(db,new ObjectMapper(),new DraftValidation(),loans);
 Jwt seller=Jwt.withTokenValue("x").header("alg","RS256").subject("user").claim("roles",List.of("SELLER")).claim("sellerId","owner").build();
 Map<String,Object> row(){return Map.of("DRAFT_ID","draft","FIELDS_JSON","{}","ROW_VERSION",2,"DRAFT_STATUS","DRAFT");}
 @Test void missingOrForeignDraftIsNotFound(){assertEquals(404,assertThrows(ResponseStatusException.class,()->service.read("foreign",seller)).getStatusCode().value());verify(db).queryForList(anyString(),eq("foreign"),eq("owner"));}
 @Test void nonSellerIsRejected(){var admin=Jwt.withTokenValue("x").header("alg","RS256").subject("admin").claim("roles",List.of("ADMIN")).build();assertEquals(403,assertThrows(ResponseStatusException.class,()->service.latest(admin)).getStatusCode().value());verifyNoInteractions(db);}
 @Test void staleVersionDoesNotWrite(){when(db.queryForList(anyString(),eq("draft"),eq("owner"))).thenReturn(List.of(row()));assertEquals(409,assertThrows(ResponseStatusException.class,()->service.save("draft",1,Map.of(),seller)).getStatusCode().value());verify(db,never()).update(anyString(),any(Object[].class));}
 @Test void raceDuringSaveIsConflict(){when(db.queryForList(anyString(),eq("draft"),eq("owner"))).thenReturn(List.of(row()));assertEquals(409,assertThrows(ResponseStatusException.class,()->service.save("draft",2,Map.of(),seller)).getStatusCode().value());}
 @Test void submittedDraftCannotBeChanged(){var d=new LoanDraftService.Draft("id",3,"SUBMITTED",Map.of(),new DraftValidation().validate(Map.of()),"r");assertEquals(409,assertThrows(ResponseStatusException.class,()->service.current(d,3)).getStatusCode().value());}
}
