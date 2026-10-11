package com.acme.shop.web;

import com.acme.shop.dto.CreateOrderRequest;
import com.acme.shop.dto.OrderDto;
import com.acme.shop.dto.OrderSummary;
import com.acme.shop.service.OrderService;
import java.util.List;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/orders")
public class OrderController {
    private final OrderService orders;

    public OrderController(OrderService orders) {
        this.orders = orders;
    }

    @PostMapping
    public ResponseEntity<OrderDto> create(@RequestBody CreateOrderRequest request) {
        return ResponseEntity.ok(orders.place(request));
    }

    @GetMapping
    public List<OrderDto> list() {
        return orders.all();
    }

    @GetMapping("/summary")
    public OrderSummary summary() {
        return new OrderSummary();
    }
}
