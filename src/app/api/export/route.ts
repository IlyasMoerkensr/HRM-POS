import { NextResponse } from 'next/server';

import { audit } from '@/lib/audit';
import { getReportAccess } from '@/lib/auth/access';
import { AuthError } from '@/lib/auth/session';
import { parsePeriod } from '@/lib/export/accounting';
import { buildSheets, EXPORT_KINDS, type ExportKind } from '@/lib/export/build';
import { toCsv, toXlsx } from '@/lib/export/formats';
import { prisma } from '@/lib/prisma';
import { getSetting } from '@/lib/settings';

/**
 * GET /api/export?soort=dagen|btw|bonnen|journaal|mollie|alles&van=2026-10-01&tot=2026-10-31&formaat=csv|xlsx
 * Alleen vanaf de gekoppelde kassa-pc, door een manager of beheerder.
 */
export async function GET(request: Request) {
  try {
    const access = await getReportAccess({ needManager: true });
    if (!access) throw new AuthError('Log in om te exporteren');

    const url = new URL(request.url);
    const period = parsePeriod(url.searchParams.get('van'), url.searchParams.get('tot'));
    const soort = url.searchParams.get('soort') ?? 'alles';
    const formaat = url.searchParams.get('formaat') === 'xlsx' || soort === 'alles' ? 'xlsx' : 'csv';
    if (soort !== 'alles' && !(soort in EXPORT_KINDS)) throw new Error('Onbekende export');

    const { sheets } = await buildSheets(period);
    const company = await getSetting('company.name', 'Kassa');
    const slug = company.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'kassa';
    const base = `${slug}_${soort}_${period.from}_tm_${period.to}`;

    await audit(prisma, {
      action: 'EXPORT',
      userId: access.via === 'kassa' ? access.userId : null,
      accountId: access.via === 'account' ? access.account.id : null,
      data: { soort, formaat, ...period },
    });

    if (formaat === 'xlsx') {
      const list = soort === 'alles' ? Object.values(sheets) : [sheets[soort as ExportKind]];
      const buffer = await toXlsx(list, { title: `Kassa-export ${period.from} t/m ${period.to}`, company });
      return new NextResponse(new Uint8Array(buffer), {
        headers: {
          'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'content-disposition': `attachment; filename="${base}.xlsx"`,
          'cache-control': 'no-store',
        },
      });
    }
    return new NextResponse(toCsv(sheets[soort as ExportKind]), {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${base}.csv"`,
        'cache-control': 'no-store',
      },
    });
  } catch (err) {
    const status = err instanceof AuthError ? 401 : 400;
    return new NextResponse(err instanceof Error ? err.message : String(err), { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }
}
