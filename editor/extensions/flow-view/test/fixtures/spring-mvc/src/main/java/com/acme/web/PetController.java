package com.acme.web;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
// @Controller("petsBean") names the bean; the prefix is the mapping's path.
@Controller("petsBean")
@RequestMapping(path = "/pets")
public class PetController {
    @PostMapping("/new")
    public String create() { return "pet"; }
}
