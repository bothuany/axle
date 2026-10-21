package com.acme;

import org.springframework.web.bind.annotation.*;

@RestController
public class OrderController {
    private final OrderService service;

    public OrderController(OrderService service) {
        this.service = service;
    }

    @PostMapping("/orders")
    public Order create(@RequestBody Order order) {
        return service.place(order);
    }

    @PostMapping("/orders/pay")
    public void pay(@RequestBody Order order) {
        service.pay(order);
    }
}
