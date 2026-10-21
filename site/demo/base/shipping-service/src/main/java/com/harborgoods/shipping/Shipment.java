package com.harborgoods.shipping;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

@Entity
@Table(name = "shipments")
public class Shipment {
    @Id
    private Long id;

    @Column(name = "order_ref", nullable = false)
    private String orderRef;

    private String carrier;
}
