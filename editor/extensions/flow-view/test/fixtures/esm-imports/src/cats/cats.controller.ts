import { Controller, Get } from '@nestjs/common';
import { CatsService } from '../shared/cats.service.js';
@Controller('cats')
export class CatsController {
  constructor(private readonly cats: CatsService) {}
  @Get(':id') findOne() { return this.cats.find(); }
}
