package com.acme.web;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;
// A bean name and no class mapping: the method's path stands alone.
@Controller("vetsBean")
public class VetController {
    @GetMapping("/vets")
    public String list() { return "vets"; }
}
