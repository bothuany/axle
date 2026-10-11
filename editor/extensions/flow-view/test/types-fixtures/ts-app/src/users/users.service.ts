import { Injectable } from '@nestjs/common';
import { UserDto } from './user.dto';

@Injectable()
export class UsersService {
  constructor(private readonly repo: UsersRepository) {}

  async findAll(): Promise<UserDto[]> {
    return [];
  }
}

export class UsersRepository {
  load(): UserDto[] {
    return [];
  }
}
