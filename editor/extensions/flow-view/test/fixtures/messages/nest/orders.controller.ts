import { Controller, Inject, Post } from '@nestjs/common';
import { ClientProxy, EventPattern } from '@nestjs/microservices';

@Controller('carts')
export class CartsController {
	constructor(@Inject('BUS') private readonly client: ClientProxy) {}

	@Post('checkout')
	checkout() {
		this.client.emit('cart.checked-out', {});
	}
}

@Controller()
export class StockController {
	@EventPattern('cart.checked-out')
	reserve() {
		return true;
	}
}
