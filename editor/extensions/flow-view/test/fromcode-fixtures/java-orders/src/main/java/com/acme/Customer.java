package com.acme;

import jakarta.persistence.*;
import java.util.List;

@Entity
@Table(name = "customers")
public class Customer {
    @Id
    private Long id;

    private String name;

    @OneToMany(mappedBy = "customer")
    private List<Order> orders;
}
