package com.acme;

import jakarta.persistence.EntityManager;
import java.util.List;
import org.springframework.stereotype.Service;

@Service
public class OrderService {
    private final OrderRepository orders;
    private final EntityManager em;

    public OrderService(OrderRepository orders, EntityManager em) {
        this.orders = orders;
        this.em = em;
    }

    public Order place(Order order) {
        return orders.save(order);
    }

    public List<Order> list() {
        return orders.findAll();
    }

    public List<?> revenueReport() {
        return em.createNativeQuery("select status, count(*) from orders group by status").getResultList();
    }
}
