import { listModesPaiement } from '@/lib/services/reference';

export async function GET() {
  return Response.json(listModesPaiement());
}
