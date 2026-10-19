import { Money } from './money'
import { Order } from './order'

export abstract class DiscountPolicy {
	abstract apply(order: Order): Money
}

export class PercentDiscount extends DiscountPolicy {
	percent: number

	apply(order: Order): Money {
		return new Money()
	}
}
