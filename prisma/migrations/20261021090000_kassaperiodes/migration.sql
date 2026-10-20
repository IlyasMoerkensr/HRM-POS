-- Kassaperiodes: meerdere afsluitingen op één datum mogelijk (bijv. na per ongeluk afsluiten).
DROP INDEX "BusinessDay_date_key";
ALTER TABLE "BusinessDay" ADD COLUMN "sequence" INTEGER NOT NULL DEFAULT 1;
CREATE UNIQUE INDEX "BusinessDay_date_sequence_key" ON "BusinessDay"("date", "sequence");
CREATE INDEX "BusinessDay_status_idx" ON "BusinessDay"("status");
