package com.acme.build;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class BuildController {
    @GetMapping("/builds")
    public String list() {
        return "builds";
    }
}
