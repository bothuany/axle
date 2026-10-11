package com.acme.shop.service;

import com.acme.shop.dto.Money;
import org.springframework.stereotype.Service;

@Service
public class PricingService {
    public Money price(String sku, int quantity) {
        return new Money();
    }
}
