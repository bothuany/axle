package com.harborgoods.orders;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

@Entity
@Table(name = "orders")
public class Order {
    @Id
    private Long id;

    @Column(name = "customer_email", length = 120, nullable = false)
    private String customerEmail;

    @Column(name = "legacy_ref", length = 40)
    private String legacyRef;

    private String status;

    private Long totalCents;
}
