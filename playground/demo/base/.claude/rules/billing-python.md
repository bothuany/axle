---
paths:
  - "billing-service/**/*.py"
---

# Billing service

- Type-annotate every new function.
- Routes live in `main.py` and call one method on `InvoiceService`. Business rules stay in the service.
- Celery tasks go in `tasks.py` and take plain ids, never ORM objects.
