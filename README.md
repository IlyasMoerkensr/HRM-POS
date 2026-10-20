# HRM Kassa

Kassasysteem dat lokaal op de kassa-pc draait (net als het rooster), met:

- **Kassascherm** voor de pc: producttegels, zoeken, favorieten, korting (% of €), opmerkingen, parkeren
- **5 medewerkers** met snelwissel bovenin (optioneel met pincode)
- **Contant** met snelknoppen en wisselgeld; de **USB-kassalade** gaat alleen open bij contant
- **Pin via Mollie Tap to Pay** op de telefoon van de medewerker: bedrag automatisch naar de telefoon sturen, of handmatig bevestigen
- **Split-betaling** (bijv. €20 contant, rest pinnen) en **retour/creditbon** (contant terug of terug op de pinpas)
- **Telefoonweergave** voor medewerkers: zelf een bon aanslaan en pinnen op de eigen telefoon
- **Beheer**: medewerkers, pincodes, telefoons koppelen, producten, categorieën, kassalade-instellingen
- **Onwijzigbare administratie**: doorlopende bonnummers, afgeronde bonnen kunnen niet meer veranderd of verwijderd worden, alles wordt gelogd
- **Automatische backups** en een nachtelijke controle kassa ↔ Mollie

> Komt nog: dagafsluiting (Z-rapport met kastelling), kasmutaties en de export voor de boekhouder.

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
   - **Producten / Categorieën:** eigen assortiment invoeren. Laat de btw-tarieven controleren door de boekhouder.
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

Zonder Mollie-sleutel werkt pinnen ook: de medewerker tikt het bedrag in de Mollie Tap-app en klikt in de kassa op **“Handmatig ingetikt”**. De kassa controleert die betalingen later automatisch met Mollie.

## Dagelijks gebruik

- `start.bat` dubbelklikken → kassascherm opent vanzelf.
- Begin van de dag: beginsaldo invullen.
- **Lade** (bovenin): lade openen zonder verkoop, altijd met reden (wordt vastgelegd).
- **Bonnen**: alle bonnen van vandaag. **Retour**: creditbon maken (alleen manager/beheerder).

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
| `src/lib/orders/` | Bonberekening (btw per tarief), afrekenen, contant, retour |
| `src/lib/mollie/mollieService.ts` | Mollie Tap to Pay: betaling naar telefoon, status, retour, dagcontrole, uitbetalingen |
| `src/lib/hardware/cashDrawer.ts` | USB-kassalade via Web Serial (Chrome/Edge) |
| `src/lib/auth/session.ts` | Koppelen van de kassa-pc, medewerker-wissel, inloggen op telefoon |
| `src/app/kassa`, `telefoon`, `beheer` | De schermen |
| `scripts/`, `start.bat`, `update.bat` | Starten en bijwerken op Windows |

Ontwikkelen: `npm install`, `node scripts/setup.mjs`, `npx prisma migrate deploy`, `npx prisma db seed`, `npm run dev`.
Controle: `npm run typecheck`, `npm run build`.
