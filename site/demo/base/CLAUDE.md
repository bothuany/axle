# harbor-goods

Three small services behind one gateway. Read this before touching anything.

## Layout

- `orders-service/`: Java 21, Spring Boot. Owns the `orders` table. Places orders, asks billing for an invoice over HTTP, and announces `order.placed` on Kafka.
- `billing-service/`: Python 3.12, FastAPI. Owns the `invoices` table. Sends the receipt through a Celery task.
- `shipping-service/`: Java 21, Spring Boot. Listens for `order.placed` and owns the `shipments` table.

## Commands

- Orders and shipping: `./mvnw -pl orders-service test`, `./mvnw -pl shipping-service test`.
- Billing: `cd billing-service && pytest`.
- Format before you finish: `./mvnw spotless:apply` for Java, `ruff format` for Python.

## Rules of the house

- A service never reads another service's table. Cross-service data goes over HTTP or a topic.
- Money is whole cents in a `Long`. Never a double.
- A new column needs a migration in the same change. Do not edit an entity alone.
- Prefer small methods. A controller calls one service method and returns.
- Do not add dependencies without asking.

## When you change an endpoint

Check who calls it first: the flow canvas (`insilode` MCP, `impact`) lists the endpoints and the tables a method reaches. Say which ones your change touches in the summary.
