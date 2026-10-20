-- Onwijzigbare administratie (fiscale bewaarplicht).
-- De database zelf weigert wijzigingen aan afgeronde gegevens, ook als iemand
-- met een los programma in het databasebestand gaat rommelen.

-- Audit trail: alleen toevoegen
CREATE TRIGGER audit_no_update BEFORE UPDATE ON "AuditLog"
BEGIN SELECT RAISE(ABORT, 'Audit trail kan niet gewijzigd worden'); END;
CREATE TRIGGER audit_no_delete BEFORE DELETE ON "AuditLog"
BEGIN SELECT RAISE(ABORT, 'Audit trail kan niet verwijderd worden'); END;

-- Bonnen: genummerde bonnen nooit verwijderen; afgeronde bonnen nooit wijzigen
CREATE TRIGGER order_no_delete_numbered BEFORE DELETE ON "Order" WHEN OLD."number" IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'Genummerde bon kan niet verwijderd worden'); END;
CREATE TRIGGER order_no_update_final BEFORE UPDATE ON "Order" WHEN OLD."status" IN ('PAID', 'VOIDED')
BEGIN SELECT RAISE(ABORT, 'Afgeronde bon is onwijzigbaar; maak een creditbon'); END;
CREATE TRIGGER order_number_fixed BEFORE UPDATE OF "number" ON "Order" WHEN OLD."number" IS NOT NULL AND NEW."number" IS NOT OLD."number"
BEGIN SELECT RAISE(ABORT, 'Bonnummer kan niet gewijzigd worden'); END;
CREATE TRIGGER order_amounts_fixed BEFORE UPDATE ON "Order" WHEN OLD."number" IS NOT NULL AND (
  NEW."totalInclCents" IS NOT OLD."totalInclCents" OR NEW."vatCents" IS NOT OLD."vatCents" OR
  NEW."subtotalExclCents" IS NOT OLD."subtotalExclCents" OR NEW."type" IS NOT OLD."type" OR
  NEW."businessDayId" IS NOT OLD."businessDayId")
BEGIN SELECT RAISE(ABORT, 'Bedragen van een genummerde bon kunnen niet gewijzigd worden'); END;

-- Bonregels en btw-regels van genummerde bonnen
CREATE TRIGGER line_no_update_numbered BEFORE UPDATE ON "OrderLine"
WHEN (SELECT "number" FROM "Order" WHERE "id" = OLD."orderId") IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'Bonregel van genummerde bon is onwijzigbaar'); END;
CREATE TRIGGER line_no_delete_numbered BEFORE DELETE ON "OrderLine"
WHEN (SELECT "number" FROM "Order" WHERE "id" = OLD."orderId") IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'Bonregel van genummerde bon is onwijzigbaar'); END;
CREATE TRIGGER vatline_no_update_numbered BEFORE UPDATE ON "OrderVatLine"
WHEN (SELECT "number" FROM "Order" WHERE "id" = OLD."orderId") IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'Btw-regel van genummerde bon is onwijzigbaar'); END;
CREATE TRIGGER vatline_no_delete_numbered BEFORE DELETE ON "OrderVatLine"
WHEN (SELECT "number" FROM "Order" WHERE "id" = OLD."orderId") IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'Btw-regel van genummerde bon is onwijzigbaar'); END;

-- Betalingen: nooit verwijderen; geslaagde betaling niet terugdraaien of van bedrag wisselen.
-- (Koppelvelden voor de Mollie-controle en uitbetaling mogen wel bijgewerkt worden.)
CREATE TRIGGER payment_no_delete BEFORE DELETE ON "Payment"
BEGIN SELECT RAISE(ABORT, 'Betaling kan niet verwijderd worden'); END;
CREATE TRIGGER payment_paid_fixed BEFORE UPDATE ON "Payment" WHEN OLD."status" = 'PAID' AND (
  NEW."status" IS NOT OLD."status" OR NEW."amountCents" IS NOT OLD."amountCents" OR
  NEW."method" IS NOT OLD."method" OR NEW."orderId" IS NOT OLD."orderId" OR
  NEW."employeeId" IS NOT OLD."employeeId" OR NEW."tenderedCents" IS NOT OLD."tenderedCents" OR
  NEW."changeCents" IS NOT OLD."changeCents")
BEGIN SELECT RAISE(ABORT, 'Geslaagde betaling is onwijzigbaar'); END;

-- Kasmutaties: nooit verwijderen; alleen "lade ging open" mag nog worden ingevuld
CREATE TRIGGER cash_no_delete BEFORE DELETE ON "CashMovement"
BEGIN SELECT RAISE(ABORT, 'Kasmutatie kan niet verwijderd worden'); END;
CREATE TRIGGER cash_fixed BEFORE UPDATE ON "CashMovement" WHEN
  NEW."amountCents" IS NOT OLD."amountCents" OR NEW."type" IS NOT OLD."type" OR
  NEW."businessDayId" IS NOT OLD."businessDayId" OR NEW."userId" IS NOT OLD."userId" OR
  NEW."reason" IS NOT OLD."reason" OR NEW."createdAt" IS NOT OLD."createdAt"
BEGIN SELECT RAISE(ABORT, 'Kasmutatie is onwijzigbaar'); END;

-- Z-rapporten
CREATE TRIGGER z_no_update BEFORE UPDATE ON "ZReport"
BEGIN SELECT RAISE(ABORT, 'Z-rapport is onwijzigbaar'); END;
CREATE TRIGGER z_no_delete BEFORE DELETE ON "ZReport"
BEGIN SELECT RAISE(ABORT, 'Z-rapport kan niet verwijderd worden'); END;

-- Afgesloten kassadag niet heropenen
CREATE TRIGGER day_closed_fixed BEFORE UPDATE ON "BusinessDay" WHEN OLD."status" = 'CLOSED'
BEGIN SELECT RAISE(ABORT, 'Afgesloten kassadag kan niet gewijzigd worden'); END;

-- Nummering alleen vooruit
CREATE TRIGGER sequence_forward_only BEFORE UPDATE ON "NumberSequence" WHEN NEW."last" < OLD."last"
BEGIN SELECT RAISE(ABORT, 'Nummering kan niet teruggezet worden'); END;
CREATE TRIGGER sequence_no_delete BEFORE DELETE ON "NumberSequence"
BEGIN SELECT RAISE(ABORT, 'Nummering kan niet verwijderd worden'); END;
