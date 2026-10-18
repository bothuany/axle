package com.acme.billing;

import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class BillingAccountController {
    private final AccountRepository accounts;

    public BillingAccountController(AccountRepository accounts) {
        this.accounts = accounts;
    }

    @GetMapping("/billing/accounts")
    public List<Account> list() {
        return accounts.findAll();
    }

    @PostMapping("/billing/accounts")
    public Account create(Account account) {
        return accounts.save(account);
    }
}
