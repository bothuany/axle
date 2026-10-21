package com.turkcell.billingservice.controllers;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class BillingController {
	@GetMapping("/api/bills")
	public int count() {
		return 0;
	}
}
