package com.acme;

import jakarta.persistence.*;
import java.util.List;

@Entity
@Table(name = "orders")
public class Order {
    @Id
    private Long id;

    @ManyToOne
    @JoinColumn(name = "customer_id")
    private Customer customer;

    @OneToMany(mappedBy = "order")
    private List<OrderLine> lines;

    @Enumerated(EnumType.STRING)
    private OrderStatus status = OrderStatus.NEW;

    public OrderStatus getStatus() { return status; }

    public void setStatus(OrderStatus status) { this.status = status; }
}
