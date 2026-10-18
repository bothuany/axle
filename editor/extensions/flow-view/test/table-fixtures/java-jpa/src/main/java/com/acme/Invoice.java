package com.acme;

import jakarta.persistence.Entity;
import jakarta.persistence.Id;

// No @Table: the table name is whatever the naming strategy makes of the class name.
@Entity
public class Invoice {
    @Id
    private Long id;

    private Long orderId;
}
