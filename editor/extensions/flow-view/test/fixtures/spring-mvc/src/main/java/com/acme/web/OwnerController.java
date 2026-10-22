package com.acme.web;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
// A bare @Controller above the class mapping: the prefix is /owners.
@Controller
@RequestMapping("/owners")
public class OwnerController {
    @GetMapping("/{id}")
    public String show() { return "owner"; }
}
