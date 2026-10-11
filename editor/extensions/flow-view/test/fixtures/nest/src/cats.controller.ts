import { Controller, Get, Post } from '@nestjs/common';
import { CatsService } from './cats.service';
@Controller('cats')
export class CatsController {
  constructor(private readonly cats: CatsService) {}
  @Get(':id') findOne() { return this.cats.find(); }
  @Post() create() { return this.cats.make(); }
}
