package com.acme.shop.dto;

import java.util.List;

public class CategoryDto {
    private CategoryDto parent;
    private List<CategoryDto> children;
    private String name;
}
