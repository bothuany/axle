package com.acme.shop.dto;

public record OrderLineDto(String sku, int quantity, Money price) {
}
