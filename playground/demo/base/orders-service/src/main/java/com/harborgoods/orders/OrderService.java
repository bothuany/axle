package com.harborgoods.orders;

import jakarta.persistence.EntityManager;
import java.util.List;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Service;

@Service
public class OrderService {
    private final OrderRepository orders;
    private final EntityManager em;
    private final BillingClient billing;
    private final KafkaTemplate<String, String> kafka;

    public OrderService(OrderRepository orders, EntityManager em, BillingClient billing, KafkaTemplate<String, String> kafka) {
        this.orders = orders;
        this.em = em;
        this.billing = billing;
        this.kafka = kafka;
    }

    public Order place(Order order) {
        Order saved = orders.save(order);
        billing.createInvoice(saved);
        announce(saved);
        return saved;
    }

    public Order find(Long id) {
        return orders.findById(id).orElseThrow();
    }

    public List<Order> list() {
        return orders.findAll();
    }

    public String invoiceFor(Long id) {
        return billing.findInvoice(id);
    }

    public List<?> revenueReport() {
        return em.createNativeQuery("select status, count(*) from orders group by status").getResultList();
    }

    private void announce(Order order) {
        kafka.send("order.placed", String.valueOf(order));
    }
}
