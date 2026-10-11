package com.acme.shop.dto;

import java.util.List;

public class CreateOrderRequest {
    private List<OrderLineDto> lines;
    private AddressDto shipTo;
}
