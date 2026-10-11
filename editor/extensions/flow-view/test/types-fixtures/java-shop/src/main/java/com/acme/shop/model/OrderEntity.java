package com.acme.shop.model;

import java.util.List;
import javax.persistence.Entity;
import javax.persistence.Id;

@Entity
public class OrderEntity {
    @Id
    private Long id;
    private List<OrderLineEntity> lines;
}
