package com.acme.billing.dtos;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.UUID;

// Already in the code, and close to the planned BillReportDTO in name and fields: it must not be taken for it.
public class BillResponseDTO {
	public UUID id;
	public UUID contractId;
	public String customerId;
	public BigDecimal amount;
	public LocalDateTime dueDate;
	public String billStatus;
	public LocalDateTime createdAt;
	public LocalDateTime paymentDate;
	public boolean paid;
}
