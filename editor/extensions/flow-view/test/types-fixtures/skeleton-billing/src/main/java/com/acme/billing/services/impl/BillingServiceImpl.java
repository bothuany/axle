package com.acme.billing.services.impl;

import com.acme.billing.clients.CustomerClient;
import com.acme.billing.dtos.BillResponseDTO;
import com.acme.billing.repositories.BillRepository;
import com.acme.billing.services.BilingService;
import java.util.List;
import java.util.UUID;

public class BillingServiceImpl implements BilingService {
	private final BillRepository bills;
	private final CustomerClient customers;

	public BillingServiceImpl(BillRepository bills, CustomerClient customers) {
		this.bills = bills;
		this.customers = customers;
	}

	public BillResponseDTO getBillById(UUID billId) {
		return null;
	}

	public List<BillResponseDTO> getAllBills() {
		return null;
	}
}
