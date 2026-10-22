import { audit } from './audit.js';
export class CatsService { find() { audit(); return 1; } }
