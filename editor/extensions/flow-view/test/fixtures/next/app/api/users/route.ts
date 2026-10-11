import { listUsers } from '../../../lib';
export async function GET() { return Response.json(listUsers()); }
export async function POST(req: Request) { return Response.json({}); }
