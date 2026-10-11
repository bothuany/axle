package com.acme.shop.service;

import com.acme.shop.dto.CreateOrderRequest;
import com.acme.shop.dto.OrderDto;
import com.acme.shop.model.OrderEntity;
import com.acme.shop.repo.OrderRepository;
import java.util.List;
import org.springframework.stereotype.Service;

@Service
public class OrderService {
    private final OrderRepository repo;
    private final PricingService pricing;

    public OrderService(OrderRepository repo, PricingService pricing) {
        this.repo = repo;
        this.pricing = pricing;
    }

    public OrderDto place(CreateOrderRequest request) {
        OrderEntity saved = repo.save(new OrderEntity());
        return new OrderDto();
    }

    public List<OrderDto> all() {
        return List.of();
    }
}
