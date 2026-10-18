package com.acme.shop;

import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

@Entity
@Table(name = "shop_accounts")
public class Account {
    @Id
    private Long id;
}
