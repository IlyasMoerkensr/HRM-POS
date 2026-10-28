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
4. Open de map `hrm-pos` en **dubbelklik `HRM-Kassa.exe`**.
   - Windows kan waarschuwen (“Windows heeft uw pc beschermd”), omdat het programma nieuw is. Klik op **Meer info** → **Toch uitvoeren**.
   - De eerste keer duurt het een paar minuten (installeren en klaarzetten). Het blauwe kassa-icoon naast de klok laat zien wat er gebeurt.
   - Windows vraagt om firewalltoegang voor Node.js: kies **Privénetwerken toestaan** (nodig voor de telefoons).
5. Het kassascherm opent vanzelf in de browser. De kassa draait daarna **onzichtbaar op de achtergrond**; er is geen zwart venster meer.

**Het kassa-icoon naast de klok** (klik met rechts):

| Menu | Wat |
|---|---|
| Kassa openen / Beheer openen | opent het scherm in de browser (linksklik op het icoon opent ook de kassa) |
| Adressen en koppelcode… | adres voor de telefoons en de koppelcode |
| Automatisch starten met Windows | vinkje aan = de kassa start vanzelf als de pc opstart |
| Bijwerken naar nieuwste versie | maakt een backup, haalt de nieuwste versie op en start opnieuw |
| Logboek openen | bij problemen: dit bestand doorsturen |
| Kassa afsluiten | stopt de kassa (ook voor de telefoons) |

Zie je het icoon niet? Klik op het pijltje **^** naast de klok en sleep het icoon naar de taakbalk.
`start.bat` werkt nog steeds als alternatief (met zwart venster).

> **Tip:** geef de pc in je router een vast IP-adres (DHCP-reservering), anders verandert het adres voor de telefoons soms.

## Eerste keer instellen

1. **Kassa koppelen:** vul op de pc de koppelcode in (kassa-icoon → *Adressen en koppelcode*). Dit hoeft maar één keer.
2. Kies een medewerker en vul het **beginsaldo** van de lade in.
3. Klik rechtsboven op **Beheer**. De eerste keer maak je daar het **eigenaarsaccount** aan (naam, e-mail, wachtwoord en de koppelcode). Daarna log je in Beheer altijd in met e-mail en wachtwoord:
   - **Medewerkers:** namen invullen, pincodes instellen, rol kiezen (Manager mag retouren doen).
   - **Accounts:** e-mail-accounts voor beheerders en de **boekhouder** (die ziet alleen Z-rapporten en export).
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
4. **Kas tellen**: tel het geld in de lade en vul het totaal in (of per munt en biljet). Het verwachte bedrag zie je pas daarna (eerlijke telling).
5. **Controle**: kasverschil (bij een verschil is een toelichting verplicht) en de pincontrole per medewerker. Met een Mollie-sleutel vergelijkt de kassa dit automatisch met Mollie; anders vergelijk je met de Mollie Tap-app op elke telefoon.
6. **Dag afsluiten** → het Z-rapport verschijnt. Druk het af of sla het op als PDF voor de boekhouder.

**Wat is “een dag”?** Een kassadag loopt van *Dag starten* tot het Z-rapport, niet van middernacht tot middernacht. Ben je na 00:00 nog open, dan loopt de kassadag gewoon door en sluit je hem af als je klaar bent. De volgende dag begint zodra iemand weer *Dag starten* doet. Het beginsaldo wordt alvast ingevuld met wat er bij de laatste afsluiting is geteld.

**Per ongeluk afgesloten?** Het Z-rapport blijft altijd staan (dat hoort zo voor de boekhouding). Een manager of beheerder klikt in het venster “Kassadag afgesloten” op **Nieuwe kassaperiode starten**. Alles wat je daarna verkoopt komt op een tweede Z-rapport voor dezelfde datum (“periode 2”), dat je aan het eind van de dag gewoon afsluit. In de export staan beide als aparte regels.

Iedere medewerker kan de dag afsluiten. Standaard tel je alleen het **totaal** in de lade; wie nauwkeuriger wil, kiest *Per munt en biljet*. Daarna kan er die dag niets meer worden aangeslagen en is het Z-rapport onwijzigbaar. Alle Z-rapporten staan onder **Dag → Eerdere Z-rapporten**.

## Export voor de boekhouder

Klik op **Dag → Export** (of Beheer → Export). Kies een maand of periode.

- **Alles in één Excel-bestand**: tabbladen Dagoverzicht, Btw-specificatie, Bonnenlijst, Journaalposten en Mollie-uitbetalingen.
- Losse **CSV**-bestanden (openen direct in Excel) voor boekhoudpakketten die CSV inlezen.
- **Maandrapport afdrukken / PDF**: overzicht met omzet, btw per tarief (rubriek 1a/1b), kas, pin per dag en de Mollie-tussenrekening.

Alleen **afgesloten dagen** (met Z-rapport) komen in de export, zodat cijfers nooit meer veranderen.

**Journaalposten** (per dag, boekstuk = Z-nummer): contant op 1000 Kas, pin op 1150 Tussenrekening Mollie, omzet en btw per tarief, plus kasverschillen (8990) en afromen/bijvullen (1090). Per Mollie-uitbetaling: bank (1100), transactiekosten (4610) en btw op kosten (1520) tegen 1150. Zo staat 1150 op nul zodra Mollie alles heeft uitbetaald.

De rekeningnummers pas je aan in **Beheer → Grootboek**, zodat ze aansluiten op het schema van de boekhouder.

**Mollie-uitbetalingen en kosten** ophalen: maak een *advanced access token* en zet die in `.env`:
```
MOLLIE_ORG_ACCESS_TOKEN="access_..."
```
Zo maak je hem: Mollie Dashboard → **Developers** → **API keys** → *advanced access token* aanmaken (of direct via https://my.mollie.com/dashboard/developers/api-access-tokens). Vink de leesrechten **settlements.read** én **payments.read** aan. Mollie toont het volledige token **maar één keer**, direct na het aanmaken: kopieer het meteen met de kopieerknop. De versie die je later in het overzicht ziet is ingekort en werkt niet. Alleen een gebruiker met de rol **Admin** in Mollie kan dit. Het token begint met `access_`. Start de kassa daarna opnieuw (kassa-icoon → *Kassa afsluiten* → `HRM-Kassa.exe`; een wijziging in `.env` telt pas na een herstart) en klik op de exportpagina op **Uitbetalingen ophalen bij Mollie**. Zolang er alleen testbetalingen zijn geweest, vindt Mollie geen uitbetalingen: die ontstaan pas na echte betalingen.

## Inloggen voor beheer en boekhouder (ook op afstand)

- **Beheer** opent met e-mail en wachtwoord (eigenaar of beheerder). De kassa zelf blijft werken met medewerkers en pincodes.
- **Accounts** beheer je in Beheer → Accounts. Rollen: *Eigenaar* (alles), *Beheerder* (alles behalve eigenaars beheren), *Boekhouder* (alleen Z-rapporten en export).
- **Wachtwoord vergeten?** Op de kassa-pc kan dat via *Wachtwoord vergeten?* met de koppelcode. De boekhouder vraagt het aan de eigenaar (Beheer → Accounts → Nieuw wachtwoord).
- Na 8 foute pogingen wordt een account 15 minuten geblokkeerd.

### Boekhouder op afstand laten meekijken

De kassa draait op de pc in de zaak. Om de boekhouder er vanaf internet bij te laten, maak je een beveiligde verbinding met **Tailscale Funnel** (gratis):

1. Installeer **Tailscale** op de kassa-pc ([tailscale.com/download](https://tailscale.com/download)) en log in.
2. Open **PowerShell** en typ: `tailscale funnel --bg 3000`
   De eerste keer vraagt Tailscale om Funnel aan te zetten; volg de link en klik op toestaan.
3. Tailscale toont een adres zoals `https://kassa-pc.tail1234.ts.net`. Dit adres blijft altijd hetzelfde.
4. Zet dat adres in `.env`: `PUBLIC_BASE_URL="https://kassa-pc.tail1234.ts.net"` (dan werken ook de Mollie-meldingen direct) en kies in het kassa-icoon *Kassa afsluiten* en start `HRM-Kassa.exe` opnieuw.
5. Maak in Beheer → Accounts een account voor de boekhouder en geef hem het adres, het e-mailadres en het wachtwoord.

**Liever Cloudflare Tunnel?** Dat kan ook (gratis), als je een eigen domein hebt dat bij Cloudflare is ondergebracht (bijv. `hrmfitness.nl`):

1. Log in op het Cloudflare-dashboard → **Zero Trust** → **Networks** → **Tunnels** → **Create a tunnel** (type *Cloudflared*), naam bijv. `kassa`.
2. Kies **Windows**. Cloudflare toont een installatiecommando met een token; voer dat uit in PowerShell **als administrator**. De tunnel draait daarna als Windows-service en start vanzelf mee met de pc.
3. Voeg een **public hostname** toe: subdomein `kassa`, domein `hrmfitness.nl`, service **HTTP** → `localhost:3000`.
4. Zet in `.env`: `PUBLIC_BASE_URL="https://kassa.hrmfitness.nl"` en herstart de kassa (kassa-icoon → *Kassa afsluiten* → `HRM-Kassa.exe`).

Gebruik geen *quick tunnel* (`trycloudflare.com`): dat adres verandert bij elke herstart.

Via dit adres zijn **alleen** inloggen, Beheer, Z-rapporten en export bereikbaar. De kassa, de telefoonweergave en het koppelen werken alleen op het netwerk van de zaak. De kassa-pc moet aan staan als de boekhouder kijkt.

## Backups

- Automatisch bij elke start en elke 4 uur in de map `backups` (laatste 90 worden bewaard).
- Extra veilig: zet in `.env` een map die in OneDrive of Google Drive staat:
  ```
  BACKUP_DIR="C:\Users\Kassa\OneDrive\Kassa-backups"
  ```
- De database zelf is `prisma\kassa.db`. Niet verwijderen.

## Bijwerken naar een nieuwe versie

Klik met rechts op het kassa-icoon naast de klok → **Bijwerken naar nieuwste versie**. De kassa maakt eerst een backup, haalt de nieuwe versie op en start opnieuw (1 à 3 minuten).
Gebruik je `start.bat`: sluit het zwarte venster, dubbelklik `update.bat` en daarna weer `start.bat`.

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
| `HRM-Kassa.exe`, `launcher/` | Achtergrondprogramma voor Windows (Go); opnieuw bouwen met `launcher/build.sh` |
| `src/lib/auth/` | Koppelen kassa-pc, pincodes, e-mail-accounts, herkenning van verzoeken op afstand |
| `src/proxy.ts` | Blokkeert kassa en telefoon voor verzoeken van buiten |
| `scripts/`, `start.bat`, `update.bat` | Starten en bijwerken zonder de .exe |

Ontwikkelen: `npm install`, `node scripts/setup.mjs`, `npx prisma migrate deploy`, `npx prisma db seed`, `npm run dev`.
Controle: `npm run typecheck`, `npm run build`.
