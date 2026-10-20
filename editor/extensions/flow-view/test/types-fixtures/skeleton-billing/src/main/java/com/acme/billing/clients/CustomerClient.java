package com.acme.billing.clients;

import com.acme.billing.dtos.CustomerResponseDTO;
import java.util.UUID;

public interface CustomerClient {
	CustomerResponseDTO getCustomer(UUID id);
}
