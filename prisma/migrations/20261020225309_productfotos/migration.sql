-- Productfoto's: drie kolommen toevoegen (bestaande producten blijven ongewijzigd)
ALTER TABLE "Product" ADD COLUMN "imageData" BLOB;
ALTER TABLE "Product" ADD COLUMN "imageMime" TEXT;
ALTER TABLE "Product" ADD COLUMN "imageVersion" INTEGER NOT NULL DEFAULT 0;
