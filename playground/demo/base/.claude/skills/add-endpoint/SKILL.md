---
name: add-endpoint
description: Add a REST endpoint to the orders or billing service, with its test and the flow check. Use when asked to add, expose or extend an HTTP route.
---

# Add an endpoint

1. Find the service that owns the data (see CLAUDE.md, Layout). Never add the route to the other one.
2. Add the service method first, then the controller or route that calls it.
3. Write the test next to the existing ones and run it.
4. Run `impact` from the `axle` MCP on the new method and list the endpoints and tables it reaches in your summary.
