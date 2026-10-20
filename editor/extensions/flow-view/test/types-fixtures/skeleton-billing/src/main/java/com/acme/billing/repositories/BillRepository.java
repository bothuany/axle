package com.acme.billing.repositories;

import com.acme.billing.entities.Bill;
import java.util.List;

public interface BillRepository {
	List<Bill> findByPaidFalse();

	List<Bill> findByCustomerId(String customerId);
}
