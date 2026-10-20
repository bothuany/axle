package com.acme.checkout;

import java.util.List;

public class Order {
	private Long id;
	private List<OrderLine> lines;

	public Money total() {
		return null;
	}

	private int lineCount() {
		return lines.size();
	}
}
