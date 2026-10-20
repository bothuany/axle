package com.acme.billing.controllers;

import com.acme.billing.dtos.BillResponseDTO;
import com.acme.billing.services.BilingService;
import java.util.UUID;

public class BillingController {
	private final BilingService service;

	public BillingController(BilingService service) {
		this.service = service;
	}

	public BillResponseDTO getBillById(UUID billId) {
		return service.getBillById(billId);
	}
}
