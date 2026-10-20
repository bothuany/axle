package com.acme.checkout;

public class CheckoutService {
	private final DiscountPolicy discounts;

	public CheckoutService(DiscountPolicy discounts) {
		this.discounts = discounts;
	}

	public ReceiptDto checkout(Order order) {
		return null;
	}
}
