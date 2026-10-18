package com.acme;

import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

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

    @GetMapping("/orders")
    public List<Order> list() {
        return service.list();
    }

    @GetMapping("/reports/revenue")
    public List<?> revenue() {
        return service.revenueReport();
    }
}
