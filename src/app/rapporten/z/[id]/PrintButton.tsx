'use client';

export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className="rounded-xl bg-blue-600 px-4 py-2 font-semibold text-white print:hidden">
      Afdrukken / PDF
    </button>
  );
}
