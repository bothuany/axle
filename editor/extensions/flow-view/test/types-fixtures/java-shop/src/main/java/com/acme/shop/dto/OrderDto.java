package com.acme.shop.dto;

import java.util.List;
import java.util.Optional;

public class OrderDto {
    private Long id;
    private AddressDto address;
    private List<OrderLineDto> lines;
    private Optional<String> note;
    private Status status;
}
