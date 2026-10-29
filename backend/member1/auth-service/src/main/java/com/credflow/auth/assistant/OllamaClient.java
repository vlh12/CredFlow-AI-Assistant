package com.credflow.auth.assistant;

import java.net.*;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.Semaphore;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

@Component
public class OllamaClient {
 private final ObjectMapper json;private final URI uri;private final String model;private final Duration timeout;
 private final String prompt;private final Object schema;private final Semaphore capacity=new Semaphore(2);
 private final HttpClient http=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build();
 public OllamaClient(ObjectMapper json,@Value("${credflow.assistant.ollama-url:http://127.0.0.1:11434}") String url,@Value("${credflow.assistant.model:qwen3:1.7b}") String model,@Value("${credflow.assistant.timeout-seconds:45}") int seconds) throws Exception {
  this.json=json;this.model=model;this.timeout=Duration.ofSeconds(Math.clamp(seconds,1,90));
  URI base=URI.create(url);
  if(!Set.of("localhost","127.0.0.1","::1","[::1]").contains(base.getHost())||!"http".equals(base.getScheme())||base.getUserInfo()!=null||base.getQuery()!=null)throw new IllegalArgumentException("Ollama must use a local HTTP address.");
  this.uri=base.resolve("/api/chat");
  this.prompt=new String(new ClassPathResource("assistant/system-prompt.txt").getInputStream().readAllBytes(),StandardCharsets.UTF_8)+"\nApproved field definitions: "+new String(new ClassPathResource("assistant/field-descriptions.json").getInputStream().readAllBytes(),StandardCharsets.UTF_8);
  this.schema=json.readValue(new ClassPathResource("assistant/response-schema.json").getInputStream(),Map.class);
 }
 public Map<String,Object> chat(Map<String,Object> context) throws Exception {
  if(!capacity.tryAcquire())throw new IllegalStateException("Assistant busy");
  try {
   var body=Map.of("model",model,"stream",false,"think",false,"format",schema,"options",Map.of("temperature",0,"num_predict",450,"num_ctx",4096),"messages",List.of(Map.of("role","system","content",prompt),Map.of("role","user","content",json.writeValueAsString(context))));
   var request=HttpRequest.newBuilder(uri).timeout(timeout).header("Content-Type","application/json").POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body))).build();
   var response=http.send(request,HttpResponse.BodyHandlers.ofInputStream());
   try(var stream=response.body()){
    if(response.statusCode()!=200)throw new IllegalStateException("Ollama unavailable");
    byte[] bytes=stream.readNBytes(32769);if(bytes.length>32768)throw new IllegalArgumentException("Oversized model response");
    var root=json.readTree(bytes);if(!root.path("done").asBoolean())throw new IllegalArgumentException("Incomplete model response");
    return json.readValue(root.path("message").path("content").asText(),Map.class);
   }
  } finally { capacity.release(); }
 }
}
