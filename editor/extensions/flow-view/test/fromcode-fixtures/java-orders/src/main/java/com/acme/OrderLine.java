package com.acme;

import jakarta.persistence.*;

@Entity
@Table(name = "order_lines")
public class OrderLine {
    @Id
    private Long id;

    @ManyToOne
    @JoinColumn(name = "order_id")
    private Order order;

    private String sku;

    private int quantity;
}
