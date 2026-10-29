package com.credflow.auth.assistant;

import java.util.*;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;

@RestController
@RequestMapping("/api/v1/seller/loan-drafts")
public class LoanDraftController {
 private final LoanDraftService drafts;private final AssistantOrchestrator assistant;
 public LoanDraftController(LoanDraftService drafts,AssistantOrchestrator assistant){this.drafts=drafts;this.assistant=assistant;}
 public record Update(@NotNull @Min(0) Integer draftVersion,@NotNull Map<String,String> fields){}
 public record Message(@NotNull @Min(0) Integer draftVersion,@NotBlank @Size(max=1500) String message){}
 public record Submit(@NotNull @Min(0) Integer draftVersion,@AssertTrue boolean initialSharingAuthorised,@AssertTrue boolean detailsConfirmed,@AssertTrue boolean kycTermsAccepted){}
 @GetMapping public Object latest(@AuthenticationPrincipal Jwt jwt){return drafts.latest(jwt);}
 @PostMapping public Object create(@AuthenticationPrincipal Jwt jwt){return drafts.create(jwt);}
 @GetMapping("/{id}") public Object read(@PathVariable UUID id,@AuthenticationPrincipal Jwt jwt){return drafts.read(id.toString(),jwt);}
 @PatchMapping("/{id}") public Object save(@PathVariable UUID id,@Valid @RequestBody Update input,@AuthenticationPrincipal Jwt jwt){return drafts.save(id.toString(),input.draftVersion(),input.fields(),jwt);}
 @PostMapping("/{id}/validate") public Object validate(@PathVariable UUID id,@AuthenticationPrincipal Jwt jwt){return drafts.read(id.toString(),jwt).validation();}
 @PostMapping("/{id}/assistant/messages") public Object message(@PathVariable UUID id,@Valid @RequestBody Message input,@AuthenticationPrincipal Jwt jwt){return assistant.message(id.toString(),input.draftVersion(),input.message(),jwt);}
 @PostMapping("/{id}/submit") public Object submit(@PathVariable UUID id,@Valid @RequestBody Submit input,@RequestHeader("Idempotency-Key") UUID key,@AuthenticationPrincipal Jwt jwt){return drafts.submit(id.toString(),input.draftVersion(),input.initialSharingAuthorised(),input.detailsConfirmed(),input.kycTermsAccepted(),key.toString(),jwt);}
}
