package com.acme.checkout;

public class PercentDiscount extends DiscountPolicy {
	private int percent;

	@Override
	public Money apply(Order order) {
		return null;
	}
}
