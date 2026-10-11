package com.acme.web;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.servlet.ModelAndView;
@Controller
public class LegacyController {
    @RequestMapping("/legacy")
    public ModelAndView legacy() { return new ModelAndView("legacy"); }
}
