# HRM Kassa

Web-based kassasysteem (Next.js + Prisma) met:

- 5 medewerkers met snelwissel, elk met eigen **Mollie Tap to Pay**-telefoon
- **USB-kassalade** via de Web Serial API (Chrome/Edge op de kassa-pc)
- Dagafsluiting (Z-rapport), kasverschillen en **dagcontrole kassa ↔ Mollie per medewerker**
- Export voor de boekhouder (grootboek 1000 / 1150 / 8000 / 8010 / 1600 / 1610)

> Status: **stap 1** — databaseschema, kassalade-service en Mollie-service.
> Kassascherm en telefoonweergave volgen in stap 2.

## Starten (ontwikkeling)

```bash
cd kassa
npm install
cp .env.example .env        # vul MOLLIE_API_KEY in (begin met test_...)
npm run db:push             # maakt kassa.db aan
npm run db:seed             # 5 medewerkers, btw, grootboek, voorbeeldproducten
npm run typecheck
```

## Belangrijkste bestanden

| Bestand | Wat |
|---|---|
| `prisma/schema.prisma` | Database: medewerkers, producten, btw, bonnen, betalingen (split), kas, Z-rapport, Mollie-controle, uitbetalingen, audit trail |
| `src/lib/hardware/cashDrawer.ts` | Kassalade via USB/COM (Web Serial), kick-code instelbaar, regels "alleen bij contant" en "geen verkoop met reden" |
| `src/lib/mollie/mollieService.ts` | Pin via Mollie: modus A/B/C, status via webhook of polling, retour, dagcontrole, uitbetalingen + kosten |
| `src/app/api/mollie/webhook` | Mollie-webhook (alleen bij publiek https-adres) |
| `src/app/api/payments/[id]/status` | Polling van betaalstatus |
| `src/app/api/cron/reconcile` | Automatische dagcontrole |

## Mollie instellen

1. Laat elke medewerker op de eigen telefoon inloggen in de **Mollie Tap**-app (zelfde Mollie-profiel).
2. Elke telefoon verschijnt dan als terminal (`term_...`) in Mollie. In de kassa koppel je die aan de medewerker.
3. Test eerst met een `test_`-sleutel: de kassa toont dan een link waarmee je een betaling op *paid* of *failed* zet.
4. Voor uitbetalingen en transactiekosten: maak een **organisatie-token** met `settlements.read` en zet die in `MOLLIE_ORG_ACCESS_TOKEN`.

Draait de kassa alleen lokaal (geen publiek https-adres), dan werkt alles via polling; een webhook is niet nodig.
