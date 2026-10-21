package com.acme;

import org.springframework.stereotype.Service;

@Service
public class OrderService {
    private final OrderRepository orders;
    private final Notifier notifier;

    public OrderService(OrderRepository orders, Notifier notifier) {
        this.orders = orders;
        this.notifier = notifier;
    }

    public Order place(Order order) {
        Order saved = orders.save(order);
        notifier.orderPlaced(saved);
        return saved;
    }

    public void pay(Order order) {
        if (order.getStatus() == OrderStatus.NEW) {
            order.setStatus(OrderStatus.PAID);
            orders.save(order);
        }
    }

    public void ship(Order order) {
        if (order.getStatus() == OrderStatus.PAID) {
            order.setStatus(OrderStatus.SHIPPED);
        }
    }

    public void cancel(Order order) {
        if (order.getStatus().equals(OrderStatus.NEW)) {
            order.setStatus(OrderStatus.CANCELLED);
        }
    }

    public void reopen(Order order) {
        order.setStatus(OrderStatus.NEW);
    }
}
