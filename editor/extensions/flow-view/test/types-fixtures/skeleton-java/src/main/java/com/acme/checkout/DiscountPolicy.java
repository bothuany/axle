package com.acme.checkout;

public abstract class DiscountPolicy {
	public abstract Money apply(Order order);
}
