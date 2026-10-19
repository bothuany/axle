---
paths:
  - "orders-service/**/*.java"
  - "shipping-service/**/*.java"
---

# Java services

- Constructor injection only. No field `@Autowired`.
- Controllers return the entity or a DTO, never a `ResponseEntity` unless a status needs setting.
- A repository method that is not a Spring Data derived query gets a comment saying why.
- Kafka payloads are JSON strings for now. Do not introduce Avro without asking.
