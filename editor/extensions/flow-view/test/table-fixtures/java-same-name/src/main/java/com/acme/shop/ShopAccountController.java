package com.acme.shop;

import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class ShopAccountController {
    private final AccountRepository accounts;

    public ShopAccountController(AccountRepository accounts) {
        this.accounts = accounts;
    }

    @GetMapping("/shop/accounts")
    public List<Account> list() {
        return accounts.findAll();
    }

    @PostMapping("/shop/accounts")
    public Account create(Account account) {
        return accounts.save(account);
    }
}
