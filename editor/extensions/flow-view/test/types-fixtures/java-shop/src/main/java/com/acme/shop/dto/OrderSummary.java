package com.acme.shop.dto;

public class OrderSummary {
    private Money total;
    private Discount discount;

    public Money grandTotal() {
        return total;
    }
}
