package com.harborgoods.orders;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;

/** The only place the orders service talks to billing: plain HTTP, so the flow can follow it by route. */
@Component
public class BillingClient {
    private final RestTemplate rest;

    @Value("${billing.url}")
    private String baseUrl;

    public BillingClient(RestTemplate rest) {
        this.rest = rest;
    }

    public String createInvoice(Order order) {
        return rest.postForObject(baseUrl + "/api/invoices", order, String.class);
    }

    public String findInvoice(Long orderId) {
        return rest.getForObject(baseUrl + "/api/invoices/" + orderId, String.class);
    }
}
