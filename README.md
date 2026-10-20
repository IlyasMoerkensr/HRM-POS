# HRM Kassa

Kassasysteem dat lokaal op de kassa-pc draait (net als het rooster), met:

- **Kassascherm** voor de pc: producttegels met foto, zoeken, favorieten, korting (% of €), opmerkingen, parkeren
- **5 medewerkers** met snelwissel bovenin (optioneel met pincode)
- **Contant** met snelknoppen en wisselgeld; de **USB-kassalade** gaat alleen open bij contant
- **Pin via Mollie Tap to Pay** op de telefoon van de medewerker: bedrag automatisch naar de telefoon sturen, of handmatig bevestigen
- **Split-betaling** (bijv. €20 contant, rest pinnen) en **retour/creditbon** (contant terug of terug op de pinpas)
- **Telefoonweergave** voor medewerkers: zelf een bon aanslaan en pinnen op de eigen telefoon
- **Beheer**: medewerkers, pincodes, telefoons koppelen, producten, categorieën, kassalade-instellingen
- **Onwijzigbare administratie**: doorlopende bonnummers, afgeronde bonnen kunnen niet meer veranderd of verwijderd worden, alles wordt gelogd
- **Kasmutaties**: wisselgeld bijvullen of afromen naar de kluis, met naam en reden
- **Dagafsluiting (Z-rapport)**: blinde kastelling per munt/biljet, kasverschil, pincontrole per medewerker, btw-specificatie; daarna staat de dag op slot
- **Automatische backups** en een nachtelijke controle kassa ↔ Mollie
- **Export voor de boekhouder**: Excel/CSV/PDF per maand of periode met btw-specificatie, journaalposten, bonnenlijst en Mollie-uitbetalingen met kosten

---

## Installeren op de kassa-pc (eenmalig)

1. **Node.js** installeren: [nodejs.org](https://nodejs.org), kies de **LTS**-versie.
2. **Git** installeren: [git-scm.com](https://git-scm.com) (standaardopties zijn goed).
3. Open de map waar de kassa moet komen (bijv. `C:\Kassa`), klik met rechts → *Open in Terminal* en typ:
   ```
   git clone https://github.com/IlyasMoerkensr/hrm-pos.git
   ```
   Windows vraagt één keer om in te loggen bij GitHub.
4. Open de map `hrm-pos` en **dubbelklik `start.bat`**.
   - De eerste keer duurt dit een paar minuten (installeren en klaarzetten).
   - Windows vraagt om firewalltoegang voor Node.js: kies **Privénetwerken toestaan** (nodig voor de telefoons).
5. Er opent een zwart venster met de adressen en de **koppelcode**, en Chrome opent het kassascherm.
   Laat het zwarte venster open staan: sluiten = kassa stopt.

```
  Kassa (deze pc):  http://localhost:3000/kassa
  Telefoons:        http://192.168.1.25:3000/telefoon
  Koppelcode:       492863
```

> **Tip:** geef de pc in je router een vast IP-adres (DHCP-reservering), anders verandert het adres voor de telefoons soms.

## Eerste keer instellen

1. **Kassa koppelen:** vul op de pc de koppelcode in. Dit hoeft maar één keer.
2. Kies **Medewerker 1** (dat is de beheerder), vul het **beginsaldo** van de lade in.
3. Klik rechtsboven op **Beheer**:
   - **Medewerkers:** namen invullen, pincodes instellen, rol kiezen (Manager mag retouren doen).
   - **Producten / Categorieën:** eigen assortiment invoeren, met foto (knop **Foto kiezen** bij een product). Laat de btw-tarieven controleren door de boekhouder.
     De producten uit `prisma/producten.csv` worden bij de eerste start automatisch ingelezen. Een nieuwe lijst (bijv. uit een ander kassasysteem) lees je in met **Importeren (CSV)**.
   - **Kassalade:** klik op **Test**, kies de COM-poort van de lade. Gaat hij open? Dan **Opslaan**.
4. Op de kassa: klik op **Lade koppelen** (bovenin) als die nog grijs is.

## Telefoons van medewerkers

1. Telefoon op de **wifi van de zaak**, open het telefoonadres uit het zwarte venster (bijv. `http://192.168.1.25:3000/telefoon`).
2. Kies je naam. De eerste keer: koppelcode invullen en een eigen pincode van 4 cijfers kiezen.
3. Tip: *Toevoegen aan beginscherm*, dan werkt het als een app.

## Mollie Tap to Pay koppelen

1. Laat elke medewerker op de eigen telefoon inloggen in de **Mollie Tap**-app.
2. Open het bestand `.env` in de kassamap (met Kladblok) en vul je sleutel in:
   ```
   MOLLIE_API_KEY="test_..."
   ```
   Begin met de **test**-sleutel. Sla op en start de kassa opnieuw (zwart venster sluiten, `start.bat`).
3. **Beheer → Medewerkers → Telefoon:** koppel elke medewerker aan zijn of haar telefoon.
4. Nu verschijnt bij afrekenen de knop **“Stuur bedrag naar telefoon van …”**. Het bedrag staat dan klaar in de Mollie Tap-app en de kassa sluit de bon vanzelf zodra de klant betaald heeft.

**Testen met een `test_`-sleutel:** Mollie stuurt in testmodus niets naar de telefoon. Op het wachtscherm verschijnt dan een link naar de Mollie-testpagina, waar je de betaling op *paid* of *failed* zet. Wil je echt op de telefoon testen, gebruik dan de `live_`-sleutel met een klein bedrag en stort het terug via **Retour**.

**Pinbetaling blijft hangen?** Klik op **Pinbetaling annuleren**. Lukt annuleren bij Mollie niet, dan vraagt de kassa of je hem **in de kassa wilt afbreken**. Doe dat alleen als de klant niet heeft betaald. Slaagt hij later toch, dan meldt de Mollie-controle hem als “alleen in Mollie”. Een openstaande bon vind je terug via **Bonnen** (oranje regel → openen) of bij **Dag**.

Zonder Mollie-sleutel werkt pinnen ook: de medewerker tikt het bedrag in de Mollie Tap-app en klikt in de kassa op **“Handmatig ingetikt”**. De kassa controleert die betalingen later automatisch met Mollie.

## Dagelijks gebruik

- `start.bat` dubbelklikken → kassascherm opent vanzelf.
- Begin van de dag: beginsaldo invullen.
- **Lade** (bovenin): lade openen zonder verkoop, altijd met reden (wordt vastgelegd).
- **Bonnen**: alle bonnen van vandaag. **Retour**: creditbon maken (alleen manager/beheerder).
- **Kas**: wisselgeld bijvullen of geld afromen naar de kluis. De lade gaat open en het wordt vastgelegd.

## Dagafsluiting (einde van de dag)

1. Room eerst het geld af dat naar de kluis gaat (**Kas** → Afromen), zodat alleen het wisselgeld voor morgen in de lade blijft.
2. Klik bovenin op **Dag**. Je ziet de tussenstand: omzet, btw, contant, pin en per medewerker.
3. Staan er nog open of geparkeerde bonnen? Reken die af of verwijder ze.
4. **Kas tellen**: vul per munt en biljet het aantal in. Het verwachte bedrag zie je pas daarna (eerlijke telling).
5. **Controle**: kasverschil (bij een verschil is een toelichting verplicht) en de pincontrole per medewerker. Met een Mollie-sleutel vergelijkt de kassa dit automatisch met Mollie; anders vergelijk je met de Mollie Tap-app op elke telefoon.
6. **Dag afsluiten** → het Z-rapport verschijnt. Druk het af of sla het op als PDF voor de boekhouder.

**Wat is “een dag”?** Een kassadag loopt van *Dag starten* tot het Z-rapport, niet van middernacht tot middernacht. Ben je na 00:00 nog open, dan loopt de kassadag gewoon door en sluit je hem af als je klaar bent. De volgende dag begint zodra iemand weer *Dag starten* doet. Het beginsaldo wordt alvast ingevuld met wat er bij de laatste afsluiting is geteld.

**Per ongeluk afgesloten?** Het Z-rapport blijft altijd staan (dat hoort zo voor de boekhouding). Een manager of beheerder klikt in het venster “Kassadag afgesloten” op **Nieuwe kassaperiode starten**. Alles wat je daarna verkoopt komt op een tweede Z-rapport voor dezelfde datum (“periode 2”), dat je aan het eind van de dag gewoon afsluit. In de export staan beide als aparte regels.

Alleen een **manager** of **beheerder** kan de dag afsluiten. Daarna kan er die dag niets meer worden aangeslagen en is het Z-rapport onwijzigbaar. Alle Z-rapporten staan onder **Dag → Eerdere Z-rapporten**.

## Export voor de boekhouder

Klik op **Dag → Export** (of Beheer → Export). Kies een maand of periode.

- **Alles in één Excel-bestand**: tabbladen Dagoverzicht, Btw-specificatie, Bonnenlijst, Journaalposten en Mollie-uitbetalingen.
- Losse **CSV**-bestanden (openen direct in Excel) voor boekhoudpakketten die CSV inlezen.
- **Maandrapport afdrukken / PDF**: overzicht met omzet, btw per tarief (rubriek 1a/1b), kas, pin per dag en de Mollie-tussenrekening.

Alleen **afgesloten dagen** (met Z-rapport) komen in de export, zodat cijfers nooit meer veranderen.

**Journaalposten** (per dag, boekstuk = Z-nummer): contant op 1000 Kas, pin op 1150 Tussenrekening Mollie, omzet en btw per tarief, plus kasverschillen (8990) en afromen/bijvullen (1090). Per Mollie-uitbetaling: bank (1100), transactiekosten (4610) en btw op kosten (1520) tegen 1150. Zo staat 1150 op nul zodra Mollie alles heeft uitbetaald.

De rekeningnummers pas je aan in **Beheer → Grootboek**, zodat ze aansluiten op het schema van de boekhouder.

**Mollie-uitbetalingen en kosten** ophalen: zet een organisatie-token in `.env`:
```
MOLLIE_ORG_ACCESS_TOKEN="access_..."
```
(Mollie Dashboard → Developers → Organisatie-tokens, recht *settlements.read*.) Klik daarna op de exportpagina op **Uitbetalingen ophalen bij Mollie**.

## Backups

- Automatisch bij elke start en elke 4 uur in de map `backups` (laatste 90 worden bewaard).
- Extra veilig: zet in `.env` een map die in OneDrive of Google Drive staat:
  ```
  BACKUP_DIR="C:\Users\Kassa\OneDrive\Kassa-backups"
  ```
- De database zelf is `prisma\kassa.db`. Niet verwijderen.

## Bijwerken naar een nieuwe versie

Sluit het zwarte kassavenster en dubbelklik **`update.bat`**. Die maakt eerst een backup, haalt de nieuwe versie op en zet hem klaar. Daarna weer `start.bat`.

---

## Technisch

| Map / bestand | Wat |
|---|---|
| `prisma/schema.prisma` | Databaseschema (alle bedragen in centen) |
| `prisma/migrations/` | Databasewijzigingen, incl. triggers die afgeronde administratie beschermen |
| `src/lib/orders/` | Bonberekening (btw per tarief), afrekenen, contant, retour, kasmutaties |
| `src/lib/reports/` | Dagoverzicht (X), dagafsluiting en Z-rapport |
| `src/lib/export/` | Boekhoudexport: journaalposten, btw, CSV en Excel |
| `src/lib/mollie/mollieService.ts` | Mollie Tap to Pay: betaling naar telefoon, status, retour, dagcontrole, uitbetalingen |
| `src/lib/hardware/cashDrawer.ts` | USB-kassalade via Web Serial (Chrome/Edge) |
| `src/lib/auth/session.ts` | Koppelen van de kassa-pc, medewerker-wissel, inloggen op telefoon |
| `src/app/kassa`, `telefoon`, `beheer`, `dagafsluiting`, `rapporten`, `export` | De schermen |
| `scripts/`, `start.bat`, `update.bat` | Starten en bijwerken op Windows |

Ontwikkelen: `npm install`, `node scripts/setup.mjs`, `npx prisma migrate deploy`, `npx prisma db seed`, `npm run dev`.
Controle: `npm run typecheck`, `npm run build`.
