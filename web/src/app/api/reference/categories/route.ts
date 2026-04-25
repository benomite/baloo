import { listCategories } from '@/lib/services/reference';

export async function GET() {
  return Response.json(listCategories());
}
