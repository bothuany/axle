package com.harborgoods.orders;

import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
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
    public Order place(@RequestBody Order order) {
        return service.place(order);
    }

    @GetMapping("/orders")
    public List<Order> list() {
        return service.list();
    }

    @GetMapping("/orders/{id}")
    public Order show(@PathVariable Long id) {
        return service.find(id);
    }

    @GetMapping("/orders/{id}/invoice")
    public String invoice(@PathVariable Long id) {
        return service.invoiceFor(id);
    }

    @GetMapping("/reports/revenue")
    public List<?> revenue() {
        return service.revenueReport();
    }
}
