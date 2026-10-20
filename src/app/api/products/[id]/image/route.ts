import { prisma } from '@/lib/prisma';

/**
 * Productfoto. De URL bevat ?v=<versie>, dus de browser mag hem altijd cachen;
 * een nieuwe foto krijgt een nieuwe versie en dus een nieuwe URL.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const product = await prisma.product.findUnique({ where: { id }, select: { imageData: true, imageMime: true } });
  if (!product?.imageData || !product.imageMime) return new Response('Geen foto', { status: 404 });
  return new Response(new Uint8Array(product.imageData), {
    headers: {
      'content-type': product.imageMime,
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
    },
  });
}
