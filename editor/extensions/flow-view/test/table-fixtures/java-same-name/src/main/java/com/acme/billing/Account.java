package com.acme.billing;

import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

@Entity
@Table(name = "billing_accounts")
public class Account {
    @Id
    private Long id;
}
