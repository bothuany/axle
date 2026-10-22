import { Injectable } from '@nestjs/common';
import { UserDto } from './user.dto.js';

// ESM and NodeNext: the import names the file TypeScript emits (user.dto.js), not the source (user.dto.ts).
@Injectable()
export class ProfileService {
  current(): UserDto {
    return { id: 1 } as UserDto;
  }
}

export function onlyActive(users: UserDto[]): UserDto[] {
  return users;
}
