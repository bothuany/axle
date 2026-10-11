package com.acme.shop.model;

import javax.persistence.Entity;

@Entity
public class OrderLineEntity {
    private String sku;
    private OrderEntity order;
}
