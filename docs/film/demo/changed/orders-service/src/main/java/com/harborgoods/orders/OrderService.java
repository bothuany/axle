package com.harborgoods.orders;

import jakarta.persistence.EntityManager;
import java.time.Instant;
import java.util.List;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Service;

@Service
public class OrderService {
    private final OrderRepository orders;
    private final DiscountRepository discounts;
    private final EntityManager em;
    private final BillingClient billing;
    private final KafkaTemplate<String, String> kafka;

    public OrderService(OrderRepository orders, DiscountRepository discounts, EntityManager em, BillingClient billing, KafkaTemplate<String, String> kafka) {
        this.orders = orders;
        this.discounts = discounts;
        this.em = em;
        this.billing = billing;
        this.kafka = kafka;
    }

    public Order place(Order order) {
        Order priced = applyDiscount(order);
        Order saved = orders.save(priced);
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
        return em.createNativeQuery("select status, count(*), sum(discount_cents) from orders group by status").getResultList();
    }

    /** A valid code takes its percentage off before the order is saved, so billing and shipping see the discounted total. */
    private Order applyDiscount(Order order) {
        if (order.discountCode() == null) {
            return order;
        }
        return discounts.findByCodeIgnoreCase(order.discountCode())
            .filter(code -> code.isValid(Instant.now()))
            .map(code -> order.withDiscount(code.amountOff(order.totalCents())))
            .orElseThrow(() -> new IllegalArgumentException("unknown discount code"));
    }

    private void announce(Order order) {
        kafka.send("order.placed", String.valueOf(order));
    }
}
