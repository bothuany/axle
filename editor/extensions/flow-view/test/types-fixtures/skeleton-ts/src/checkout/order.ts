import { Money } from './money'

export class OrderLine {
	sku: string
	qty: number
}

export class Order {
	id: number
	lines: OrderLine[]

	total(): Money {
		return new Money()
	}

	private lineCount(): number {
		return this.lines.length
	}
}
