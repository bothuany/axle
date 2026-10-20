package com.acme.billing.services;

import com.acme.billing.dtos.BillResponseDTO;
import java.util.List;
import java.util.UUID;

public interface BilingService {
	BillResponseDTO getBillById(UUID billId);

	List<BillResponseDTO> getAllBills();
}
