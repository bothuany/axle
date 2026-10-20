package com.acme.billing.entities;

import java.math.BigDecimal;
import java.util.UUID;

public class Bill {
	public UUID id;
	public BigDecimal amount;
	public BillStatus status;
}
