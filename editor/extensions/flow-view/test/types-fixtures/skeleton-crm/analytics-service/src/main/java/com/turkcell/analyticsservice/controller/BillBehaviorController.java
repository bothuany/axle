package com.turkcell.analyticsservice.controller;

import com.turkcell.analyticsservice.service.BillBehaviorService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class BillBehaviorController {
	private final BillBehaviorService service;

	public BillBehaviorController(BillBehaviorService service) {
		this.service = service;
	}

	@GetMapping("/api/analytics/behavior")
	public int count() {
		return service.count();
	}
}
