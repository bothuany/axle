import { DiscountPolicy } from './discount'
import { Order } from './order'
import { Money } from './money'

export interface ReceiptDto {
	orderId: number
	total: Money
}

export class CheckoutService {
	constructor(private readonly discounts: DiscountPolicy) {}

	async checkout(order: Order): Promise<ReceiptDto> {
		throw new Error('todo')
	}
}
