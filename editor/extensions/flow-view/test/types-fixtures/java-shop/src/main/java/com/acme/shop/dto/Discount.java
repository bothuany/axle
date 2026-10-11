package com.acme.shop.dto;

public class Discount {
    private int percent;

    public int apply(int cents) {
        return cents - cents * percent / 100;
    }
}
